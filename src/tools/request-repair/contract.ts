import { z } from 'zod';
import { errorClassificationSchema, retryGuidanceSchema } from '../error-route/contract.js';

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string().max(8192), z.number().finite(), z.boolean(), z.null(),
  z.array(jsonValueSchema).max(256),
  z.record(z.string().max(128), jsonValueSchema),
]));

function boundedJson(value: unknown, maxBytes: number, maxDepth: number, maxNodes: number): boolean {
  let nodes = 0;
  const visit = (item: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return typeof item !== 'string' || item.length <= 8192;
    if (typeof item === 'number') return Number.isFinite(item);
    if (Array.isArray(item)) return item.length <= 256 && item.every((child) => visit(child, depth + 1));
    if (typeof item === 'object') return Object.entries(item as Record<string, unknown>).length <= 256 && Object.entries(item as Record<string, unknown>).every(([key, child]) => key.length <= 128 && visit(child, depth + 1));
    return false;
  };
  try { return visit(value, 0) && JSON.stringify(value).length <= maxBytes; }
  catch { return false; }
}

const headersSchema = z.record(z.string().max(128), z.string().max(4096)).superRefine((headers, context) => {
  if (Object.keys(headers).length > 40) context.addIssue({ code: 'custom', message: 'At most 40 request or response headers are accepted.' });
  if (Object.entries(headers).reduce((total, [name, value]) => total + name.length + value.length, 0) > 16000) context.addIssue({ code: 'custom', message: 'Header data exceeds the size limit.' });
});

const requestPartSchema = z.object({
  method: z.string().trim().min(1).max(16).optional(),
  url: z.string().max(2048).optional(),
  headers: headersSchema.optional(),
  query: z.record(z.string().max(128), jsonValueSchema).optional(),
  body: jsonValueSchema.optional().superRefine((value, context) => {
    if (value !== undefined && !boundedJson(value, 16000, 12, 1200)) context.addIssue({ code: 'custom', message: 'Request body exceeds size or nesting limits.' });
  }),
}).strict();

const responseSchema = z.object({
  status: z.number().int().min(100).max(599).optional(),
  headers: headersSchema.optional(),
  body: jsonValueSchema.optional().superRefine((value, context) => {
    if (value !== undefined && !boundedJson(value, 12000, 10, 800)) context.addIssue({ code: 'custom', message: 'Response body exceeds size or nesting limits.' });
  }),
}).strict().optional();

const schemaEvidence = jsonValueSchema.optional().superRefine((value, context) => {
  if (value !== undefined && (!boundedJson(value, 20000, 16, 1800) || !value || typeof value !== 'object' || Array.isArray(value))) {
    context.addIssue({ code: 'custom', message: 'Schema must be a bounded JSON object.' });
  }
});

const errorRouteHintSchema = z.object({
  classification: errorClassificationSchema,
  retry: retryGuidanceSchema.optional(),
}).passthrough().optional().superRefine((value, context) => {
  if (value !== undefined && !boundedJson(value, 6000, 10, 600)) context.addIssue({ code: 'custom', message: 'error_route evidence exceeds the size limit.' });
});

export const requestRepairInputSchema = z.object({
  goal: z.string().trim().min(1).max(500).optional(),
  request: requestPartSchema,
  response: responseSchema,
  error: z.string().max(4000).optional(),
  error_route: errorRouteHintSchema,
  schema: schemaEvidence,
  constraints: z.object({
    allow_method_change: z.boolean().default(false),
    allow_url_change: z.boolean().default(false),
  }).strict().default({ allow_method_change: false, allow_url_change: false }),
}).strict().superRefine((input, context) => {
  if (!input.response && !input.error && !input.error_route) {
    context.addIssue({ code: 'custom', message: 'Provide a request and relevant failure evidence.' });
  }
});

/**
 * Bazaar's embedded schema validator does not resolve recursive local refs.
 * Keep the runtime Zod schema untouched and project only its discovery form:
 * recursive arbitrary JSON nodes expand once, then use `{}` for nested values.
 */
export function getRequestRepairDiscoveryInputSchema(): Record<string, unknown> {
  const root = requestRepairInputSchema.toJSONSchema({ io: 'input' }) as Record<string, unknown>;
  const expand = (value: unknown, activeRefs: ReadonlySet<string>, depth: number): unknown => {
    if (depth > 32) return {};
    if (Array.isArray(value)) return value.map((item) => expand(item, activeRefs, depth + 1));
    if (!value || typeof value !== 'object') return value;
    const object = value as Record<string, unknown>;
    const ref = object['$ref'];
    if (typeof ref === 'string' && ref.startsWith('#/$defs/')) {
      if (activeRefs.has(ref)) return {};
      const definition = root['$defs'];
      const target = typeof definition === 'object' && definition !== null
        ? (definition as Record<string, unknown>)[decodeURIComponent(ref.slice('#/$defs/'.length).replaceAll('~1', '/').replaceAll('~0', '~'))]
        : undefined;
      return target === undefined ? {} : expand(target, new Set([...activeRefs, ref]), depth + 1);
    }
    return Object.fromEntries(Object.entries(object)
      .filter(([key]) => key !== '$defs')
      .map(([key, child]) => [key, expand(child, activeRefs, depth + 1)]));
  };
  return expand(root, new Set(), 0) as Record<string, unknown>;
}

const safeRequestSchema = z.object({
  method: z.string().optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), jsonValueSchema).optional(),
  body: jsonValueSchema.optional(),
}).strict();

export const requestRepairOutputSchema = z.object({
  status: z.enum(['repair_available', 'insufficient_evidence']),
  original_request: safeRequestSchema,
  repaired_request: safeRequestSchema.optional(),
  changes: z.array(z.object({
    path: z.string().min(1).max(256),
    operation: z.enum(['add', 'remove', 'replace', 'move']),
    value: jsonValueSchema.optional(),
    value_source: z.enum(['caller_input', 'explicit_server_evidence', 'caller_schema', 'response_header']).optional(),
    reason: z.string().min(1).max(180),
  }).strict()).max(3),
  evidence: z.array(z.object({
    source: z.enum(['caller_schema', 'server_error', 'response_header', 'http_semantics']),
    signal: z.enum([
      'schema_rejects_field', 'explicit_field_replacement', 'required_value_available',
      'schema_scalar_type', 'schema_parameter_location', 'supported_content_type',
      'allow_header_single_method', 'explicit_field_rejection',
    ]),
  }).strict()).max(8),
  confidence: z.number().min(0).max(1),
  safe_to_retry: z.boolean(),
  limits: z.array(z.string().max(180)).max(6),
}).strict();

export type RequestRepairInput = z.input<typeof requestRepairInputSchema>;
export type RequestRepairOutput = z.infer<typeof requestRepairOutputSchema>;
