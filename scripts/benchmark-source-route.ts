import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { discoverSourceRoutes } from '../src/tools/source-route/discovery.js';
import { parseSourceRouteInput } from '../src/tools/source-route/contract.js';
import { FakeSearchProvider } from '../src/tools/source-route/search-provider.js';
import type { SafeFetchResult, SafeFetcher } from '../src/core/safe-fetch.js';

const root = 'https://statistics.example';
const plainHome = await readFile(resolve('tests/fixtures/source-route/root-plain.html'), 'utf8');
const openApiHome = await readFile(resolve('tests/fixtures/source-route/root-openapi.html'), 'utf8');

async function runFixture(name: string, homepage: string, searchHits: Array<{ url: string; title: string; description: string }>) {
  const requests: string[] = [];
  const fetcher: SafeFetcher = {
    async fetch(value, onRequest) {
      const url = new URL(value).toString();
      onRequest(url);
      requests.push(url);
      const isSpec = url === `${root}/api/openapi.json`;
      const body = url === `${root}/` ? homepage : isSpec ? '{"openapi":"3.1.0","paths":{}}' : '';
      const contentType = isSpec ? 'application/json' : 'text/html';
      return { url, status: body ? 200 : 404, headers: { 'content-type': contentType }, body } satisfies SafeFetchResult;
    },
  };
  const search = new FakeSearchProvider(searchHits);
  const start = performance.now();
  const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find official population datasets', domain: 'statistics.example' }), {
    fetcher, searchProvider: search, validateUrl: async (url) => new URL(url),
  });
  return {
    fixture: name,
    latencyMs: Number((performance.now() - start).toFixed(2)),
    directFetchCount: requests.length,
    paidSearchCount: search.calls.length,
    outboundHttpRequestCount: requests.length + search.calls.length,
    selectedRoute: result.routes[0]?.url ?? null,
    source: result.metrics.source,
  };
}

const results = [
  await runFixture('homepage directly advertises OpenAPI', openApiHome, [{ url: 'https://elsewhere.example/openapi.json', title: 'OpenAPI', description: 'API schema' }]),
  await runFixture('no direct structured links; search fallback', plainHome, [{ url: 'https://elsewhere.example/openapi.json', title: 'OpenAPI', description: 'API schema' }]),
];
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
