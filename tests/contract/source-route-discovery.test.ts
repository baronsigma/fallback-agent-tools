import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { discoverSourceRoutes, rankCandidates } from '../../src/tools/source-route/discovery.js';
import { parseSourceRouteInput } from '../../src/tools/source-route/contract.js';
import { FakeSearchProvider } from '../../src/tools/source-route/search-provider.js';
import type { SafeFetchResult, SafeFetcher } from '../../src/core/safe-fetch.js';
import type { RouteCandidate } from '../../src/tools/source-route/discovery.js';

const root = 'https://statistics.test';
const validateUrl = async (value: string) => new URL(value);

function fixtureFetcher(entries: Record<string, { body?: string; status?: number; contentType?: string }> = {}): SafeFetcher & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    async fetch(value, onRequest) {
      const url = new URL(value).toString();
      onRequest(url);
      requested.push(url);
      const entry = entries[url] ?? {};
      const body = entry.body ?? '';
      return { url, status: entry.status ?? (entry.body ? 200 : 404), headers: { 'content-type': entry.contentType ?? 'text/html' }, body } satisfies SafeFetchResult;
    },
  };
}

async function fixture(name: string) { return readFile(resolve(`tests/fixtures/source-route/${name}`), 'utf8'); }

describe('bounded deterministic discovery', () => {
  it('finds linked OpenAPI and avoids search when direct discovery succeeds', async () => {
    const provider = new FakeSearchProvider([{ url: 'https://elsewhere.test/api', title: 'API', description: 'API' }]);
    const fetcher = fixtureFetcher({
      [`${root}/`]: { body: await fixture('root-openapi.html') },
      [`${root}/api/openapi.json`]: { body: '{"openapi":"3.1.0","paths":{}}', contentType: 'application/json' },
    });
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Retrieve official statistical data', domain: 'statistics.test' }), { fetcher, searchProvider: provider, validateUrl });
    expect(result.routes[0]).toMatchObject({ route_type: 'openapi', publisher_match: 'exact_domain', machine_readable: true });
    expect(result.routes[0]?.url).toBe(`${root}/api/openapi.json`);
    expect(result.metrics.requests.length).toBeLessThanOrEqual(8);
    expect(provider.calls).toHaveLength(0);
    expect(result.metrics.searchQueries).toBe(0);
    expect(result.metrics.requests).toHaveLength(2);
  });

  it('finds CSV, RSS, llms.txt, and sitemap structured routes', async () => {
    const csvResult = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Download dataset', domain: 'statistics.test' }), { fetcher: fixtureFetcher({ [`${root}/`]: { body: await fixture('root-csv.html') } }), validateUrl });
    expect(csvResult.routes.some((route) => route.format === 'csv' && route.route_type === 'bulk_download')).toBe(true);

    const rssResult = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Get recent updates', domain: 'statistics.test' }), { fetcher: fixtureFetcher({ [`${root}/`]: { body: await fixture('root-rss.html') } }), validateUrl });
    expect(rssResult.routes.some((route) => route.route_type === 'structured_feed')).toBe(true);

    const llmsBody = await fixture('llms.txt');
    const llmsResult = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Download population data', domain: 'statistics.test' }), { fetcher: fixtureFetcher({ [`${root}/`]: { body: await fixture('root-plain.html') }, [`${root}/llms.txt`]: { body: llmsBody, contentType: 'text/plain' } }), validateUrl });
    expect(llmsResult.routes.some((route) => route.format === 'csv' && route.reasons.some((reason) => reason.includes('llms.txt')))).toBe(true);

    const sitemapBody = await fixture('sitemap.xml');
    const sitemapResult = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Download summary data', domain: 'statistics.test' }), { fetcher: fixtureFetcher({ [`${root}/`]: { body: await fixture('root-plain.html') }, [`${root}/robots.txt`]: { body: await fixture('robots.txt'), contentType: 'text/plain' }, [`${root}/sitemap.xml`]: { body: sitemapBody, contentType: 'application/xml' } }), validateUrl });
    expect(sitemapResult.routes.some((route) => route.format === 'json' && route.reasons.some((reason) => reason.includes('sitemap')))).toBe(true);
  });

  it('reports no suitable route within checked scope for a plain site with no search provider', async () => {
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find the latest statistics', domain: 'statistics.test' }), { fetcher: fixtureFetcher({ [`${root}/`]: { body: await fixture('root-plain.html') } }), validateUrl });
    expect(result.routes).toEqual([]);
    expect(result.limitations.join(' ')).toContain('does not establish that no route exists');
    expect(result.limitations.join(' ')).toContain('no search provider is configured');
  });

  it('offers structured HTML as a lower-ranked fallback when JSON-LD is observed', async () => {
    const fetcher = fixtureFetcher({ [`${root}/`]: { body: '<html><script type="application/ld+json">{"@type":"Dataset"}</script></html>' } });
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'View structured publisher information', domain: 'statistics.test' }), { fetcher, validateUrl });
    expect(result.routes[0]).toMatchObject({ route_type: 'structured_web', machine_readable: true, publisher_match: 'exact_domain' });
    expect(result.metrics.searchQueries).toBe(0);
  });

  it('does not let an unsafe linked OpenAPI URL suppress standard probes or enter output', async () => {
    const unsafe = 'http://127.0.0.1/openapi.json';
    const fetcher = fixtureFetcher({ [`${root}/`]: { body: `<a href="${unsafe}">OpenAPI specification</a>` } });
    const validatePublicFixtureUrl = async (value: string) => {
      const url = new URL(value);
      if (url.hostname === '127.0.0.1') throw new Error('blocked private destination');
      return url;
    };
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find the API schema', domain: 'statistics.test' }), { fetcher, validateUrl: validatePublicFixtureUrl });
    expect(result.routes).toEqual([]);
    expect(fetcher.requested).not.toContain(unsafe);
    expect(result.metrics.requests.length).toBeGreaterThan(1);
  });

  it('does not trust an HTML link that merely labels an ordinary page as OpenAPI', async () => {
    const fetcher = fixtureFetcher({
      [`${root}/`]: { body: '<a href="/fake-openapi">OpenAPI specification</a>' },
      [`${root}/fake-openapi`]: { body: '<html><h1>Not an API description</h1></html>', contentType: 'text/html' },
    });
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find the API schema', domain: 'statistics.test' }), { fetcher, validateUrl });
    expect(result.routes.some((route) => route.route_type === 'openapi')).toBe(false);
    expect(result.routes.some((route) => route.route_type === 'developer_docs' && route.url.endsWith('/fake-openapi'))).toBe(true);
  });

  it('performs exactly one search fallback after deterministic discovery fails', async () => {
    const provider = new FakeSearchProvider([{ url: 'https://data.example.net/openapi.json', title: 'OpenAPI', description: 'API specification' }]);
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find a dataset', domain: 'statistics.test' }), { fetcher: fixtureFetcher({ [`${root}/`]: { body: await fixture('root-plain.html') } }), searchProvider: provider, validateUrl });
    expect(provider.calls).toHaveLength(1);
    expect(result.metrics.searchQueries).toBe(1);
    expect(result.routes.some((route) => route.publisher_match === 'search_discovered')).toBe(true);
  });

  it('records observed authentication friction and still makes at most one fallback query', async () => {
    const provider = new FakeSearchProvider([]);
    const fetcher = fixtureFetcher({ [`${root}/`]: { body: await fixture('root-plain.html') }, [`${root}/openapi.json`]: { status: 401, body: '', contentType: 'application/json' } });
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find the API schema', domain: 'statistics.test' }), { fetcher, searchProvider: provider, validateUrl });
    expect(result.routes.some((route) => route.route_type === 'openapi' && route.auth === 'appears_required')).toBe(true);
    expect(result.metrics.searchQueries).toBe(1);
    expect(provider.calls).toHaveLength(1);
  });

  it('handles search timeout and malformed provider responses without retries', async () => {
    const timed = new FakeSearchProvider([], new Error('timeout'));
    const timeoutResult = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find dataset', domain: 'statistics.test' }), { fetcher: fixtureFetcher({ [`${root}/`]: { body: await fixture('root-plain.html') } }), searchProvider: timed, validateUrl });
    expect(timed.calls).toHaveLength(1);
    expect(timeoutResult.metrics.searchQueries).toBe(1);
    const malformed = { async search() { return null as never; } };
    const malformedResult = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find dataset', domain: 'statistics.test' }), { fetcher: fixtureFetcher({ [`${root}/`]: { body: await fixture('root-plain.html') } }), searchProvider: malformed, validateUrl });
    expect(malformedResult.metrics.searchQueries).toBe(1);
    expect(malformedResult.routes).toEqual([]);
  });
});

describe('deterministic ranking', () => {
  const route = (url: string, route_type: RouteCandidate['route_type'], format: string, machine_readable: boolean): RouteCandidate => ({ url, route_type, format, publisher_match: 'linked_from_domain', machine_readable, auth: 'unknown', score: 0, reasons: [] });
  it('ranks official structured routes above HTML and applies format preferences', () => {
    const ranked = rankCandidates([route('https://a.test/page', 'web', 'html', false), route('https://a.test/metadata.json', 'dataset', 'json', true), route('https://a.test/data.csv', 'dataset', 'csv', true)], ['csv']);
    expect(ranked[0]?.url).toBe('https://a.test/data.csv');
    expect(ranked.at(-1)?.route_type).toBe('web');
    const apiFirst = rankCandidates([
      route('https://a.test/00-openapi.json', 'openapi', 'json', true),
      route('https://a.test/zz-api', 'official_api', 'api', true),
    ]);
    expect(apiFirst[0]?.route_type).toBe('official_api');
  });

  it('is deterministic and honors candidate caps', async () => {
    const candidates = Array.from({ length: 8 }, (_, index) => route(`https://a.test/${index}.json`, 'dataset', 'json', true));
    expect(rankCandidates(candidates)).toEqual(rankCandidates(candidates));
    const fetcher = fixtureFetcher({ [`${root}/`]: { body: `<html>${Array.from({ length: 8 }, (_, i) => `<a href="/${i}.json">dataset ${i}</a>`).join('')}</html>` } });
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find datasets', domain: 'statistics.test', max_candidates: 2 }), { fetcher, validateUrl });
    expect(result.routes).toHaveLength(2);
  });
});
