import { successResponse } from '../../core/response.js';
import type { ToolHandler } from '../../core/tool.js';
import { errorRouteInputSchema, errorRouteOutputSchema, type ErrorRouteInput, type ErrorRouteOutput } from './contract.js';

const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$/i;
const BLOCKING_TEXT = /captcha|challenge-platform|checking your browser|verify you are human|cf-chl|cloudflare ray id|bot detection|access denied.*automated/i;
const TLS_TEXT = /certificate verify failed|self[- ]signed certificate|unable to verify the first certificate|tls handshake|ssl certificate|cert_has_expired|err_cert_/i;
const DNS_TEXT = /enotfound|eai_again|name or service not known|temporary failure in name resolution|dns lookup|no such host/i;
const TIMEOUT_TEXT = /timed? ?out|timeout|etimedout|aborted/i;
const CONNECTION_REFUSED_TEXT = /econnrefused|connection refused/i;
const CONNECTION_TEXT = /econnreset|connection reset|socket hang up|network unreachable|ehostunreach/i;
const SECRET_TEXT_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\x2f-]+=*/gi,
  /\b(Basic)\s+[A-Za-z0-9+/=]+/gi,
  /("(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)"\s*:\s*")[^"]*(")/gi,
  /\b(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|x-auth-token|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[:=]\s*[^\s,;"']+/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
];

function structuredErrorText(body: string | undefined): string {
  if (!body) return '';
  try {
    const parsed: unknown = JSON.parse(body);
    const values: string[] = [];
    const visit = (value: unknown, depth: number): void => {
      if (depth > 4 || values.length >= 24 || !value || typeof value !== 'object') return;
      if (Array.isArray(value)) { for (const item of value.slice(0, 12)) visit(item, depth + 1); return; }
      for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
        if (/^(code|type|error|message|detail|title|reason|status)$/i.test(key) && typeof entry === 'string') values.push(redactSensitiveText(entry).slice(0, 240));
        else if (entry && typeof entry === 'object') visit(entry, depth + 1);
        if (values.length >= 24) break;
      }
    };
    visit(parsed, 0);
    return values.join(' ');
  } catch { return ''; }
}

export function redactSensitiveText(value: string): string {
  return SECRET_TEXT_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[REDACTED]'), value.slice(0, 8192));
}

export function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(Object.entries(headers).slice(0, 40).map(([key, value]) => [key.slice(0, 128), SECRET_HEADER.test(key) ? '[REDACTED]' : redactSensitiveText(value).slice(0, 2048)]));
}

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined || SECRET_HEADER.test(key) ? undefined : redactSensitiveText(headers[key] ?? '');
}

function retryAfterSeconds(value: string | undefined, now: Date): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{1,6}$/.test(trimmed)) return Math.min(3600, Number(trimmed));
  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.min(3600, Math.ceil((date - now.getTime()) / 1000)));
}

type Decision = Pick<ErrorRouteOutput, 'classification' | 'retry' | 'safe_to_retry' | 'next_action' | 'confidence'>;

function decide(input: ErrorRouteInput, now: Date): Decision {
  const status = input.response?.status;
  const responseHeaders = redactHeaders(input.response?.headers);
  const text = redactSensitiveText(`${input.response?.body ?? ''}\n${structuredErrorText(input.response?.body)}\n${input.error ?? ''}`).toLowerCase();
  const contentType = headerValue(responseHeaders, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  const retryAfter = retryAfterSeconds(headerValue(responseHeaders, 'retry-after'), now);
  const set = (classification: ErrorRouteOutput['classification'], retry: ErrorRouteOutput['retry'], safe: boolean, action: ErrorRouteOutput['next_action']['type'], instruction: string, confidence: number): Decision => ({
    classification, retry, safe_to_retry: safe, next_action: { type: action, instruction, changes: [] }, confidence,
  });

  if (TLS_TEXT.test(text)) return set('tls_failure', 'never', false, 'escalate', 'Stop retrying and verify the endpoint certificate through a trusted channel; never bypass certificate validation.', 0.99);
  if (DNS_TEXT.test(text)) return set('dns_failure', 'after_delay', true, 'wait', 'Check local DNS resolution and retry once after a short delay; this signal does not establish that the endpoint is invalid.', 0.97);
  if (CONNECTION_REFUSED_TEXT.test(text) || CONNECTION_TEXT.test(text)) return set('connection_failure', 'after_delay', true, 'wait', 'Check service availability and network reachability, then retry once after a short delay.', 0.95);
  if (TIMEOUT_TEXT.test(text) || status === 408 || status === 504) return set('timeout', 'after_delay', true, 'wait', 'Retry once after a short backoff; stop if the request times out again.', 0.94);

  if (BLOCKING_TEXT.test(text)) return set('blocked_or_challenged', 'never', false, 'stop_retrying', 'Do not retry or attempt to bypass the challenge; use an approved access path or escalate.', 0.96);
  if (status === 401 || /\bunauthorized\b|authentication required|missing credentials|invalid[_ ](?:api[_ ]?)?key|invalid token|authentication_error/i.test(text)) return set('authentication_required', 'after_auth', true, 'authenticate', 'Obtain or refresh credentials through the authorized flow, then retry once.', status === 401 ? 0.97 : 0.83);
  if (status === 403) return set('authorization_denied', 'never', false, 'escalate', 'Do not repeat the same request; check the account permissions or ask the resource owner.', 0.91);

  if (status === 402) {
    if (/payment failed|settlement failed|invalid payment|insufficient funds|payment signature/i.test(text)) return set('payment_failed', 'after_payment', true, 'pay', 'Resolve the payment failure or fund the authorized test wallet before retrying.', 0.96);
    return set('payment_required', 'after_payment', true, 'pay', 'Review the payment requirement and use an authorized payment flow before retrying.', 0.94);
  }
  if (status === 429) {
    if (/quota|usage limit|billing limit|credits? exhausted|insufficient[_ ]quota/i.test(text)) return set('quota_exhausted', retryAfter === undefined ? 'after_change' : 'after_delay', retryAfter !== undefined, retryAfter === undefined ? 'stop_retrying' : 'wait', retryAfter === undefined ? 'Stop retries and check quota or billing reset details.' : `Wait at least ${retryAfter} seconds as indicated by Retry-After, then reduce request rate.`, 0.95);
    return set('rate_limited', 'after_delay', true, 'reduce_rate', retryAfter === undefined ? 'Reduce request rate and retry once after a conservative backoff.' : `Wait at least ${retryAfter} seconds as indicated by Retry-After, then retry once at a lower rate.`, 0.96);
  }
  if (status === 400 || status === 422) {
    if (/unknown (field|property|parameter)|invalid (field|property|parameter)|not a valid (field|property|parameter)|unexpected (field|property)|additional propert|does not match (the )?schema|schema mismatch|expected .* (got|received)/i.test(text)) return set('schema_mismatch', 'after_change', true, 'inspect_schema', 'Inspect the documented request schema and compare it with the submitted fields before retrying.', 0.94);
    return set('invalid_input', 'after_change', true, 'modify_request', 'Check the endpoint’s documented constraints and correct the supplied values before retrying.', 0.88);
  }
  if (status === 404) return set('not_found', 'after_change', false, 'change_endpoint', 'Verify the resource path or identifier; do not repeat the same request unchanged.', 0.91);
  if (status === 405) return set('method_not_allowed', 'after_change', true, 'modify_request', 'Check the endpoint’s documented HTTP methods before retrying.', 0.94);
  if (status === 415) return set('unsupported_media_type', 'after_change', true, 'modify_request', 'Check the accepted Content-Type and encode the body accordingly before retrying.', 0.94);
  if (status === 409) {
    if (/stale|version mismatch|etag|precondition|out of date/i.test(text)) return set('stale_state', 'after_change', true, 'modify_request', 'Refresh the resource state or version token, then retry with the current state.', 0.9);
    return set('conflict', 'after_change', false, 'escalate', 'Inspect the conflicting resource state before deciding whether a retry is safe.', 0.87);
  }
  if (status === 503) return set('service_unavailable', 'after_delay', true, 'wait', 'Wait briefly and retry once; stop if the service remains unavailable.', 0.95);
  if (status === 502 || status === 500 || status === 501 || status === 505 || status !== undefined && status >= 500) return set('upstream_failure', 'after_delay', true, 'wait', 'Retry once after a short backoff; stop if the upstream continues failing.', 0.9);
  if (contentType === 'application/json' && input.response?.body) {
    try { JSON.parse(input.response.body); }
    catch { return set('malformed_response', 'after_change', false, 'escalate', 'The response is not valid JSON as declared; preserve the response safely and escalate to the endpoint owner.', 0.86); }
  }
  return set('unknown', 'unknown', false, 'unknown', 'Do not retry blindly; inspect the safe error context or escalate for further diagnosis.', 0.3);
}

export function classifyErrorRoute(rawInput: unknown, now = new Date()): ErrorRouteOutput {
  const input = errorRouteInputSchema.parse(rawInput);
  const decision = decide(input, now);
  const evidence: ErrorRouteOutput['evidence'] = [];
  if (input.response?.status !== undefined) evidence.push({ signal: 'http_status', value: input.response.status });
  const contentType = headerValue(input.response?.headers, 'content-type');
  if (contentType) evidence.push({ signal: 'content_type', value: contentType.split(';', 1)[0]?.slice(0, 80) ?? 'present' });
  const wwwAuthenticate = headerValue(input.response?.headers, 'www-authenticate');
  if (wwwAuthenticate) evidence.push({ signal: 'www_authenticate', value: 'present' });
  const retryAfterHeader = headerValue(input.response?.headers, 'retry-after');
  if (retryAfterHeader) {
    const seconds = retryAfterSeconds(retryAfterHeader, now);
    if (seconds !== undefined) evidence.push({ signal: 'retry_after_seconds', value: seconds });
  }
  const combined = `${input.response?.body ?? ''}\n${input.error ?? ''}`;
  const networkCode = combined.match(/\b(ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|CERT_HAS_EXPIRED|ERR_CERT_[A-Z_]+)\b/i)?.[1]?.toUpperCase();
  if (networkCode) evidence.push({ signal: 'network_error_code', value: networkCode.slice(0, 40) });
  if (evidence.length === 0) evidence.push({ signal: 'available_context', value: input.error ? 'error text provided' : input.response?.body ? 'response text provided' : 'request context provided' });
  const limits = ['Raw request and response content is not included in the result or telemetry.', 'This deterministic classifier does not verify endpoint documentation or infer exact request edits.'];
  if (retryAfterHeader && retryAfterSeconds(retryAfterHeader, now) === undefined) limits.push('Retry-After was malformed; no delay was inferred.');
  return errorRouteOutputSchema.parse({ ...decision, evidence: evidence.slice(0, 8), limits, tool_version: '0.1.0-beta.1' });
}

export const handleErrorRoute: ToolHandler<typeof errorRouteInputSchema, typeof errorRouteOutputSchema> = async (input, context) => {
  const startedAt = new Date();
  const result = classifyErrorRoute(input);
  return successResponse({ toolId: 'error_route', toolVersion: result.tool_version, requestId: context.requestId, result, startedAt });
};
