import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { createSourceRouteHandler } from '../src/tools/source-route/handler.js';
import { configuredSearchProvider } from '../src/tools/source-route/search-provider.js';
import { safeFetcher } from '../src/core/safe-fetch.js';

type EvalCase = { id: string; goal: string; domain?: string; preferred_formats?: Array<'json' | 'csv' | 'xml' | 'rss' | 'api' | 'bulk_download' | 'html'>; acceptable_route_types: string[]; expected_domains?: string[]; notes: string };
type Row = Record<string, unknown>;
const args = process.argv.slice(2);
const searchEnabled = args.includes('--search');
const providerIndex = args.indexOf('--provider');
const explicitProvider = providerIndex >= 0 ? args[providerIndex + 1] : undefined;
if (explicitProvider && !['tavily', 'brave'].includes(explicitProvider)) throw new Error('--provider must be tavily or brave.');
if (explicitProvider && !searchEnabled) throw new Error('--provider requires explicit --search.');
const env: NodeJS.ProcessEnv = { ...process.env, ...(explicitProvider ? { SEARCH_PROVIDER: explicitProvider } : {}) };
const provider = searchEnabled ? configuredSearchProvider(env) : undefined;
if (searchEnabled && !provider) throw new Error('Provider-enabled evaluation requires --search and configured provider credentials.');
const cases = JSON.parse(await readFile(resolve('evaluation/source-route-cases.json'), 'utf8')) as EvalCase[];
const handler = createSourceRouteHandler({ fetcher: safeFetcher, ...(provider ? { searchProvider: provider } : {}) });
const rows: Row[] = [];
for (const testCase of cases) {
  const started = performance.now();
  try {
    const input = { goal: testCase.goal, ...(testCase.domain ? { domain: testCase.domain.split('/')[0] } : {}), ...(testCase.preferred_formats ? { preferred_formats: testCase.preferred_formats } : {}) };
    const response = await handler(input, { requestId: `eval-${testCase.id}` });
    const latencyMs = Number((performance.now() - started).toFixed(1));
    if (!response.success) throw new Error(response.error.message);
    const top = response.result.routes[0];
    const useful = (route: typeof top) => Boolean(route && testCase.acceptable_route_types.includes(route.route_type)
      && (!testCase.expected_domains?.length || testCase.expected_domains.some((expected) => route.url.toLowerCase().includes(expected.toLowerCase()))));
    const metrics = response.execution.metrics;
    rows.push({ caseId: testCase.id, status: response.result.status, topRoute: top?.url ?? null, topRouteType: top?.route_type ?? null, topScore: top?.score ?? null, top1Useful: useful(top), top3Useful: response.result.routes.slice(0, 3).some((route) => useful(route)), directHttpRequests: response.result.checked.direct_probes.length, externalSearchRequests: response.result.checked.search_queries, searchProvider: metrics?.searchProvider ?? null, source: metrics?.discoverySource ?? 'none', providerFailure: response.result.limitations.some((item) => item.includes('External search fallback failed') || item.includes('could not be fetched within the network safety')), latencyMs, limitations: response.result.limitations, notes: testCase.notes });
  } catch (error) {
    rows.push({ caseId: testCase.id, status: 'execution_error', topRoute: null, topRouteType: null, topScore: null, top1Useful: false, top3Useful: false, directHttpRequests: 0, externalSearchRequests: 0, searchProvider: provider?.id ?? null, source: 'none', providerFailure: false, latencyMs: Number((performance.now() - started).toFixed(1)), limitations: [], executionError: error instanceof Error ? error.message : 'Unknown evaluation error.' });
  }
}
const percentile = (sorted: number[], p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]! : 0;
const latencies = rows.map((row) => row['latencyMs'] as number).sort((a, b) => a - b);
const sum = (predicate: (row: Row) => boolean) => rows.filter(predicate).length;
const successful = sum((row) => row['status'] !== 'execution_error');
const external = rows.reduce((total, row) => total + Number(row['externalSearchRequests']), 0);
const direct = rows.reduce((total, row) => total + Number(row['directHttpRequests']), 0);
const providerId = provider?.id;
const providerCost = providerId === 'tavily' ? Number(env['EVAL_TAVILY_COST_PER_SEARCH'] ?? 0) : providerId === 'brave' ? Number(env['EVAL_BRAVE_COST_PER_SEARCH'] ?? 0.005) : 0;
if (!Number.isFinite(providerCost) || providerCost < 0) throw new Error('Evaluation provider cost assumptions must be non-negative numbers.');
const spend = external * providerCost;
const summary = { cases: rows.length, successfulExecutions: successful, usefulTop1Percent: successful ? Number((sum((row) => row['top1Useful'] === true) / successful * 100).toFixed(1)) : 0, usefulTop3Percent: successful ? Number((sum((row) => row['top3Useful'] === true) / successful * 100).toFixed(1)) : 0, noRoutePercent: rows.length ? Number((sum((row) => row['status'] === 'no_suitable_route_found') / rows.length * 100).toFixed(1)) : 0, directDiscoveryPercent: rows.length ? Number((sum((row) => row['source'] === 'direct') / rows.length * 100).toFixed(1)) : 0, searchFallbackPercent: rows.length ? Number((sum((row) => row['source'] === 'search_fallback') / rows.length * 100).toFixed(1)) : 0, providerFailurePercent: rows.length ? Number((sum((row) => row['providerFailure'] === true) / rows.length * 100).toFixed(1)) : 0, averageDirectRequests: rows.length ? Number((direct / rows.length).toFixed(2)) : 0, averageExternalSearchesPerCall: rows.length ? Number((external / rows.length).toFixed(3)) : 0, p50LatencyMs: percentile(latencies, 0.5), p95LatencyMs: percentile(latencies, 0.95), provider: providerId ?? null, estimatedProviderSpendUsd: Number(spend.toFixed(6)), estimatedSpendPer1000FallbackCallsUsd: Number((providerCost * 1000).toFixed(2)), fallbackFrequencyPercent: rows.length ? Number((external / rows.length * 100).toFixed(1)) : 0, grossProviderMarginAt002UsdPerCall: Number((0.02 - (external / Math.max(rows.length, 1) * providerCost)).toFixed(6)), hostingAndEgressIncluded: false };
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDirectory = resolve('eval-results');
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, `source-route-${timestamp}.json`), JSON.stringify({ timestamp: new Date().toISOString(), mode: searchEnabled ? 'search-enabled' : 'deterministic-only', provider: providerId ?? null, summary, cases: rows }, null, 2));
const report = `# source_route evaluation\n\n- Mode: ${searchEnabled ? 'search-enabled' : 'deterministic-only'}\n- Provider: ${providerId ?? 'none'}\n- Cases: ${summary.cases}\n- Successful executions: ${summary.successfulExecutions}\n- Useful top-1: ${summary.usefulTop1Percent}%\n- Useful top-3: ${summary.usefulTop3Percent}%\n- No route: ${summary.noRoutePercent}%\n- Direct discovery: ${summary.directDiscoveryPercent}%\n- Search fallback: ${summary.searchFallbackPercent}%\n- Provider failures: ${summary.providerFailurePercent}%\n- Average direct requests: ${summary.averageDirectRequests}\n- Average searches per call: ${summary.averageExternalSearchesPerCall}\n- Latency p50/p95: ${summary.p50LatencyMs}/${summary.p95LatencyMs} ms\n- Estimated provider spend: $${summary.estimatedProviderSpendUsd}\n- Estimated provider spend per 1,000 calls: $${summary.estimatedSpendPer1000FallbackCallsUsd}\n- Fallback frequency: ${summary.fallbackFrequencyPercent}%\n- Gross provider margin at $0.02/call: $${summary.grossProviderMarginAt002UsdPerCall}/call\n- Hosting and egress: not included\n\n| Case | Status | Top route | Type | Score | Useful top-1 | Useful top-3 | Direct requests | Search requests | Latency ms | Limitations / error |\n|---|---|---|---|---:|---|---|---:|---:|---:|---|\n${rows.map((row) => `| ${row['caseId']} | ${row['status']} | ${String(row['topRoute'] ?? '—').replaceAll('|', '%7C')} | ${row['topRouteType'] ?? '—'} | ${row['topScore'] ?? '—'} | ${row['top1Useful'] ? 'yes' : 'no'} | ${row['top3Useful'] ? 'yes' : 'no'} | ${row['directHttpRequests']} | ${row['externalSearchRequests']} | ${row['latencyMs']} | ${String(row['executionError'] ?? ((row['limitations'] as string[]).join('; ') || '—')).replaceAll('|', '%7C')} |`).join('\n')}\n\n> Cost is an evaluation assumption, not provider pricing guidance. Tavily's free-tier availability may change.\n`;
await writeFile(resolve(outputDirectory, `source-route-${timestamp}.md`), report);
process.stdout.write(`${report}\nCase details: ${rows.map((row) => `${row['caseId']}: ${row['status']} | ${row['topRouteType'] ?? 'none'} | top1=${row['top1Useful'] ? 'yes' : 'no'} | top3=${row['top3Useful'] ? 'yes' : 'no'} | ${row['latencyMs']}ms`).join('\n')}\n`);
