import { createHmac } from 'node:crypto';
import { decodePaymentResponseHeader } from '@x402/core/http';
import type { ToolRecord } from './registry.js';

export type TelemetryChannel = 'http' | 'mcp';
export type PaymentState = 'free' | 'challenged' | 'settled' | 'settlement_failed' | 'settlement_unconfirmed';
export type ToolTelemetryEvent = {
  event: 'fallback.tool_call';
  schema_version: 1;
  at: string;
  tool_id: string;
  channel: TelemetryChannel;
  payment_mode: 'disabled' | 'test' | 'production';
  payment_state: PaymentState;
  price_usd: string;
  latency_ms: number;
  result_category?: string;
  error_category?: string;
  abstained?: boolean;
  client_family: string;
  payer_fingerprint?: string;
};

export type ToolTelemetry = { record: (event: Omit<ToolTelemetryEvent, 'event' | 'schema_version' | 'at'> & { at?: string }) => void };

const safeCategory = /^[a-z][a-z0-9_]{0,63}$/;

export function clientFamily(userAgent: string | undefined): string {
  const value = (userAgent ?? '').slice(0, 512).toLowerCase();
  if (/modelcontextprotocol|mcp[-/ ]sdk/.test(value)) return 'mcp';
  if (/python|httpx|requests\//.test(value)) return 'python';
  if (/curl\//.test(value)) return 'curl';
  if (/node\.js|undici|axios\//.test(value)) return 'node';
  if (/mozilla\//.test(value)) return 'browser';
  return 'other';
}

export function resultTelemetry(toolId: string, envelope: unknown): Pick<ToolTelemetryEvent, 'result_category' | 'error_category' | 'abstained'> {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return {};
  const root = envelope as Record<string, unknown>;
  if (root['success'] === false) {
    const error = root['error'];
    const code = error && typeof error === 'object' ? (error as Record<string, unknown>)['code'] : undefined;
    return typeof code === 'string' && safeCategory.test(code.toLowerCase()) ? { error_category: code.toLowerCase() } : {};
  }
  const result = root['result'] && typeof root['result'] === 'object' ? root['result'] as Record<string, unknown> : root;
  const key = toolId === 'error_route' ? 'classification'
    : toolId === 'request_repair' ? 'status'
      : toolId === 'stop_search' ? 'decision'
        : toolId === 'source_route' ? 'status' : undefined;
  const category = key ? result[key] : undefined;
  if (typeof category !== 'string' || !safeCategory.test(category)) return {};
  return {
    result_category: category,
    ...(toolId === 'request_repair' && category === 'insufficient_evidence' || toolId === 'stop_search' && category === 'insufficient_evidence' ? { abstained: true } : {}),
  };
}

export function decodePaymentResponse(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      const result = decodePaymentResponseHeader(value);
      return result && typeof result === 'object' ? result as Record<string, unknown> : undefined;
    } catch { return undefined; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function payerFingerprint(paymentResponse: Record<string, unknown> | undefined, secret: string | undefined): string | undefined {
  if (!paymentResponse || !secret || typeof paymentResponse['payer'] !== 'string' || !/^0x[\da-f]{40}$/i.test(paymentResponse['payer'])) return undefined;
  return createHmac('sha256', secret).update(paymentResponse['payer'].toLowerCase()).digest('hex');
}

export function createToolTelemetry(options: { payerHmacKey?: string; emit?: (event: ToolTelemetryEvent) => void } = {}): ToolTelemetry {
  const emit = options.emit ?? ((event) => process.stdout.write(`${JSON.stringify(event)}\n`));
  return { record(event) {
    const safe: ToolTelemetryEvent = {
      event: 'fallback.tool_call', schema_version: 1, at: event.at ?? new Date().toISOString(),
      tool_id: event.tool_id, channel: event.channel, payment_mode: event.payment_mode, payment_state: event.payment_state,
      price_usd: event.price_usd, latency_ms: Number.isFinite(event.latency_ms) ? Math.max(0, Math.round(event.latency_ms)) : 0,
      client_family: event.client_family,
      ...(event.result_category ? { result_category: event.result_category } : {}),
      ...(event.error_category ? { error_category: event.error_category } : {}),
      ...(event.abstained === undefined ? {} : { abstained: event.abstained }),
      ...(event.payer_fingerprint && /^[\da-f]{64}$/.test(event.payer_fingerprint) ? { payer_fingerprint: event.payer_fingerprint } : {}),
    };
    try { emit(safe); } catch { /* Telemetry must never disrupt tool delivery. */ }
  } };
}

export function telemetryPrice(tool: ToolRecord | undefined): string {
  return tool?.priceUsd ?? '0';
}
