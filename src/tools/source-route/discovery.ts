import { NETWORK_LIMITS, type SafeFetchResult, type SafeFetcher, safeFetcher, validatePublicHttpUrl } from '../../core/safe-fetch.js';
import { normalizeDomain, type SourceRouteInput } from './contract.js';
import type { SearchHit, SearchProvider } from './search-provider.js';

export type RouteCandidate = {
  url: string;
  route_type: 'official_api' | 'openapi' | 'bulk_download' | 'structured_feed' | 'dataset' | 'developer_docs' | 'structured_web' | 'web';
  format?: string;
  publisher_match: 'exact_domain' | 'linked_from_domain' | 'search_discovered';
  machine_readable: boolean;
  auth: 'none_observed' | 'appears_required' | 'unknown';
  score: number;
  reasons: string[];
};

export type DiscoveryMetrics = { requests: string[]; pagesFetched: number; searchQueries: number; source: 'direct' | 'search_fallback' | 'none' };
export type DiscoveryResult = { routes: RouteCandidate[]; metrics: DiscoveryMetrics; limitations: string[] };
export type SourceRouteDiscoveryOptions = {
  fetcher?: SafeFetcher;
  searchProvider?: SearchProvider;
  validateUrl?: (url: string) => Promise<URL>;
};

const OPENAPI_PATHS = ['/openapi.json', '/.well-known/openapi.json', '/swagger.json'];

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Operation deadline exceeded.')), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function absoluteHttpUrl(value: string, base: string): string | undefined {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.hash = '';
    return url.toString();
  } catch { return undefined; }
}

function extractLinks(html: string, base: string): Array<{ url: string; text: string; rel?: string; type?: string }> {
  const links: Array<{ url: string; text: string; rel?: string; type?: string }> = [];
  const tagPattern = /<(a|link)\b([^>]*)>([\s\S]*?)<\/a\s*>|<link\b([^>]*)\/?\s*>/gi;
  for (const match of html.matchAll(tagPattern)) {
    const tag = (match[2] ?? match[4] ?? '');
    const attr = (name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
    const href = attr('href');
    const url = href ? absoluteHttpUrl(href, base) : undefined;
    if (!url) continue;
    const text = (match[3] ?? '').replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|amp|quot|#39);/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
    const rel = attr('rel');
    const type = attr('type');
    links.push({ url, text, ...(rel ? { rel } : {}), ...(type ? { type } : {}) });
  }
  return links;
}

function linkedCandidate(link: { url: string; text: string; rel?: string; type?: string }, publisherHost: string): RouteCandidate | undefined {
  const target = new URL(link.url);
  const exact = target.hostname.toLowerCase() === publisherHost.toLowerCase();
  const label = `${link.text} ${link.url} ${link.rel ?? ''} ${link.type ?? ''}`.toLowerCase();
  const format = /\.csv(?:$|[?#])/.test(target.href) || /text\/csv/.test(link.type ?? '') || /\bcsv\b/.test(label) ? 'csv'
    : /\.json(?:$|[?#])/.test(target.href) || /json/.test(link.type ?? '') || /\bjson\b/.test(label) ? 'json'
    : /\.xml(?:$|[?#])/.test(target.href) || /xml/.test(link.type ?? '') || /\bxml\b/.test(label) ? 'xml'
    : /rss|atom/.test(`${label} ${target.pathname}`) ? 'rss' : undefined;
  if (/openapi|swagger/.test(label)) return candidate(link.url, 'openapi', 'json', exact ? 'exact_domain' : 'linked_from_domain', true, ['OpenAPI or Swagger reference was linked from the supplied site.']);
  if (/rss|atom/.test(label) || /application\/(?:rss|atom)\+xml/.test(link.type ?? '')) return candidate(link.url, 'structured_feed', 'rss', exact ? 'exact_domain' : 'linked_from_domain', true, ['Feed link was exposed by the supplied site.']);
  if (/\.csv(?:$|[?#])/.test(target.href) || /text\/csv/.test(link.type ?? '') || /dataset|download|bulk|data export/.test(label) && format) {
    return candidate(link.url, 'bulk_download', format ?? 'csv', exact ? 'exact_domain' : 'linked_from_domain', true, ['A downloadable structured file was linked from the supplied site.']);
  }
  if (/\.json(?:$|[?#])/.test(target.href)) return candidate(link.url, 'dataset', format ?? 'json', exact ? 'exact_domain' : 'linked_from_domain', true, ['A JSON resource was linked from the supplied site.']);
  if (format === 'json' || format === 'xml') return candidate(link.url, 'dataset', format, exact ? 'exact_domain' : 'linked_from_domain', true, ['A structured document was exposed through an alternate/discovery link.']);
  if (/\/api(?:\/|$)|api reference|developer|data portal|documentation|docs/.test(label)) return candidate(link.url, /\/api(?:\/|$)/.test(target.pathname) ? 'official_api' : 'developer_docs', 'api', exact ? 'exact_domain' : 'linked_from_domain', /\/api(?:\/|$)/.test(target.pathname), ['API or developer documentation was linked from the supplied site.']);
  if (exact && link.text.length > 10) return candidate(link.url, 'web', 'html', 'exact_domain', false, ['Page was linked from the supplied site.']);
  return undefined;
}

function candidate(url: string, route_type: RouteCandidate['route_type'], format: string | undefined, publisher_match: RouteCandidate['publisher_match'], machine_readable: boolean, reasons: string[]): RouteCandidate {
  return { url, route_type, ...(format ? { format } : {}), publisher_match, machine_readable, auth: 'unknown', score: 0, reasons };
}

function classifyProbe(url: string, body: string, contentType: string, publisherMatch: RouteCandidate['publisher_match'], reason: string, status = 200): RouteCandidate | undefined {
  const path = new URL(url).pathname.toLowerCase();
  if (status === 401 || status === 403) {
    if (/openapi|swagger/.test(path)) return candidate(url, 'openapi', 'json', publisherMatch, true, [reason, `Probe returned HTTP ${status}; authentication appears required.`]);
    if (/\/(?:api|data)(?:\/|$)/.test(path)) return candidate(url, 'official_api', 'api', publisherMatch, /json|xml|csv/.test(contentType), [reason, `Probe returned HTTP ${status}; authentication appears required.`]);
    return undefined;
  }
  const bodyLooksLikeOpenApi = /json/.test(contentType) && /"(?:openapi|swagger)"\s*:/i.test(body.slice(0, 2000))
    || /yaml|yml/.test(contentType) && /^(?:openapi|swagger)\s*:/im.test(body.slice(0, 2000));
  if (/openapi|swagger/.test(contentType) || bodyLooksLikeOpenApi) return candidate(url, 'openapi', /yaml|yml/.test(contentType) ? 'yaml' : 'json', publisherMatch, true, [reason, 'Response identifies itself as an API specification.']);
  if (path.endsWith('.csv') || /text\/csv/.test(contentType)) return candidate(url, 'dataset', 'csv', publisherMatch, true, [reason, 'Response is a CSV dataset.']);
  if (/json/.test(contentType)) return candidate(url, 'dataset', 'json', publisherMatch, true, [reason, 'Response is JSON.']);
  if (/rss|atom/.test(contentType) || /<rss\b|<feed\b/.test(body.slice(0, 1000).toLowerCase())) return candidate(url, 'structured_feed', 'xml', publisherMatch, true, [reason, 'Response is a structured feed.']);
  if (/xml/.test(contentType)) return candidate(url, 'dataset', 'xml', publisherMatch, true, [reason, 'Response is structured XML.']);
  return undefined;
}

function authFromStatus(status: number): RouteCandidate['auth'] {
  return status === 401 || status === 403 ? 'appears_required' : status >= 200 && status < 400 ? 'none_observed' : 'unknown';
}

export function rankCandidates(candidates: RouteCandidate[], preferred: string[] = [], requireOfficial = false): RouteCandidate[] {
  const typeBase: Record<RouteCandidate['route_type'], number> = {
    official_api: 0.94, openapi: 0.90, bulk_download: 0.87, dataset: 0.86,
    structured_feed: 0.84, developer_docs: 0.68, structured_web: 0.62, web: 0.42,
  };
  return candidates.map((route) => {
    let score = typeBase[route.route_type];
    if (route.publisher_match === 'exact_domain') score += 0.07;
    else if (route.publisher_match === 'linked_from_domain') score += 0.04;
    if (route.machine_readable) score += 0.04;
    if (route.auth === 'appears_required') score -= 0.12;
    if (route.auth === 'none_observed') score += 0.02;
    if (route.format && preferred.some((format) => format === route.format || (format === 'api' && ['official_api', 'openapi'].includes(route.route_type)) || (format === 'bulk_download' && ['bulk_download', 'dataset'].includes(route.route_type)))) score += 0.12;
    if (requireOfficial && route.publisher_match === 'search_discovered') score -= 0.25;
    const sortScore = score;
    score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
    return { route: { ...route, score }, sortScore };
  }).sort((a, b) => b.sortScore - a.sortScore || a.route.url.localeCompare(b.route.url)).map(({ route }) => route);
}

function sitemapLocations(body: string, base: string): string[] {
  return [...body.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((match) => absoluteHttpUrl(match[1] ?? '', base)).filter((url): url is string => Boolean(url)).slice(0, 30);
}

function addSitemapCandidates(body: string, sitemapUrl: string, siteHost: string, suppliedHost: string, candidates: RouteCandidate[]): void {
  for (const location of sitemapLocations(body, sitemapUrl)) {
    const loc = new URL(location);
    if (loc.hostname.toLowerCase() !== siteHost.toLowerCase() || !/\.(?:json|csv|xml)(?:$|[?#])/i.test(loc.href)) continue;
    const ext = loc.pathname.split('.').pop()?.toLowerCase();
    const feed = ext === 'xml' && /rss|atom|feed/i.test(loc.pathname);
    const publisherMatch = loc.hostname.toLowerCase() === suppliedHost.toLowerCase() ? 'exact_domain' : 'linked_from_domain';
    candidates.push(candidate(location, feed ? 'structured_feed' : 'dataset', ext, publisherMatch, true, ["Structured resource URL was listed in the site's sitemap."]));
  }
}

function searchHitCandidate(hit: SearchHit, domain: string | undefined): RouteCandidate {
  const url = new URL(hit.url);
  const label = `${hit.title} ${hit.description} ${url.pathname}`.toLowerCase();
  const domainMatch = domain && url.hostname.toLowerCase() === domain.toLowerCase();
  const match = domainMatch ? 'exact_domain' : 'search_discovered';
  const relationshipReason = domainMatch ? 'Search result hostname exactly matches the supplied domain; page content was not fetched.' : 'Search result hostname was observed, but its relationship to an official publisher was not independently verified.';
  if (/openapi|swagger/.test(label)) return candidate(hit.url, 'openapi', 'json', match, /\.json$/i.test(url.pathname), ['Search result title or description identifies an OpenAPI/Swagger document; content was not fetched.', relationshipReason]);
  if (/\.csv(?:$|[?#])/.test(url.href) || /bulk download|dataset|csv/.test(label)) return candidate(hit.url, /api|endpoint/.test(label) ? 'official_api' : 'bulk_download', 'csv', match, /\.csv$/i.test(url.pathname), ['Search result points to a possible structured download; content was not fetched.', relationshipReason]);
  if (/rss|atom|feed/.test(label)) return candidate(hit.url, 'structured_feed', 'rss', match, /\.(?:rss|atom|xml)$/i.test(url.pathname), ['Search result identifies a possible feed; content was not fetched.', relationshipReason]);
  if (/api|developer|documentation|docs/.test(label)) return candidate(hit.url, 'developer_docs', 'api', match, false, ['Search result describes API or developer documentation.', relationshipReason]);
  return candidate(hit.url, 'web', 'html', match, false, ['Found by the single bounded external search query.', relationshipReason]);
}

async function readIfFetched(fetcher: SafeFetcher, url: string, requests: string[], budget: { pagesFetched: number }, startedAt: number): Promise<SafeFetchResult | undefined> {
  try {
    const remaining = NETWORK_LIMITS.totalTimeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) throw new Error('Total execution time limit reached.');
    const result = await fetcher.fetch(url, (requested) => {
      if (requests.length >= NETWORK_LIMITS.maxHttpRequests) throw new Error('HTTP request budget exceeded.');
      if (Date.now() - startedAt >= NETWORK_LIMITS.totalTimeoutMs) throw new Error('Total execution time limit reached.');
      requests.push(requested);
    }, Math.min(remaining, NETWORK_LIMITS.requestTimeoutMs));
    budget.pagesFetched += 1;
    return result;
  } catch { return undefined; }
}

export async function discoverSourceRoutes(input: SourceRouteInput, options: SourceRouteDiscoveryOptions = {}): Promise<DiscoveryResult> {
  const startedAt = Date.now();
  const fetcher = options.fetcher ?? safeFetcher;
  const validateUrl = options.validateUrl ?? validatePublicHttpUrl;
  const requests: string[] = [];
  const counters = { pagesFetched: 0, searchQueries: 0 };
  const candidates: RouteCandidate[] = [];
  const validatedCandidateUrls = new Set<string>();
  const limitations: string[] = [];
  let root: URL | undefined;
  let suppliedHost: string | undefined;
  let linked: Array<{ url: string; text: string; rel?: string; type?: string }> = [];

  if (input.domain) {
    const hostname = normalizeDomain(input.domain);
    suppliedHost = hostname;
    const initial = new URL(`https://${hostname}`);
    root = new URL(initial.origin);
    try {
      const validationTime = NETWORK_LIMITS.totalTimeoutMs - (Date.now() - startedAt);
      if (validationTime <= 0) throw new Error('Total execution time limit reached.');
      await withTimeout(validateUrl(root.toString()), validationTime);
      const result = await readIfFetched(fetcher, root.toString(), requests, counters, startedAt);
      if (result) {
        const finalUrl = new URL(result.url);
        root = finalUrl;
        linked = extractLinks(result.body, finalUrl.toString()).slice(0, 100);
        const rootPublisherMatch = finalUrl.hostname.toLowerCase() === hostname.toLowerCase() ? 'exact_domain' : 'linked_from_domain';
        for (const link of linked) {
          const found = linkedCandidate(link, hostname);
          if (found) { found.auth = 'unknown'; candidates.push(found); }
        }
        const rootCandidate = result.status >= 200 && result.status < 400 || result.status === 401 || result.status === 403
          ? classifyProbe(result.url, result.body, String(result.headers['content-type'] ?? ''), rootPublisherMatch, 'The domain root returned this structured response.', result.status) : undefined;
        if (rootCandidate) { rootCandidate.auth = authFromStatus(result.status); candidates.push(rootCandidate); }
        if (!rootCandidate && result.status >= 200 && result.status < 400 && /html/i.test(String(result.headers['content-type'] ?? '')) && /<script\b[^>]*type\s*=\s*["']application\/ld\+json["']/i.test(result.body)) {
          const structuredPage = candidate(result.url, 'structured_web', 'html', rootPublisherMatch, true, ['The homepage embeds JSON-LD structured metadata.']);
          structuredPage.auth = authFromStatus(result.status);
          candidates.push(structuredPage);
        }
      } else limitations.push('The supplied domain could not be fetched within the network safety and request limits.');
    } catch (error) {
      limitations.push(error instanceof Error ? `Domain fetch was blocked or failed: ${error.message}` : 'Domain fetch was blocked or failed.');
    }

    const paths = new Set<string>(['/llms.txt', '/robots.txt']);
    for (const link of linked) {
      const linkedUrl = new URL(link.url);
      const path = linkedUrl.pathname.toLowerCase();
      if (/openapi|swagger/.test(`${path} ${link.text}`)) paths.add(linkedUrl.toString());
      if (/sitemap/.test(`${path} ${link.text}`)) paths.add(linkedUrl.toString());
    }
    if (![...paths].some((path) => /sitemap/i.test(path))) paths.add('/sitemap.xml');
    for (const path of OPENAPI_PATHS) paths.add(path);
    let rootAlreadyExposesOpenApi = false;
    const linkedOpenApi = rankCandidates(candidates, input.preferred_formats ?? [], input.require_official)
      .find((route) => route.route_type === 'openapi' && route.machine_readable && route.score >= 0.92);
    if (linkedOpenApi) {
      try {
        const remaining = NETWORK_LIMITS.totalTimeoutMs - (Date.now() - startedAt);
        if (remaining > 0) {
          await withTimeout(validateUrl(linkedOpenApi.url), remaining);
          validatedCandidateUrls.add(linkedOpenApi.url);
          const linkedSpec = await readIfFetched(fetcher, linkedOpenApi.url, requests, counters, startedAt);
          const candidateIndex = candidates.findIndex((route) => route.url === linkedOpenApi.url && route.route_type === 'openapi');
          if (linkedSpec) {
            const finalHost = new URL(linkedSpec.url).hostname.toLowerCase();
            const publisherMatch = finalHost === suppliedHost?.toLowerCase() ? 'exact_domain' : 'linked_from_domain';
            const verifiedSpec = classifyProbe(linkedSpec.url, linkedSpec.body, String(linkedSpec.headers['content-type'] ?? ''), publisherMatch, 'Fetched an OpenAPI reference linked from the supplied site.', linkedSpec.status);
            if (candidateIndex >= 0) candidates.splice(candidateIndex, 1);
            if (verifiedSpec?.route_type === 'openapi') {
              verifiedSpec.auth = authFromStatus(linkedSpec.status);
              candidates.push(verifiedSpec);
              validatedCandidateUrls.add(verifiedSpec.url);
              rootAlreadyExposesOpenApi = verifiedSpec.auth !== 'appears_required';
            } else {
              const downgraded = candidate(linkedSpec.url, 'developer_docs', 'api', publisherMatch, false, ['The site linked a page labelled OpenAPI, but the fetched response did not confirm an OpenAPI document.']);
              downgraded.auth = authFromStatus(linkedSpec.status);
              candidates.push(downgraded);
              validatedCandidateUrls.add(downgraded.url);
            }
          } else if (candidateIndex >= 0) {
            const previous = candidates[candidateIndex];
            candidates.splice(candidateIndex, 1, candidate(linkedOpenApi.url, 'developer_docs', 'api', linkedOpenApi.publisher_match, false, ['The site linked a page labelled OpenAPI, but it could not be fetched within the bounded request scope.']));
            if (previous) validatedCandidateUrls.add(previous.url);
          }
        }
      } catch { /* unsafe or unresolved candidates never suppress the bounded probes */ }
    }
    for (const path of rootAlreadyExposesOpenApi ? [] : [...paths]) {
      if (requests.length >= NETWORK_LIMITS.maxHttpRequests) break;
      const url = new URL(path, root).toString();
      if (requests.includes(url)) continue;
      try {
        const remaining = NETWORK_LIMITS.totalTimeoutMs - (Date.now() - startedAt);
        if (remaining <= 0) break;
        await withTimeout(validateUrl(url), remaining);
      } catch {
        limitations.push('A discovery probe was skipped because its URL did not pass public-address safety checks.');
        continue;
      }
      const result = await readIfFetched(fetcher, url, requests, counters, startedAt);
      if (!result) continue;
      const contentType = String(result.headers['content-type'] ?? '');
      const responsePublisherMatch = new URL(result.url).hostname.toLowerCase() === suppliedHost?.toLowerCase() ? 'exact_domain' : 'linked_from_domain';
      const candidateFromResponse = result.status >= 200 && result.status < 400 || result.status === 401 || result.status === 403
        ? classifyProbe(result.url, result.body, contentType, responsePublisherMatch, `Discovered via standard ${path} endpoint probe.`, result.status) : undefined;
      if (candidateFromResponse) { candidateFromResponse.auth = authFromStatus(result.status); candidates.push(candidateFromResponse); }
      const fetchedPath = new URL(result.url).pathname;
      if (/sitemap/i.test(fetchedPath)) addSitemapCandidates(result.body, result.url, root.hostname, suppliedHost ?? root.hostname, candidates);
      if (/robots\.txt/i.test(fetchedPath)) {
        for (const sitemap of [...result.body.matchAll(/^\s*Sitemap:\s*(\S+)/gim)].slice(0, 2)) {
          const sitemapUrl = absoluteHttpUrl(sitemap[1] ?? '', result.url);
          if (sitemapUrl) {
            try {
              const remaining = NETWORK_LIMITS.totalTimeoutMs - (Date.now() - startedAt);
              if (remaining <= 0) break;
              await withTimeout(validateUrl(sitemapUrl), remaining);
            } catch {
              limitations.push('A sitemap URL was skipped because it did not pass public-address safety checks.');
              continue;
            }
            const sitemapResult = await readIfFetched(fetcher, sitemapUrl, requests, counters, startedAt);
            if (sitemapResult) addSitemapCandidates(sitemapResult.body, sitemapResult.url, root.hostname, suppliedHost ?? root.hostname, candidates);
          }
        }
      }
      if (/llms\.txt/i.test(new URL(result.url).pathname)) {
        for (const line of result.body.split(/\r?\n/).slice(0, 200)) {
          const match = line.match(/https?:\/\/[^\s)\]]+/i);
          if (!match) continue;
          const found = linkedCandidate({ url: match[0], text: line.slice(0, 240) }, suppliedHost ?? root.hostname);
          if (found) { found.reasons.unshift("Resource reference was listed in the site's llms.txt."); candidates.push(found); }
        }
      }
    }
  }

  const publicCandidates: RouteCandidate[] = [];
  const deduped = dedupeCandidates(candidates).slice(0, 30);
  if (candidates.length > 30) limitations.push('Candidate inspection was capped to keep validation work bounded.');
  for (const route of deduped) {
    if (validatedCandidateUrls.has(route.url)) { publicCandidates.push(route); continue; }
    try {
      const remaining = NETWORK_LIMITS.totalTimeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) throw new Error('Deadline reached.');
      await withTimeout(validateUrl(route.url), remaining);
      publicCandidates.push(route);
    }
    catch { limitations.push('A discovered candidate was omitted because its URL did not pass public-address safety checks.'); }
  }
  let ranked = rankCandidates(publicCandidates, input.preferred_formats ?? [], input.require_official);
  const useful = ranked.some((route) => route.machine_readable && !['structured_web', 'web'].includes(route.route_type)
    && route.auth !== 'appears_required' && route.score >= 0.75 && route.publisher_match !== 'search_discovered');
  let source: DiscoveryMetrics['source'] = ranked.length ? 'direct' : 'none';
  if (!useful && options.searchProvider) {
    const query = input.domain ? `${input.goal} ${input.domain} official API data download` : `${input.goal} official API data download dataset`;
    try {
      const remaining = NETWORK_LIMITS.totalTimeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) throw new Error('Total execution time limit reached.');
      counters.searchQueries = 1;
      source = 'search_fallback';
      const hits = await options.searchProvider.search(query, { timeoutMs: Math.min(remaining, NETWORK_LIMITS.requestTimeoutMs) });
      const safeHits: SearchHit[] = [];
      for (const hit of hits.slice(0, 10)) {
        try {
          const remainingForValidation = NETWORK_LIMITS.totalTimeoutMs - (Date.now() - startedAt);
          if (remainingForValidation <= 0) break;
          await withTimeout(validateUrl(hit.url), remainingForValidation);
          safeHits.push(hit);
        } catch { /* hostile results are discarded */ }
      }
      const eligibleHits = input.require_official ? safeHits.filter((hit) => suppliedHost && new URL(hit.url).hostname.toLowerCase() === suppliedHost.toLowerCase()) : safeHits;
      if (input.require_official && !root) limitations.push('An official publisher cannot be matched without a supplied domain; search-discovered candidates were excluded.');
      else if (input.require_official && eligibleHits.length !== safeHits.length) limitations.push('Search results without a directly observed match to the supplied domain were excluded because official sources were required.');
      ranked = rankCandidates(dedupeCandidates([...ranked, ...eligibleHits.map((hit) => searchHitCandidate(hit, suppliedHost))]), input.preferred_formats ?? [], input.require_official);
    } catch {
      limitations.push('The single external search attempt failed or timed out.');
    }
  }
  if (!options.searchProvider) limitations.push('External search fallback was unavailable because no search provider is configured; deterministic discovery was used.');
  if (Date.now() - startedAt > NETWORK_LIMITS.totalTimeoutMs) limitations.push('The total execution time limit was reached; remaining discovery was stopped.');
  if (!input.domain && ranked.length === 0 && !options.searchProvider) limitations.push('Provide a domain or configure external search to discover candidate routes.');
  if (!ranked.length) limitations.push('No suitable route was found within checked scope; this does not establish that no route exists.');

  const routes = ranked.slice(0, Math.min(input.max_candidates, NETWORK_LIMITS.maxRoutes));
  return {
    routes,
    metrics: { requests, pagesFetched: counters.pagesFetched, searchQueries: counters.searchQueries, source },
    limitations: [...new Set(limitations)],
  };
}

function dedupeCandidates(candidates: RouteCandidate[]): RouteCandidate[] {
  const byUrl = new Map<string, RouteCandidate>();
  for (const current of candidates) {
    const key = current.url.replace(/#.*$/, '');
    const existing = byUrl.get(key);
    if (!existing || current.machine_readable && !existing.machine_readable) byUrl.set(key, current);
  }
  return [...byUrl.values()];
}
