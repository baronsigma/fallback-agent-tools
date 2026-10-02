import { z } from 'zod';

export const errorClassificationSchema = z.enum([
  'authentication_required', 'authorization_denied', 'rate_limited', 'quota_exhausted',
  'payment_required', 'payment_failed', 'schema_mismatch', 'invalid_input', 'not_found',
  'method_not_allowed', 'unsupported_media_type', 'timeout', 'connection_failure',
  'dns_failure', 'tls_failure', 'upstream_failure', 'service_unavailable', 'conflict',
  'stale_state', 'malformed_response', 'blocked_or_challenged', 'unknown',
]);
export const retryGuidanceSchema = z.enum(['never', 'immediate', 'after_delay', 'after_change', 'after_auth', 'after_payment', 'unknown']);
export const nextActionTypeSchema = z.enum(['modify_request', 'inspect_schema', 'wait', 'authenticate', 'change_endpoint', 'reduce_rate', 'pay', 'stop_retrying', 'escalate', 'unknown']);

const headersSchema = z.record(z.string().max(128), z.string().max(2048)).superRefine((headers, context) => {
  if (Object.keys(headers).length > 40) context.addIssue({ code: 'custom', message: 'At most 40 headers are accepted.' });
  if (Object.entries(headers).reduce((total, [name, value]) => total + name.length + value.length, 0) > 12000) context.addIssue({ code: 'custom', message: 'Header data exceeds the size limit.' });
});

const requestSchema = z.object({
  method: z.string().trim().max(16).optional(),
  url: z.string().max(2048).optional(),
  headers: headersSchema.optional(),
  body: z.unknown().optional().superRefine((body, context) => {
    if (body === undefined) return;
    try { if (JSON.stringify(body).length > 8192) context.addIssue({ code: 'custom', message: 'Request body exceeds the size limit.' }); }
    catch { context.addIssue({ code: 'custom', message: 'Request body must be JSON-compatible.' }); }
  }),
}).strict().optional();

const responseSchema = z.object({
  status: z.number().int().min(100).max(599).optional(),
  headers: headersSchema.optional(),
  body: z.string().max(8192).optional(),
}).strict().optional();

export const errorRouteInputSchema = z.object({
  goal: z.string().trim().min(1).max(500).optional(),
  request: requestSchema,
  response: responseSchema,
  error: z.string().max(2048).optional(),
  attempt: z.number().int().min(1).max(100).optional(),
}).strict().superRefine((input, context) => {
  if (!input.request && !input.response && !input.error) context.addIssue({ code: 'custom', message: 'Provide a failed request, response, or error.' });
});

export const errorRouteOutputSchema = z.object({
  classification: errorClassificationSchema,
  retry: retryGuidanceSchema,
  safe_to_retry: z.boolean(),
  next_action: z.object({ type: nextActionTypeSchema, instruction: z.string().min(1).max(240), changes: z.array(z.string().max(160)).max(4) }).strict(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.object({ signal: z.string().max(40), value: z.union([z.string().max(160), z.number(), z.boolean()]) }).strict()).max(8),
  limits: z.array(z.string().max(180)).max(6),
  tool_version: z.string(),
}).strict();

export type ErrorRouteInput = z.infer<typeof errorRouteInputSchema>;
export type ErrorRouteOutput = z.infer<typeof errorRouteOutputSchema>;
