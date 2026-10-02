import { describe, expect, it } from 'vitest';
import { discoverSourceRoutes, detectPlatformOpenApiPaths } from '../../src/tools/source-route/discovery.js';
import { parseSourceRouteInput } from '../../src/tools/source-route/contract.js';
import type { SafeFetchResult, SafeFetcher } from '../../src/core/safe-fetch.js';

const validateUrl = async (value: string) => new URL(value);
function fetcherFor(entries: Record<string, { body: string; contentType: string; finalUrl?: string }>): SafeFetcher & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    async fetch(value, onRequest) {
      const url = new URL(value).toString();
      onRequest(url); requested.push(url);
      const entry = entries[url];
      return { url: entry?.finalUrl ?? url, status: entry ? 200 : 404, headers: { 'content-type': entry?.contentType ?? 'text/html' }, body: entry?.body ?? '' } satisfies SafeFetchResult;
    },
  };
}

describe('platform-aware API spec discovery', () => {
  it('detects Opendatasoft/Huwise and udata portals from page markers', () => {
    expect(detectPlatformOpenApiPaths('<div class="ods-app">Powered by Huwise</div>')).toEqual([{ platform: 'Opendatasoft/Huwise', path: '/api/explore/v2.1/swagger.json' }]);
    expect(detectPlatformOpenApiPaths('<meta name="generator" content="udata">')).toEqual([{ platform: 'udata', path: '/api/1/swagger.json' }]);
    expect(detectPlatformOpenApiPaths('<html>plain site</html>')).toEqual([]);
  });

  it('finds an Opendatasoft spec on a redirected portal page before generic probes exhaust the budget', async () => {
    const fetcher = fetcherFor({
      'https://notices.test/': { body: '<html><body class="ods-front">Huwise portal</body></html>', contentType: 'text/html', finalUrl: 'https://www.notices.test/pages/home/' },
      'https://www.notices.test/api/explore/v2.1/swagger.json': { body: '{"openapi":"3.0.3","info":{"title":"Explore API"},"paths":{}}', contentType: 'application/json' },
    });
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find the procurement notices API', domain: 'notices.test', preferred_formats: ['api'] }), { fetcher, validateUrl });
    expect(result.routes[0]).toMatchObject({ route_type: 'openapi', url: 'https://www.notices.test/api/explore/v2.1/swagger.json', machine_readable: true });
    expect(fetcher.requested[1]).toBe('https://www.notices.test/api/explore/v2.1/swagger.json');
  });

  it('recognises a JSON spec whose swagger key is serialized after paths (udata)', async () => {
    const spec = JSON.stringify({ basePath: '/api/1', paths: { '/datasets/': {} }, swagger: '2.0' });
    const fetcher = fetcherFor({
      'https://opendata.test/': { body: '<html data-app="udata"></html>', contentType: 'text/html' },
      'https://opendata.test/api/1/swagger.json': { body: spec, contentType: 'application/json' },
    });
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find the dataset search API', domain: 'opendata.test' }), { fetcher, validateUrl });
    expect(result.routes[0]).toMatchObject({ route_type: 'openapi', url: 'https://opendata.test/api/1/swagger.json' });
  });
});
