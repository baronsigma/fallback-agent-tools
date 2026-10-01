import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { discoverSourceRoutes, rankCandidates } from '../../src/tools/source-route/discovery.js';
import { goalRelevance } from '../../src/tools/source-route/discovery.js';
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
    expect(result.metrics.requests).toHaveLength(4);
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
    expect(sitemapResult.routes.some((route) => route.url.endsWith('/sitemap.xml'))).toBe(false);
  });

  it('reports no suitable route within checked scope for a plain site with no search provider', async () => {
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find the latest statistics', domain: 'statistics.test' }), { fetcher: fixtureFetcher({ [`${root}/`]: { body: await fixture('root-plain.html') } }), validateUrl });
    expect(result.routes).toEqual([]);
    expect(result.limitations.join(' ')).toContain('does not establish that no route exists');
    expect(result.limitations.join(' ')).toContain('no search provider is configured');
  });

  it('does not recommend a homepage solely because JSON-LD metadata is present', async () => {
    const fetcher = fixtureFetcher({ [`${root}/`]: { body: '<html><script type="application/ld+json">{"@type":"Dataset"}</script></html>' } });
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'View structured publisher information', domain: 'statistics.test' }), { fetcher, validateUrl });
    expect(result.routes).toEqual([]);
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

  it('starts from the supplied start_url path and does not treat feedback as a feed', async () => {
    const start = 'https://statistics.test/docs/';
    const fetcher = fixtureFetcher({ [start]: { body: '<a href="/feedback/api.json">Feedback API</a><a href="/docs/guide">SQL command documentation</a>' } });
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find SQL command docs', start_url: start }), { fetcher, validateUrl });
    expect(fetcher.requested[0]).toBe(start);
    expect(result.routes.some((route) => route.route_type === 'structured_feed')).toBe(false);
  });

  it('does not promote generic JSON/XML resources or unrelated static assets as datasets', async () => {
    const fetcher = fixtureFetcher({
      [`${root}/`]: { body: '<a href="/sitemap.xml">Sitemap</a><a href="/manifest.json">Manifest</a><a href="https://fonts.googleapis.com/css2?family=Roboto">Fonts</a><a href="/wp-json">WordPress API discovery</a><a href="/population.json">Population dataset</a>' },
      [`${root}/sitemap.xml`]: { body: '<urlset><url><loc>https://statistics.test/sitemap.xml</loc></url></urlset>', contentType: 'application/xml' },
      [`${root}/manifest.json`]: { body: '{"name":"App","icons":[]}', contentType: 'application/json' },
      [`${root}/population.json`]: { body: '{"data":[{"year":2020,"value":42}]}', contentType: 'application/json' },
    });
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find population statistics', domain: 'statistics.test' }), { fetcher, validateUrl });
    expect(result.routes.some((route) => /sitemap|manifest|wp-json|fonts\.googleapis/.test(route.url))).toBe(false);
  });

  it('keeps unrelated third-party API search results non-official and lower trust', async () => {
    const provider = new FakeSearchProvider([{ url: 'https://github.com/example/sec-api-wrapper', title: 'SEC API wrapper', description: 'Developer docs for a client library for SEC company facts' }]);
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find SEC public company filings and submissions API', domain: 'sec.gov' }), { fetcher: fixtureFetcher({ [`https://sec.gov/`]: { body: '<html>filings homepage</html>' } }), searchProvider: provider, validateUrl });
    expect(result.routes.some((route) => route.url.includes('github.com') && route.route_type === 'official_api')).toBe(false);
    expect(result.routes.find((route) => route.url.includes('github.com'))?.route_type).toBe('developer_docs');
  });

  it('uses registrable publisher sites while distinguishing unrelated domains', () => {
    const candidates = [
      { url: 'https://api.worldbank.org/v2/country', route_type: 'official_api', format: 'api', publisher_match: 'same_site', verification: 'publisher_linked', machine_readable: true, auth: 'unknown', score: 0, reasons: [] },
      { url: 'https://github.com/worldbank/api', route_type: 'official_api', format: 'api', publisher_match: 'search_discovered', verification: 'search_only', machine_readable: true, auth: 'unknown', score: 0, reasons: [] },
    ] as RouteCandidate[];
    const ranked = rankCandidates(candidates, ['api'], false, 'Find World Bank indicators API');
    expect(ranked[0]?.publisher_match).toBe('same_site');
    expect(ranked[1]?.publisher_match).toBe('search_discovered');
  });

  it('reserves direct phase time for a configured search provider', async () => {
    const provider = new FakeSearchProvider([]);
    const slowFetcher: SafeFetcher = { async fetch(_url, onRequest, timeoutMs) { onRequest(`${root}/`); await new Promise((resolve) => setTimeout(resolve, Math.min(30, timeoutMs ?? 30))); throw new Error('simulated slow publisher'); } };
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find population API', domain: 'statistics.test' }), { fetcher: slowFetcher, searchProvider: provider, validateUrl });
    expect(provider.calls).toHaveLength(1);
    expect(result.metrics.searchQueries).toBe(1);
    expect(result.metrics.requests.length).toBeLessThanOrEqual(6);
  });

  it('performs exactly one search fallback after deterministic discovery fails', async () => {
    const provider = new FakeSearchProvider([{ url: 'https://data.example.net/openapi.json', title: 'OpenAPI', description: 'API specification' }]);
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find a dataset', domain: 'statistics.test' }), { fetcher: fixtureFetcher({ [`${root}/`]: { body: await fixture('root-plain.html') } }), searchProvider: provider, validateUrl });
    expect(provider.calls).toHaveLength(1);
    expect(result.metrics.searchQueries).toBe(1);
    expect(result.routes.some((route) => route.publisher_match === 'search_discovered')).toBe(true);
  });

  it('skips search when a relevant publisher-linked documentation route is already strong', async () => {
    const provider = new FakeSearchProvider([]);
    const fetcher = fixtureFetcher({ [`${root}/`]: { body: '<a href="/docs/population-api">Population API documentation</a>' } });
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find population API documentation', domain: 'statistics.test' }), { fetcher, searchProvider: provider, validateUrl });
    expect(result.routes[0]?.route_type).toBe('developer_docs');
    expect(provider.calls).toHaveLength(0);
  });

  it('uses retained search text to rank topic relevant candidate above generic page', () => {
    const generic = { url: 'https://api.worldbank.org', route_type: 'official_api', format: 'api', publisher_match: 'same_site', verification: 'publisher_linked', machine_readable: true, auth: 'unknown', score: 0, reasons: [], rankingText: 'World Bank API homepage' } as RouteCandidate & { rankingText: string };
    const indicator = { url: 'https://api.worldbank.org/v2/indicator/SP.POP.TOTL', route_type: 'official_api', format: 'api', publisher_match: 'same_site', verification: 'publisher_linked', machine_readable: true, auth: 'unknown', score: 0, reasons: [], rankingText: 'World Bank population total indicator API' } as RouteCandidate & { rankingText: string };
    expect(rankCandidates([generic, indicator], ['api'], false, 'Find World Bank population indicators API')[0]?.url).toContain('/indicator/');
  });

  it('uses link and search descriptions to distinguish GitHub repository docs and Crossref retrieval docs', () => {
    expect(goalRelevance('Find GitHub REST API repository documentation', 'GitHub REST API repository endpoints')).toBeGreaterThan(goalRelevance('Find GitHub REST API repository documentation', 'GitHub API documentation topic page'));
    expect(goalRelevance('Find Crossref scholarly metadata API documentation', 'Crossref retrieve metadata REST API documentation')).toBeGreaterThan(goalRelevance('Find Crossref scholarly metadata API documentation', 'Crossref general retrieval and query homepage'));
    expect(goalRelevance('Find WHO global health observatory indicator data', 'WHO global health observatory indicator API')).toBeGreaterThan(goalRelevance('Find WHO global health observatory indicator data', 'WHO generic global health observatory landing page'));
  });

  it.each([
    ['Find GitHub REST API repository documentation', 'GitHub REST API repository endpoints', 'GitHub API documentation topic page'],
    ['Find World Bank development indicators API', 'World Bank API population indicator development data', 'World Bank data homepage global statistics'],
    ['Find Crossref scholarly metadata API documentation', 'Crossref REST API retrieve metadata documentation', 'Crossref general retrieval homepage'],
    ['Find WHO global health observatory indicator data', 'WHO GHO health indicators data API', 'WHO GHO landing page overview'],
  ])('ranks the specifically relevant route higher using candidate context', (goal, relevant, generic) => {
    const candidates = [
      { url: 'https://publisher.test/generic', route_type: 'developer_docs', publisher_match: 'same_site', verification: 'publisher_linked', machine_readable: false, auth: 'unknown', score: 0, reasons: [], rankingText: generic },
      { url: 'https://publisher.test/relevant', route_type: 'developer_docs', publisher_match: 'same_site', verification: 'publisher_linked', machine_readable: false, auth: 'unknown', score: 0, reasons: [], rankingText: relevant },
    ] as (RouteCandidate & { rankingText: string })[];
    expect(rankCandidates(candidates, [], false, goal)[0]?.url).toContain('/relevant');
  });

  it('downgrades search-classified downloads when fetched content is ordinary HTML', async () => {
    const provider = new FakeSearchProvider([{ url: 'https://api.opencorporates.com/', title: 'OpenCorporates API dataset download', description: 'Company search API and dataset download' }]);
    const fetcher = fixtureFetcher({ [`${root}/`]: { body: '<html>ordinary homepage</html>' }, 'https://api.opencorporates.com/': { body: '<html><title>API docs</title>Company search</html>' } });
    const result = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find OpenCorporates company registry API', domain: 'opencorporates.com' }), { fetcher, searchProvider: provider, validateUrl });
    const hit = result.routes.find((route) => route.url.includes('api.opencorporates.com'));
    expect(hit?.route_type).toBe('developer_docs');
    expect(hit?.machine_readable).toBe(false);
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
    const malformed = { id: 'fake' as const, async search() { return null as never; } };
    const malformedResult = await discoverSourceRoutes(parseSourceRouteInput({ goal: 'Find dataset', domain: 'statistics.test' }), { fetcher: fixtureFetcher({ [`${root}/`]: { body: await fixture('root-plain.html') } }), searchProvider: malformed, validateUrl });
    expect(malformedResult.metrics.searchQueries).toBe(1);
    expect(malformedResult.routes).toEqual([]);
  });
});

describe('deterministic ranking', () => {
  const route = (url: string, route_type: RouteCandidate['route_type'], format: string, machine_readable: boolean): RouteCandidate => ({ url, route_type, format, publisher_match: 'linked_from_domain', verification: 'content_verified', machine_readable, auth: 'unknown', score: 0, reasons: [] });
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
