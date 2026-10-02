import { describe, expect, it } from 'vitest';
import { classifyErrorRoute, redactHeaders, redactSensitiveText } from '../../src/tools/error-route/handler.js';
import { errorRouteInputSchema } from '../../src/tools/error-route/contract.js';
import { benchmarkNow, errorRouteCases } from '../fixtures/error-route-cases.js';

describe('error_route deterministic classifier', () => {
  it('meets every clear labeled classification and retry expectation', () => {
    for (const testCase of errorRouteCases) {
      const result = classifyErrorRoute(testCase.input, benchmarkNow);
      expect(result.classification, testCase.id).toBe(testCase.classification);
      expect(result.retry, testCase.id).toBe(testCase.retry);
      expect(result.safe_to_retry, testCase.id).toBe(testCase.safe);
    }
  });

  it('redacts credential headers and secret-like text without echoing payloads', () => {
    const headers = redactHeaders({ Authorization: 'Bearer abc.def.secret', Cookie: 'session=private', 'X-API-Key': 'sk-abcdefghijklmnop', 'content-type': 'application/json' });
    expect(headers['Authorization']).toBe('[REDACTED]');
    expect(headers['Cookie']).toBe('[REDACTED]');
    expect(headers['X-API-Key']).toBe('[REDACTED]');
    expect(headers['content-type']).toBe('application/json');
    expect(redactSensitiveText('Authorization: Bearer abc.def.secret api_key=sk-abcdefghijklmnop')).not.toContain('abc.def.secret');
    expect(redactSensitiveText('{"api_key":"sk-abcdefghijklmnop","cookie":"session-private"}')).not.toContain('sk-abcdefghijklmnop');
    expect(redactSensitiveText('{"api_key":"sk-abcdefghijklmnop","cookie":"session-private"}')).not.toContain('session-private');
    const result = classifyErrorRoute({ response: { status: 400, headers: { Authorization: 'Bearer private-value' }, body: 'api_key=sk-abcdefghijklmnop invalid input' } });
    expect(JSON.stringify(result)).not.toContain('private-value');
    expect(JSON.stringify(result)).not.toContain('sk-abcdefghijklmnop');
    expect(JSON.stringify(result)).not.toContain('api_key=');
  });

  it('accepts concise error-only input and rejects missing evidence and oversized bodies', () => {
    expect(errorRouteInputSchema.parse({ error: 'ECONNRESET' }).error).toBe('ECONNRESET');
    expect(() => errorRouteInputSchema.parse({})).toThrow();
    expect(() => errorRouteInputSchema.parse({ response: { status: 400, body: 'x'.repeat(8193) } })).toThrow();
    expect(() => errorRouteInputSchema.parse({ request: { headers: Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`x-${i}`, 'v'])) } })).toThrow();
  });
});
