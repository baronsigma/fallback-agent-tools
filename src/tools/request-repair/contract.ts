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
}).describe('Header map. At most 40 headers; names up to 128 characters and values up to 4096.');

const requestPartSchema = z.object({
  method: z.string().trim().min(1).max(16).optional().describe('HTTP method, from 1 to 16 characters.'),
  url: z.string().max(2048).optional().describe('Request URL, up to 2048 characters. The tool does not call it or invent a replacement.'),
  headers: headersSchema.optional().describe('Request headers. Secret-like values are redacted in the result and are not required.'),
  query: z.record(z.string().max(128), jsonValueSchema).optional().describe('Query parameters as a JSON object. Property names are at most 128 characters.'),
  body: jsonValueSchema.optional().superRefine((value, context) => {
    if (value !== undefined && !boundedJson(value, 16000, 12, 1200)) context.addIssue({ code: 'custom', message: 'Request body exceeds size or nesting limits.' });
  }).describe('JSON-compatible request body within the size and nesting limits. It is not sent.'),
}).strict().describe('Failed request to repair. Required. This tool does not send or retry it.');

const responseSchema = z.object({
  status: z.number().int().min(100).max(599).optional().describe('HTTP status code of the failure, from 100 to 599.'),
  headers: headersSchema.optional().describe('Response headers used as evidence, such as Allow or Retry-After.'),
  body: jsonValueSchema.optional().superRefine((value, context) => {
    if (value !== undefined && !boundedJson(value, 12000, 10, 800)) context.addIssue({ code: 'custom', message: 'Response body exceeds size or nesting limits.' });
  }).describe('JSON-compatible response body used as evidence. It is not copied into the repair result.'),
}).strict().optional().describe('Optional failure response. Provide this, error, or error_route.');

const schemaEvidence = jsonValueSchema.optional().superRefine((value, context) => {
  if (value !== undefined && (!boundedJson(value, 20000, 16, 1800) || !value || typeof value !== 'object' || Array.isArray(value))) {
    context.addIssue({ code: 'custom', message: 'Schema must be a bounded JSON object.' });
  }
}).describe('Optional JSON Schema or OpenAPI fragment for the request. Must be a bounded JSON object. The tool does not fetch a schema.');

const errorRouteHintSchema = z.object({
  classification: errorClassificationSchema.describe('Classification from a previous error_route call. Required when error_route is set. Failures that are not request-shape problems cause abstention.'),
  retry: retryGuidanceSchema.optional().describe('Optional retry label from a previous error_route call. Repair decisions use classification together with the request, response, schema, and error text.'),
}).passthrough().optional().superRefine((value, context) => {
  if (value !== undefined && !boundedJson(value, 6000, 10, 600)) context.addIssue({ code: 'custom', message: 'error_route evidence exceeds the size limit.' });
}).describe('Optional previous error_route result. classification is required on this object; other fields may be included within the size limit.');

export const requestRepairInputSchema = z.object({
  goal: z.string().trim().min(1).max(500).optional().describe('What the request was trying to accomplish, from 1 to 500 characters.'),
  request: requestPartSchema,
  response: responseSchema,
  error: z.string().max(4000).optional().describe('Error text, up to 4000 characters. Provide this, a response, or error_route.'),
  error_route: errorRouteHintSchema,
  schema: schemaEvidence,
  constraints: z.object({
    allow_method_change: z.boolean().default(false).describe('When true, a 405 response whose Allow header names exactly one method may replace the request method. Defaults to false.'),
    allow_url_change: z.boolean().default(false).describe('When true, the caller allows a URL change. Defaults to false. Repairs do not invent or rewrite URLs.'),
  }).strict().default({ allow_method_change: false, allow_url_change: false }).describe('Caller limits on method and URL changes. Both flags default to false.'),
}).strict().superRefine((input, context) => {
  if (!input.response && !input.error && !input.error_route) {
    context.addIssue({ code: 'custom', message: 'Provide a request and relevant failure evidence.' });
  }
}).describe('Failed request plus schema or error evidence. Returns the smallest justified edit, or abstains. Nothing is sent.');

/**
 * Bazaar's embedded schema validator does not resolve recursive local refs.
 * Keep the runtime Zod schema untouched and project only its discovery form:
 * recursive arbitrary JSON nodes expand once, then use `{}` for nested values.
 * Sibling keywords on a ref, including property descriptions, stay on the expanded node.
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
      const siblings = Object.fromEntries(Object.entries(object).filter(([key]) => key !== '$ref' && key !== '$defs'));
      const applySiblings = (expanded: unknown): unknown => {
        if (!expanded || typeof expanded !== 'object' || Array.isArray(expanded)) return Object.keys(siblings).length > 0 ? siblings : expanded;
        return { ...expanded, ...siblings };
      };
      if (activeRefs.has(ref)) return Object.keys(siblings).length > 0 ? siblings : {};
      const definition = root['$defs'];
      const target = typeof definition === 'object' && definition !== null
        ? (definition as Record<string, unknown>)[decodeURIComponent(ref.slice('#/$defs/'.length).replaceAll('~1', '/').replaceAll('~0', '~'))]
        : undefined;
      if (target === undefined) return Object.keys(siblings).length > 0 ? siblings : {};
      return applySiblings(expand(target, new Set([...activeRefs, ref]), depth + 1));
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
