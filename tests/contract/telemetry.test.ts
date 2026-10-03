import { describe, expect, it } from 'vitest';
import { createToolTelemetry, clientFamily, payerFingerprint, resultTelemetry, type ToolTelemetryEvent } from '../../src/core/telemetry.js';
import { summarizeTelemetryLines } from '../../src/core/telemetry-report.js';

describe('privacy-safe product telemetry', () => {
  it('records aggregate tool result classes without copying caller payloads', () => {
    const events: ToolTelemetryEvent[] = [];
    const telemetry = createToolTelemetry({ emit: (event) => events.push(event) });
    telemetry.record({ tool_id: 'request_repair', channel: 'http', payment_mode: 'test', payment_state: 'free', price_usd: '0.005', latency_ms: 4.6, client_family: clientFamily('python-httpx/1.0'), ...resultTelemetry('request_repair', { success: true, result: { status: 'insufficient_evidence', evidence: [{ signal: 'secret-bearing caller payload must not be copied' }] } }) });
    expect(events[0]).toMatchObject({ tool_id: 'request_repair', result_category: 'insufficient_evidence', abstained: true, client_family: 'python', latency_ms: 5 });
    expect(JSON.stringify(events)).not.toContain('secret-bearing caller payload');
    expect(JSON.stringify(events)).not.toContain('python-httpx/1.0');
  });

  it('uses a keyed fingerprint for settlement payer identity without logging the address', () => {
    const payer = '0x1234567890123456789012345678901234567890';
    const fingerprint = payerFingerprint({ payer }, 'a-telemetry-hmac-secret-that-is-not-the-wallet-key');
    expect(fingerprint).toMatch(/^[\da-f]{64}$/);
    expect(fingerprint).not.toContain(payer);
    expect(payerFingerprint({ payer }, undefined)).toBeUndefined();
  });

  it('summarizes JSONL into reproducible aggregates without returning payer fingerprints', () => {
    const fingerprint = 'a'.repeat(64);
    const base = { event: 'fallback.tool_call', schema_version: 1, at: '2026-01-01T00:00:00.000Z', tool_id: 'error_route', channel: 'http', payment_mode: 'production', price_usd: '0.002', latency_ms: 5, client_family: 'node' };
    const lines = [
      JSON.stringify({ ...base, payment_state: 'challenged' }),
      JSON.stringify({ ...base, payment_state: 'settled', result_category: 'rate_limited', payer_fingerprint: fingerprint }),
      JSON.stringify({ ...base, payment_state: 'settled', result_category: 'rate_limited', payer_fingerprint: fingerprint }),
      JSON.stringify({ ...base, prompt: 'must not be copied', payment_state: 'settled' }),
      'not-json',
    ];
    const report = summarizeTelemetryLines(lines);
    const group = report.by_tool[0];
    expect(report).toMatchObject({ accepted_events: 4, ignored_lines: 1, payer_summary_by_mode: { production: { unique_payer_fingerprints: 1, repeat_payers: 1, repeat_payer_rate: 1 } } });
    expect(group).toMatchObject({ paid_calls: 3, challenged_requests: 1, estimated_revenue_usd: '0.006', result_distribution: { rate_limited: 2 }, latency_ms: { p50: 5, p95: 5 } });
    expect(JSON.stringify(report)).not.toContain(fingerprint);
    expect(JSON.stringify(report)).not.toContain('must not be copied');
  });
});
