import type { ToolTelemetryEvent } from './telemetry.js';
import { toolRegistry } from './registry.js';

const toolIds = new Set(toolRegistry.map((tool) => tool.id));
const modes = new Set(['disabled', 'test', 'production']);
const channels = new Set(['http', 'mcp']);
const paymentStates = new Set(['free', 'challenged', 'settled', 'settlement_failed', 'settlement_unconfirmed']);
const clientFamilies = new Set(['browser', 'curl', 'node', 'python', 'mcp', 'other']);
const categoryPattern = /^[a-z][a-z0-9_]{0,63}$/;

type AcceptedEvent = ToolTelemetryEvent & { payer_fingerprint?: string };
type Group = { events: AcceptedEvent[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseEvent(value: unknown): AcceptedEvent | undefined {
  if (!isRecord(value) || value['event'] !== 'fallback.tool_call' || value['schema_version'] !== 1) return undefined;
  const mode = value['payment_mode'];
  const channel = value['channel'];
  const state = value['payment_state'];
  const toolId = value['tool_id'];
  const price = value['price_usd'];
  const latency = value['latency_ms'];
  if (typeof mode !== 'string' || !modes.has(mode) || typeof channel !== 'string' || !channels.has(channel)
    || typeof state !== 'string' || !paymentStates.has(state) || typeof toolId !== 'string' || !toolIds.has(toolId)
    || typeof price !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(price)
    || typeof latency !== 'number' || !Number.isFinite(latency) || latency < 0) return undefined;
  const payer = value['payer_fingerprint'];
  const client = value['client_family'];
  return {
    event: 'fallback.tool_call', schema_version: 1, at: typeof value['at'] === 'string' ? value['at'] : '',
    tool_id: toolId, channel: channel as AcceptedEvent['channel'], payment_mode: mode as AcceptedEvent['payment_mode'],
    payment_state: state as AcceptedEvent['payment_state'], price_usd: price, latency_ms: latency,
    client_family: typeof client === 'string' && clientFamilies.has(client) ? client : 'other',
    ...(typeof value['result_category'] === 'string' && categoryPattern.test(value['result_category']) ? { result_category: value['result_category'] } : {}),
    ...(typeof value['error_category'] === 'string' && categoryPattern.test(value['error_category']) ? { error_category: value['error_category'] } : {}),
    ...(typeof value['abstained'] === 'boolean' ? { abstained: value['abstained'] } : {}),
    ...(typeof payer === 'string' && /^[\da-f]{64}$/i.test(payer) ? { payer_fingerprint: payer.toLowerCase() } : {}),
  };
}

function usdMicros(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}

function formatUsd(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number((sorted[Math.ceil(percentileValue * sorted.length) - 1] ?? 0).toFixed(2));
}

export function summarizeTelemetryLines(lines: Iterable<string>) {
  const groups = new Map<string, Group>();
  const payerCalls = new Map<string, Map<string, number>>();
  let ignoredLines = 0;
  let acceptedEvents = 0;
  for (const line of lines) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { ignoredLines += 1; continue; }
    const event = parseEvent(value);
    if (!event) { ignoredLines += 1; continue; }
    acceptedEvents += 1;
    const key = `${event.payment_mode}\u0000${event.channel}\u0000${event.tool_id}`;
    const group = groups.get(key) ?? { events: [] };
    group.events.push(event);
    groups.set(key, group);
    if (event.payment_state === 'settled' && event.payer_fingerprint) {
      const payers = payerCalls.get(event.payment_mode) ?? new Map<string, number>();
      payers.set(event.payer_fingerprint, (payers.get(event.payer_fingerprint) ?? 0) + 1);
      payerCalls.set(event.payment_mode, payers);
    }
  }

  const byTool = [...groups.entries()].map(([key, group]) => {
    const [paymentMode, channel, toolId] = key.split('\u0000') as [AcceptedEvent['payment_mode'], AcceptedEvent['channel'], string];
    const events = group.events;
    const settled = events.filter((event) => event.payment_state === 'settled');
    const challenges = events.filter((event) => event.payment_state === 'challenged').length;
    const results: Record<string, number> = {};
    const errors: Record<string, number> = {};
    const clients: Record<string, number> = {};
    for (const event of events) {
      if (event.result_category) results[event.result_category] = (results[event.result_category] ?? 0) + 1;
      if (event.error_category) errors[event.error_category] = (errors[event.error_category] ?? 0) + 1;
      clients[event.client_family] = (clients[event.client_family] ?? 0) + 1;
    }
    const micros = settled.reduce((sum, event) => sum + usdMicros(event.price_usd), 0n);
    const latencies = events.map((event) => event.latency_ms);
    return {
      payment_mode: paymentMode, channel, tool_id: toolId,
      requests: events.length, paid_calls: settled.length, challenged_requests: challenges,
      settled_to_challenge_ratio: challenges ? Number((settled.length / challenges).toFixed(4)) : null,
      estimated_revenue_usd: formatUsd(micros),
      abstentions: events.filter((event) => event.abstained === true).length,
      result_distribution: Object.fromEntries(Object.entries(results).sort(([a], [b]) => a.localeCompare(b))),
      error_distribution: Object.fromEntries(Object.entries(errors).sort(([a], [b]) => a.localeCompare(b))),
      latency_ms: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
      client_family: Object.fromEntries(Object.entries(clients).sort(([a], [b]) => a.localeCompare(b))),
    };
  }).sort((a, b) => `${a.payment_mode}/${a.channel}/${a.tool_id}`.localeCompare(`${b.payment_mode}/${b.channel}/${b.tool_id}`));

  const payerSummary = Object.fromEntries([...payerCalls.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mode, payers]) => {
    const repeats = [...payers.values()].filter((count) => count >= 2).length;
    return [mode, { unique_payer_fingerprints: payers.size, repeat_payers: repeats, repeat_payer_rate: payers.size ? Number((repeats / payers.size).toFixed(4)) : null }];
  }));
  return { schema_version: 1, accepted_events: acceptedEvents, ignored_lines: ignoredLines, payer_summary_by_mode: payerSummary, by_tool: byTool };
}

export function summarizeUsageLines(lines: Iterable<string>, internalPayerFingerprints: ReadonlySet<string>) {
  const events: AcceptedEvent[] = [];
  let ignoredLines = 0;
  for (const line of lines) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { ignoredLines += 1; continue; }
    const event = parseEvent(value);
    if (!event) { ignoredLines += 1; continue; }
    events.push(event);
  }

  const paid = events.filter((event) => event.payment_state === 'settled');
  const organicPaid = paid.filter((event) => event.payer_fingerprint && !internalPayerFingerprints.has(event.payer_fingerprint));
  const internalPaid = paid.filter((event) => event.payer_fingerprint && internalPayerFingerprints.has(event.payer_fingerprint));
  const unclassifiedPaid = paid.filter((event) => !event.payer_fingerprint);
  const organicPayerCalls = new Map<string, number>();
  for (const event of organicPaid) {
    const fingerprint = event.payer_fingerprint!;
    organicPayerCalls.set(fingerprint, (organicPayerCalls.get(fingerprint) ?? 0) + 1);
  }

  const paidCallsByTool: Record<string, { all_paid_calls: number; organic_paid_calls: number }> = {};
  const transportCounts: Record<string, { all_paid_calls: number; organic_paid_calls: number }> = {
    http: { all_paid_calls: 0, organic_paid_calls: 0 },
    mcp: { all_paid_calls: 0, organic_paid_calls: 0 },
  };
  const resultDistribution: Record<string, number> = {};
  const allResultDistribution: Record<string, number> = {};
  let organicAbstentions = 0;
  let allAbstentions = 0;
  for (const event of paid) {
    const tool = paidCallsByTool[event.tool_id] ?? { all_paid_calls: 0, organic_paid_calls: 0 };
    tool.all_paid_calls += 1;
    paidCallsByTool[event.tool_id] = tool;
    transportCounts[event.channel]!.all_paid_calls += 1;
  }
  for (const event of events) {
    if (event.result_category) allResultDistribution[event.result_category] = (allResultDistribution[event.result_category] ?? 0) + 1;
    if (event.abstained) allAbstentions += 1;
  }
  for (const event of organicPaid) {
    paidCallsByTool[event.tool_id]!.organic_paid_calls += 1;
    transportCounts[event.channel]!.organic_paid_calls += 1;
    if (event.result_category) resultDistribution[event.result_category] = (resultDistribution[event.result_category] ?? 0) + 1;
    if (event.abstained) organicAbstentions += 1;
  }
  const totalRevenue = paid.reduce((sum, event) => sum + usdMicros(event.price_usd), 0n);
  const organicRevenue = organicPaid.reduce((sum, event) => sum + usdMicros(event.price_usd), 0n);

  return {
    since_filtered_calls: events.length,
    total_calls: events.length,
    paid_calls: paid.length,
    internal_paid_calls_excluded_from_organic: internalPaid.length,
    paid_calls_without_payer_fingerprint: unclassifiedPaid.length,
    organic_paid_calls: organicPaid.length,
    unique_organic_payer_fingerprints: organicPayerCalls.size,
    returning_organic_payers: [...organicPayerCalls.values()].filter((count) => count > 1).length,
    revenue_usd: formatUsd(totalRevenue),
    organic_revenue_usd: formatUsd(organicRevenue),
    paid_calls_by_tool: Object.fromEntries(Object.entries(paidCallsByTool).sort(([a], [b]) => a.localeCompare(b))),
    paid_calls_by_transport: transportCounts,
    all_result_distribution: Object.fromEntries(Object.entries(allResultDistribution).sort(([a], [b]) => a.localeCompare(b))),
    all_abstentions: allAbstentions,
    organic_result_distribution: Object.fromEntries(Object.entries(resultDistribution).sort(([a], [b]) => a.localeCompare(b))),
    organic_abstentions: organicAbstentions,
    ignored_lines: ignoredLines,
  };
}
