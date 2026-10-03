import { successResponse } from '../../core/response.js';
import type { ToolHandler } from '../../core/tool.js';
import { redactHeaders, redactSensitiveText } from '../error-route/handler.js';
import { errorClassificationSchema } from '../error-route/contract.js';
import { requestRepairInputSchema, requestRepairOutputSchema, type RequestRepairInput, type RequestRepairOutput } from './contract.js';

type JsonObject = Record<string, unknown>;
type JsonSchema = JsonObject & { properties?: JsonObject; required?: string[]; additionalProperties?: boolean; type?: string; enum?: unknown[] };
type Change = RequestRepairOutput['changes'][number];
type Evidence = RequestRepairOutput['evidence'][number];
type SchemaView = { body?: JsonSchema; parameters: Array<{ name: string; in: string; schema?: JsonSchema; required?: boolean }>; conflict: boolean };

const SECRET_KEY = /(?:authorization|proxy.?authorization|cookie|password|passwd|secret|token|api.?key|access.?key|credential|private.?key)/i;
const LIMITS = [
  'This tool only transforms caller-supplied data and does not send or retry requests.',
  'Review the proposed request before sending it; response text and schemas are treated only as bounded evidence.',
];

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeJson(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[OMITTED: depth limit]';
  if (typeof value === 'string') return redactSensitiveText(value).slice(0, 8192);
  if (Array.isArray(value)) return value.slice(0, 256).map((entry) => sanitizeJson(entry, depth + 1));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).slice(0, 256).map(([key, entry]) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : sanitizeJson(entry, depth + 1)]));
  return value;
}

function sanitizeUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (url.username) url.username = '[REDACTED]';
    if (url.password) url.password = '[REDACTED]';
    for (const key of url.searchParams.keys()) if (SECRET_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
    return url.toString();
  } catch { return redactSensitiveText(value).slice(0, 2048); }
}

function safeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const redacted = redactHeaders(headers);
  for (const name of Object.keys(headers ?? {})) if (SECRET_KEY.test(name)) redacted[name.slice(0, 128)] = '[REDACTED]';
  return redacted;
}

function safeRequest(request: RequestRepairInput['request']): RequestRepairOutput['original_request'] {
  return {
    ...(request.method ? { method: request.method } : {}),
    ...(request.url ? { url: sanitizeUrl(request.url) } : {}),
    ...(request.headers ? { headers: safeHeaders(request.headers) } : {}),
    ...(request.query ? { query: sanitizeJson(request.query) as JsonObject } : {}),
    ...(request.body !== undefined ? { body: sanitizeJson(request.body) } : {}),
  };
}

function schemaView(raw: unknown): SchemaView {
  if (!isObject(raw)) return { parameters: [], conflict: false };
  const parametersRaw = Array.isArray(raw['parameters']) ? raw['parameters'] : [];
  const parameters = parametersRaw.flatMap((entry) => {
    if (!isObject(entry) || typeof entry['name'] !== 'string' || typeof entry['in'] !== 'string') return [];
    return [{ name: entry['name'], in: entry['in'], ...(isObject(entry['schema']) ? { schema: entry['schema'] as JsonSchema } : {}), required: entry['required'] === true }];
  });
  const parameterNames = new Map<string, string>();
  for (const parameter of parameters) {
    const previous = parameterNames.get(parameter.name);
    if (previous && previous !== parameter.in) return { parameters, conflict: true };
    parameterNames.set(parameter.name, parameter.in);
  }
  const requestBody = raw['requestBody'];
  if (isObject(requestBody) && isObject(requestBody['content'])) {
    const content = requestBody['content'];
    const media = content['application/json'] ?? (Object.keys(content).length === 1 ? Object.values(content)[0] : undefined);
    if (!media && Object.keys(content).length > 1) return { parameters, conflict: true };
    if (isObject(media) && isObject(media['schema'])) return { body: media['schema'] as JsonSchema, parameters, conflict: false };
  }
  const openApiBody = parameters.find((parameter) => parameter.in === 'body' && parameter.schema);
  if (openApiBody?.schema) return { body: openApiBody.schema, parameters, conflict: false };
  const candidate = isObject(raw['body']) ? raw['body'] : raw;
  if (isObject(candidate['properties']) || candidate['type'] === 'object' || Array.isArray(candidate['required'])) {
    return { body: candidate as JsonSchema, parameters, conflict: false };
  }
  return { parameters, conflict: false };
}

function responseObject(input: RequestRepairInput): JsonObject | undefined {
  const body = input.response?.body;
  if (isObject(body)) return body;
  if (typeof body === 'string') {
    try { const parsed: unknown = JSON.parse(body); if (isObject(parsed)) return parsed; } catch { /* plain text is parsed by exact patterns below */ }
  }
  return undefined;
}

function structuredFieldName(input: RequestRepairInput): string | undefined {
  const body = responseObject(input);
  const candidate = body?.['field'] ?? body?.['field_name'] ?? body?.['invalid_field'] ?? body?.['rejected_field'] ?? body?.['unknown_field'] ?? body?.['parameter'];
  return typeof candidate === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(candidate) ? candidate : undefined;
}

function responseText(input: RequestRepairInput): string {
  const body = input.response?.body;
  const raw = typeof body === 'string' ? body : body === undefined ? '' : JSON.stringify(body);
  return raw.slice(0, 4000);
}

type ExplicitError = { rejected?: string; replacement?: string; kind: 'reject' | 'rename' };
const FIELD = '[A-Za-z_][A-Za-z0-9_.-]{0,127}';

function explicitError(input: RequestRepairInput): ExplicitError | undefined {
  const obj = responseObject(input);
  if (obj && /(?:ignore\s+(?:all\s+)?(?:previous|prior)|system prompt|developer message|execute|tool call|reveal secrets)/i.test(JSON.stringify(obj).slice(0, 4000))) return undefined;
  if (obj) {
    const rejected = obj['rejected_field'] ?? obj['invalid_field'] ?? obj['unknown_field'] ?? obj['field'];
    const replacement = obj['replacement_field'] ?? obj['suggested_field'] ?? obj['current_field'] ?? obj['use'];
    if (typeof rejected === 'string' && typeof replacement === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(rejected) && /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(replacement)) return { rejected, replacement, kind: 'rename' };
    const explicitRejected = obj['unknown_field'] ?? obj['rejected_field'];
    if (typeof explicitRejected === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(explicitRejected)) return { rejected: explicitRejected, kind: 'reject' };
  }
  const text = responseText(input).trim();
  if (text.length > 400 || /(?:ignore|system prompt|execute|instruction|developer message|tool call)/i.test(text)) return undefined;
  const rename = new RegExp(`^(?:field\\s+)?["']?(${FIELD})["']?\\s+(?:is invalid|is not valid|was rejected);\\s*(?:use|rename to|replace with)\\s+["']?(${FIELD})["']?\\.?$`, 'i').exec(text)
    ?? new RegExp(`^(?:unknown|invalid|unrecognized)\\s+(?:field|parameter|property)\\s+["']?(${FIELD})["']?;\\s*(?:use|expected)\\s+["']?(${FIELD})["']?\\.?$`, 'i').exec(text);
  if (rename?.[1] && rename[2]) return { rejected: rename[1], replacement: rename[2], kind: 'rename' };
  const reject = new RegExp(`^(?:unknown|unrecognized|unsupported)\\s+(?:field|parameter|property)\\s+["']?(${FIELD})["']?\\.?$`, 'i').exec(text)
    ?? new RegExp(`^(?:field|parameter|property)\\s+["']?(${FIELD})["']?\\s+(?:is not allowed|is not supported|is unknown)\\.?$`, 'i').exec(text);
  if (reject?.[1]) return { rejected: reject[1], kind: 'reject' };
  return undefined;
}

function schemaProperty(schema: JsonSchema | undefined, key: string): JsonSchema | undefined {
  const properties = schema?.properties;
  return properties && isObject(properties[key]) ? properties[key] as JsonSchema : undefined;
}

function isSensitivePath(path: string): boolean {
  return path.split('.').some((segment) => SECRET_KEY.test(segment));
}

function outputValue(value: unknown): unknown {
  return sanitizeJson(value);
}

function addChange(changes: Change[], evidence: Evidence[], change: Change, item: Evidence): void {
  if (isSensitivePath(change.path)) return;
  changes.push(change);
  if (!evidence.some((entry) => entry.source === item.source && entry.signal === item.signal)) evidence.push(item);
}

function insuff(original: RequestRepairOutput['original_request'], limits: string[] = []): RequestRepairOutput {
  return requestRepairOutputSchema.parse({ status: 'insufficient_evidence', original_request: original, changes: [], evidence: [], confidence: 0, safe_to_retry: false, limits: [...LIMITS, ...limits].slice(0, 6) });
}

function propertyTypeRepair(value: unknown, schema: JsonSchema): unknown | undefined {
  const type = schema.type;
  if (type === 'integer' && typeof value === 'string' && /^-?(?:0|[1-9]\d*)$/.test(value)) return Number(value);
  if (type === 'number' && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  if (type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
  return undefined;
}

function isAllowedBySchema(value: unknown, schema: JsonSchema): boolean {
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) return false;
  if (schema.type === 'string') return typeof value === 'string';
  if (schema.type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'object') return isObject(value);
  if (schema.type === 'array') return Array.isArray(value);
  return true;
}

function classification(input: RequestRepairInput): string | undefined {
  const value = input.error_route?.classification;
  if (!value) return undefined;
  return errorClassificationSchema.parse(value);
}

function mediaTypeFromEvidence(input: RequestRepairInput): string | undefined {
  const header = Object.entries(input.response?.headers ?? {}).find(([name]) => /^(accept|accept-patch|x-supported-content-type|supported-content-type)$/i.test(name))?.[1];
  const body = responseObject(input);
  const bodyValue = body?.['supported_content_type'] ?? body?.['supported_media_type'];
  const value = typeof bodyValue === 'string' ? bodyValue : header;
  if (!value || value.includes(',') || !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+(?:\s*;\s*[\w=.+-]+)*$/.test(value.trim())) return undefined;
  return value.trim();
}

function allowMethod(input: RequestRepairInput): string | undefined {
  const header = Object.entries(input.response?.headers ?? {}).find(([name]) => name.toLowerCase() === 'allow')?.[1];
  if (!header) return undefined;
  const methods = [...new Set(header.split(',').map((method) => method.trim().toUpperCase()).filter((method) => /^[A-Z]{1,16}$/.test(method)))];
  return methods.length === 1 ? methods[0] : undefined;
}

export function repairRequest(rawInput: unknown): RequestRepairOutput {
  const input = requestRepairInputSchema.parse(rawInput);
  const original = safeRequest(input.request);
  const result = structuredClone(input.request) as RequestRepairInput['request'];
  const changes: Change[] = [];
  const evidence: Evidence[] = [];
  const schema = schemaView(input.schema);
  const status = input.response?.status;
  const hint = classification(input);
  const fullText = `${responseText(input)} ${input.error ?? ''}`;
  if (['authentication_required', 'authorization_denied', 'dns_failure', 'tls_failure', 'connection_failure', 'payment_failed', 'payment_required', 'rate_limited', 'quota_exhausted', 'conflict', 'blocked_or_challenged'].includes(hint ?? '')
    || status === 401 || status === 403 || status === 404 || status === 409 || status === 429
    || status !== undefined && status >= 500
    || /captcha|verify you are human|bot challenge/i.test(fullText)) {
    const limits = hint === 'rate_limited' || status === 429 ? ['Respect Retry-After and retry later; request contents were not changed.'] : ['The supplied failure class does not justify a request-shape transformation.'];
    return insuff(original, limits);
  }
  if (!input.response && !input.error && !input.error_route) return insuff(original, ['Provide a failed response or a validated error_route classification.']);
  if (schema.conflict) return insuff(original, ['The supplied schema contains conflicting parameter or media-type definitions.']);

  const explicit = status === 400 || status === 422 || input.error ? explicitError(input) : undefined;
  const body = isObject(result.body) ? result.body : undefined;
  const schemaSafeToUse = input.schema !== undefined;
  const schemaFailure = hint === 'schema_mismatch' || hint === 'invalid_input' || explicit !== undefined;
  const fieldFailure = structuredFieldName(input) ?? explicit?.rejected;
  let confidence = 0;

  if (explicit?.kind === 'rename' && explicit.rejected && explicit.replacement && !isSensitivePath(`body.${explicit.rejected}`) && !isSensitivePath(`body.${explicit.replacement}`) && body && Object.hasOwn(body, explicit.rejected) && !Object.hasOwn(body, explicit.replacement)) {
    const targetSchema = schemaProperty(schema.body, explicit.replacement);
    const oldSchema = schemaProperty(schema.body, explicit.rejected);
    if (schemaSafeToUse && (!targetSchema || oldSchema && schema.body?.additionalProperties === false)) return insuff(original, ['The explicit server replacement conflicts with the caller-supplied schema.']);
    const value = body[explicit.rejected];
    if (!targetSchema || isAllowedBySchema(value, targetSchema)) {
      delete body[explicit.rejected];
      body[explicit.replacement] = value;
      addChange(changes, evidence, { path: `body.${explicit.rejected}`, operation: 'remove', reason: 'Server explicitly rejected this field.' }, { source: 'server_error', signal: 'explicit_field_replacement' });
      addChange(changes, evidence, { path: `body.${explicit.replacement}`, operation: 'add', value: outputValue(value), value_source: 'caller_input', reason: 'Server explicitly named this replacement field.' }, { source: 'server_error', signal: 'explicit_field_replacement' });
      confidence = Math.max(confidence, schemaSafeToUse ? 0.98 : 0.94);
    }
  } else if (explicit?.kind === 'reject' && explicit.rejected && !isSensitivePath(`body.${explicit.rejected}`) && body && Object.hasOwn(body, explicit.rejected)) {
    const propertyExists = Boolean(schemaProperty(schema.body, explicit.rejected));
    if (!schemaSafeToUse || schema.body?.additionalProperties === false && !propertyExists) {
      delete body[explicit.rejected];
      addChange(changes, evidence, { path: `body.${explicit.rejected}`, operation: 'remove', reason: 'The server explicitly rejected this field.' }, { source: 'server_error', signal: 'explicit_field_rejection' });
      confidence = Math.max(confidence, schemaSafeToUse ? 0.99 : 0.91);
    } else if (propertyExists) return insuff(original, ['Server rejection conflicts with the supplied request schema.']);
  }

  if (body && schema.body && schema.body.additionalProperties === false && schemaFailure) {
    const properties = schema.body.properties ?? {};
    const unknownKeys = Object.keys(body).filter((key) => !Object.hasOwn(properties, key));
    for (const key of unknownKeys) {
      if (isSensitivePath(`body.${key}`)) continue;
      delete body[key];
      addChange(changes, evidence, { path: `body.${key}`, operation: 'remove', reason: 'The supplied schema forbids additional properties.' }, { source: 'caller_schema', signal: 'schema_rejects_field' });
      confidence = Math.max(confidence, 0.99);
    }
  }

  if (body && schema.body) {
    const required = schema.body.required ?? [];
    for (const key of required) {
      if (Object.hasOwn(body, key)) continue;
      if (!schemaFailure) continue;
      const value = result.query?.[key];
      const property = schemaProperty(schema.body, key);
      if (value === undefined || !property || !isAllowedBySchema(value, property) || isSensitivePath(`body.${key}`)) continue;
      body[key] = value;
      delete result.query?.[key];
      addChange(changes, evidence, { path: `body.${key}`, operation: 'move', value: outputValue(value), value_source: 'caller_input', reason: 'The schema requires this field and its value was already supplied in the query.' }, { source: 'caller_schema', signal: 'required_value_available' });
      addChange(changes, evidence, { path: `query.${key}`, operation: 'remove', reason: 'The supplied schema places this value in the request body.' }, { source: 'caller_schema', signal: 'schema_parameter_location' });
      confidence = Math.max(confidence, 0.98);
    }
    for (const [key, value] of Object.entries(body)) {
      const property = schemaProperty(schema.body, key);
      if (!property || isAllowedBySchema(value, property) || !schemaFailure || fieldFailure && fieldFailure !== key) continue;
      const normalized = propertyTypeRepair(value, property);
      if (normalized === undefined || !isAllowedBySchema(normalized, property) || isSensitivePath(`body.${key}`)) continue;
      body[key] = normalized;
      addChange(changes, evidence, { path: `body.${key}`, operation: 'replace', value: outputValue(normalized), value_source: 'caller_schema', reason: `The caller schema requires a ${property.type} value.` }, { source: 'caller_schema', signal: 'schema_scalar_type' });
      confidence = Math.max(confidence, 0.98);
    }
  }

  for (const parameter of schema.parameters) {
    if (!schemaFailure || parameter.in !== 'query' || !body || !Object.hasOwn(body, parameter.name) || !Object.hasOwn(responseObject(input) ?? {}, 'parameter_location') && hint !== 'schema_mismatch' && hint !== 'invalid_input' || isSensitivePath(`body.${parameter.name}`)) continue;
    const value = body[parameter.name];
    if (result.query?.[parameter.name] !== undefined) continue;
    result.query ??= {};
    result.query[parameter.name] = value;
    delete body[parameter.name];
    addChange(changes, evidence, { path: `query.${parameter.name}`, operation: 'move', value: outputValue(value), value_source: 'caller_schema', reason: 'The OpenAPI parameter location is query.' }, { source: 'caller_schema', signal: 'schema_parameter_location' });
    addChange(changes, evidence, { path: `body.${parameter.name}`, operation: 'remove', reason: 'The OpenAPI parameter location is query.' }, { source: 'caller_schema', signal: 'schema_parameter_location' });
    confidence = Math.max(confidence, 0.98);
  }

  if (status === 415) {
    const supported = mediaTypeFromEvidence(input);
    const currentHeader = Object.keys(result.headers ?? {}).find((name) => name.toLowerCase() === 'content-type');
    if (supported && (!currentHeader || result.headers?.[currentHeader] !== supported)) {
      const headerName = currentHeader ?? 'content-type';
      result.headers ??= {};
      result.headers[headerName] = supported;
      addChange(changes, evidence, { path: `headers.${headerName}`, operation: currentHeader ? 'replace' : 'add', value: supported, value_source: 'response_header', reason: 'The 415 response explicitly listed this supported media type.' }, { source: 'response_header', signal: 'supported_content_type' });
      confidence = Math.max(confidence, 0.97);
    }
  }

  if (status === 405 && input.constraints.allow_method_change && result.method) {
    const allowed = allowMethod(input);
    if (allowed && result.method.toUpperCase() !== allowed) {
      result.method = allowed;
      addChange(changes, evidence, { path: 'method', operation: 'replace', value: allowed, value_source: 'response_header', reason: 'The Allow header names exactly one supported method.' }, { source: 'response_header', signal: 'allow_header_single_method' });
      confidence = Math.max(confidence, 0.97);
    }
  }

  if (changes.length === 0) return insuff(original, ['No unique, evidence-supported request change was found.']);
  if (changes.length > 3) return insuff(original, ['The justified repair exceeds the three-change budget and requires manual review.']);
  const safeRepaired: RequestRepairOutput['repaired_request'] = {
    ...(result.method ? { method: result.method } : {}),
    ...(result.url ? { url: sanitizeUrl(result.url) } : {}),
    ...(result.headers ? { headers: safeHeaders(result.headers) } : {}),
    ...(result.query ? { query: sanitizeJson(result.query) as JsonObject } : {}),
    ...(result.body !== undefined ? { body: sanitizeJson(result.body) } : {}),
  };
  return requestRepairOutputSchema.parse({
    status: 'repair_available', original_request: original, repaired_request: safeRepaired,
    changes: changes.slice(0, 3), evidence: evidence.slice(0, 8), confidence,
    safe_to_retry: true, limits: LIMITS,
  });
}

export const handleRequestRepair: ToolHandler<typeof requestRepairInputSchema, typeof requestRepairOutputSchema> = async (input, context) => {
  const startedAt = new Date();
  const result = repairRequest(input);
  return successResponse({ toolId: 'request_repair', toolVersion: '0.1.0-beta.1', requestId: context.requestId, result, startedAt });
};
