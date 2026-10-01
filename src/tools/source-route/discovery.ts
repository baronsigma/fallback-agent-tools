import { NETWORK_LIMITS, type SafeFetchResult, type SafeFetcher, safeFetcher, validatePublicHttpUrl } from '../../core/safe-fetch.js';
import { normalizeDomain, type SourceRouteInput } from './contract.js';
import type { SearchHit, SearchProvider } from './search-provider.js';
import { getDomain } from 'tldts';

type InternalCandidate = {
  url: string;
  route_type: 'official_api' | 'openapi' | 'bulk_download' | 'structured_feed' | 'dataset' | 'developer_docs' | 'structured_web' | 'web';
  format?: string;
  publisher_match: 'exact_domain' | 'same_site' | 'linked_from_domain' | 'search_discovered';
  verification: 'content_verified' | 'publisher_linked' | 'search_only';
  machine_readable: boolean;
  auth: 'none_observed' | 'appears_required' | 'unknown';
  score: number;
  reasons: string[];
  rankingText?: string;
  providerScore?: number;
};
export type RouteCandidate = Omit<InternalCandidate, 'rankingText' | 'providerScore'>;

export type DiscoveryMetrics = { requests: string[]; pagesFetched: number; searchQueries: number; source: 'direct' | 'search_fallback' | 'none'; providerFailure: boolean };
export type DiscoveryResult = { routes: RouteCandidate[]; metrics: DiscoveryMetrics; limitations: string[] };
export type SourceRouteDiscoveryOptions = {
  fetcher?: SafeFetcher;
  searchProvider?: SearchProvider;
  validateUrl?: (url: string) => Promise<URL>;
};

const OPENAPI_PATHS = ['/openapi.json', '/.well-known/openapi.json', '/swagger.json'];
const DIRECT_BUDGET_WITH_SEARCH = 7_000;
const DIRECT_REQUEST_CAP_WITH_SEARCH = NETWORK_LIMITS.maxHttpRequests - 2;

function publisherRelationship(host: string, suppliedHost: string, directlyLinked = false): RouteCandidate['publisher_match'] {
  const a = host.toLowerCase().replace(/\.$/, ''), b = suppliedHost.toLowerCase().replace(/\.$/, '');
  if (a === b) return 'exact_domain';
  const aDomain = getDomain(a), bDomain = getDomain(b);
  if (aDomain && bDomain && aDomain === bDomain) return 'same_site';
  return directlyLinked ? 'linked_from_domain' : 'search_discovered';
}

function isFeedLabel(value: string): boolean { return /(?:^|[\s/._-])(?:rss|atom|feed)(?:$|[\s/._-])/i.test(value); }
function isGenericAsset(url: URL, contentType = ''): boolean {
  const path = url.pathname.toLowerCase();
  return /(?:^|\/)(?:sitemap(?:[-\w]*)?\.xml|manifest\.json|service-worker(?:\.js)?|sw\.js|robots\.txt|favicon(?:\.ico)?)(?:$|\/)/.test(path)
    || /\.well-known\/(?:openapi|swagger)\.json$/i.test(path) && !contentType.includes('json')
    || /fonts?\./i.test(url.hostname) || /(?:^|\/)(?:fonts?)(?:\/|$)/.test(path)
    || /(?:font|image|javascript)/i.test(contentType) && /\.(?:woff2?|ttf|otf|ico|png|jpe?g|svg|js)(?:$|\?)/i.test(url.href);
}

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

function linkedCandidate(link: { url: string; text: string; rel?: string; type?: string; title?: string }, publisherHost: string): RouteCandidate | undefined {
  const target = new URL(link.url);
  const relationship = publisherRelationship(target.hostname, publisherHost, true);
  const trusted = relationship !== 'search_discovered';
  const label = `${link.text} ${link.title ?? ''} ${link.url} ${link.rel ?? ''} ${link.type ?? ''}`.toLowerCase();
  const contextualize = (route: InternalCandidate) => { route.rankingText = label; return route; };
  if (isGenericAsset(target, link.type ?? '')) return undefined;
  const format = /\.csv(?:$|[?#])/.test(target.href) || /text\/csv/.test(link.type ?? '') || /\bcsv\b/.test(label) ? 'csv'
    : /\.json(?:$|[?#])/.test(target.href) || /json/.test(link.type ?? '') || /\bjson\b/.test(label) ? 'json'
    : /\.xml(?:$|[?#])/.test(target.href) || /xml/.test(link.type ?? '') || /\bxml\b/.test(label) ? 'xml'
    : isFeedLabel(`${label} ${target.pathname}`) ? 'rss' : undefined;
  if (/openapi|swagger/.test(label) && trusted) return contextualize(candidate(link.url, 'openapi', 'json', relationship, true, ['OpenAPI or Swagger reference was linked from the supplied site.']));
  if (isFeedLabel(`${label} ${target.pathname}`) || /application\/(?:rss|atom)\+xml/i.test(link.type ?? '')) return contextualize(candidate(link.url, 'structured_feed', 'rss', relationship, true, ['Feed link was exposed by the supplied site.']));
  if ((/\.csv(?:$|[?#])/.test(target.href) || /text\/csv/.test(link.type ?? '')) && trusted || /dataset|download|bulk|data export/.test(label) && format) {
    return contextualize(candidate(link.url, 'bulk_download', format ?? 'csv', relationship, true, ['A downloadable structured file was linked from the supplied site.']));
  }
  if (/\.json(?:$|[?#])/.test(target.href) && trusted && /(?:dataset|download|data|indicator|api)/i.test(label)) return contextualize(candidate(link.url, 'dataset', format ?? 'json', relationship, true, ['A semantically labelled JSON resource was linked from the supplied site.']));
  if ((format === 'json' || format === 'xml') && trusted && /(?:dataset|download|data|indicator|records|observations)/i.test(label)) return contextualize(candidate(link.url, 'dataset', format, relationship, true, ['A labelled structured document was exposed through an alternate/discovery link.']));
  if (/\/api(?:\/|$)|api reference|developer|data portal|documentation|docs/.test(label)) return contextualize(candidate(link.url, /\/api(?:\/|$)/.test(target.pathname) && trusted ? 'official_api' : 'developer_docs', 'api', relationship, /\/api(?:\/|$)/.test(target.pathname) && trusted, ['API or developer documentation was linked from the supplied site.']));
  if (relationship === 'exact_domain' && link.text.length > 10 && !/wp-json|\.json|\.xml|\.csv/i.test(target.pathname)) return contextualize(candidate(link.url, 'web', 'html', relationship, false, ['Page was linked from the supplied site.']));
  return undefined;
}

function candidate(url: string, route_type: RouteCandidate['route_type'], format: string | undefined, publisher_match: RouteCandidate['publisher_match'], machine_readable: boolean, reasons: string[]): InternalCandidate {
  return { url, route_type, ...(format ? { format } : {}), publisher_match, verification: publisher_match === 'search_discovered' ? 'search_only' : 'publisher_linked', machine_readable, auth: 'unknown', score: 0, reasons };
}

function classifyProbe(url: string, body: string, contentType: string, publisherMatch: RouteCandidate['publisher_match'], reason: string, status = 200): RouteCandidate | undefined {
  const parsedUrl = new URL(url);
  const path = parsedUrl.pathname.toLowerCase();
  if (isGenericAsset(parsedUrl, contentType)) return undefined;
  if (status === 401 || status === 403) {
    if (/openapi|swagger/.test(path)) return candidate(url, 'openapi', 'json', publisherMatch, true, [reason, `Probe returned HTTP ${status}; authentication appears required.`]);
    if (/\/(?:api|data)(?:\/|$)/.test(path)) return candidate(url, 'official_api', 'api', publisherMatch, /json|xml|csv/.test(contentType), [reason, `Probe returned HTTP ${status}; authentication appears required.`]);
    return undefined;
  }
  if (/wordpress/i.test(body.slice(0, 2000)) || /(?:^|\/)wp-json(?:\/|$)/i.test(path) && !/openapi|swagger/i.test(body.slice(0, 2000))) return undefined;
  if (status >= 200 && status < 400 && /html/i.test(contentType)) {
    if (/openapi|swagger/i.test(path) && /api documentation|swagger ui|redoc/i.test(body.slice(0, 5000))) {
      const docs = candidate(url, /\/api(?:\/|$)/i.test(path) ? 'official_api' : 'developer_docs', 'api', publisherMatch, false, [reason, 'Fetched HTML presents API documentation.']);
      docs.verification = 'content_verified'; return docs;
    }
    return undefined;
  }
  const bodyLooksLikeOpenApi = /json/.test(contentType) && /"(?:openapi|swagger)"\s*:/i.test(body.slice(0, 2000))
    || /yaml|yml/.test(contentType) && /^(?:openapi|swagger)\s*:/im.test(body.slice(0, 2000));
  if (bodyLooksLikeOpenApi || /(?:openapi|swagger)/i.test(contentType) && status >= 200 && status < 300) {
    const spec = candidate(url, 'openapi', /yaml|yml/.test(contentType) ? 'yaml' : 'json', publisherMatch, true, [reason, 'Response identifies itself as an API specification.']);
    spec.verification = 'content_verified'; return spec;
  }
  if (path.endsWith('.csv') || /text\/csv/.test(contentType)) { const csv = candidate(url, 'dataset', 'csv', publisherMatch, true, [reason, 'Response is a CSV dataset.']); csv.verification = 'content_verified'; return csv; }
  if (/application\/(?:rss|atom)\+xml/i.test(contentType) || /<rss\b|<feed\b/.test(body.slice(0, 1000).toLowerCase())) { const feed = candidate(url, 'structured_feed', 'xml', publisherMatch, true, [reason, 'Response is a structured feed.']); feed.verification = 'content_verified'; return feed; }
  if (/json/.test(contentType) && /(?:^|\/)(?:api|data|dataset|indicator|download)(?:\/|$)/.test(path)) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (Array.isArray(parsed) && parsed.length > 0 || parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0 && (/(?:data|results|observations|indicators|records|features|items)/i.test(Object.keys(parsed).join(' ')) || Object.values(parsed).some(Array.isArray))) {
        const verified = candidate(url, 'dataset', 'json', publisherMatch, true, [reason, 'Response contains structured data records.']); verified.verification = 'content_verified'; return verified;
      }
    } catch { /* arbitrary or malformed JSON is not a dataset */ }
  }
  return undefined;
}

function authFromStatus(status: number): RouteCandidate['auth'] {
  return status === 401 || status === 403 ? 'appears_required' : status >= 200 && status < 400 ? 'none_observed' : 'unknown';
}

function shouldSearch(routes: InternalCandidate[], goal: string): boolean {
  const best = routes[0];
  if (!best || best.auth === 'appears_required' || best.publisher_match === 'search_discovered') return true;
  if (best.route_type === 'openapi' && best.machine_readable && best.verification === 'content_verified') return false;
  if (best.route_type === 'openapi' && best.machine_readable && best.verification === 'publisher_linked') return false;
  if (best.route_type === 'openapi' && best.machine_readable && best.verification === 'content_verified') return false;
  const relevance = goalRelevance(goal, `${best.url} ${best.rankingText ?? ''} ${best.reasons.join(' ')}`);
  const provenanceStrength = best.publisher_match === 'exact_domain' ? 1 : best.publisher_match === 'same_site' ? 0.9 : 0.68;
  const semanticStrength = relevance;
  const routeSemantics = ['official_api', 'openapi', 'dataset', 'bulk_download', 'structured_feed', 'developer_docs'].includes(best.route_type);
  const evidenceStrength = best.verification === 'content_verified' || best.verification === 'publisher_linked';
  const cleanDirectType = ['official_api', 'openapi', 'dataset', 'bulk_download', 'structured_feed'].includes(best.route_type)
    || best.route_type === 'developer_docs' && /api|documentation|docs|reference/i.test(`${best.rankingText ?? ''} ${best.url}`);
  return !(routeSemantics && cleanDirectType && evidenceStrength && provenanceStrength >= 0.68 && semanticStrength >= 0.12);
}

function searchQuery(goal: string, publisher: string | undefined, formats: string[] = []): string {
  const subject = `${goal} ${publisher ?? ''}`.trim();
  if (formats.some((format) => ['api', 'json'].includes(format))) return `${subject} API documentation JSON`;
  if (formats.some((format) => ['bulk_download', 'csv'].includes(format))) return `${subject} dataset download CSV`;
  if (formats.includes('rss')) return `${subject} feed RSS Atom`;
  if (formats.includes('html')) return `${subject} documentation`;
  return `${subject} data access documentation`;
}

const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'by', 'for', 'from', 'find', 'get', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with', 'data', 'route', 'source']);
function goalTokens(goal: string): string[] { return goal.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((token) => token.length > 2 && !STOP_WORDS.has(token)); }
export function goalRelevance(goal: string, context: string): number {
  const wanted = [...new Set(goalTokens(goal))];
  if (!wanted.length) return 0;
  const available = new Set(goalTokens(context));
  for (const token of wanted) if (token.endsWith('s')) available.add(token.slice(0, -1));
  return wanted.filter((token) => available.has(token)).length / wanted.length;
}

export function rankCandidates(candidates: InternalCandidate[], preferred: string[] = [], requireOfficial = false, goal = ''): InternalCandidate[] {
  const typeBase: Record<RouteCandidate['route_type'], number> = {
    official_api: 0.94, openapi: 0.90, bulk_download: 0.87, dataset: 0.86,
    structured_feed: 0.84, developer_docs: 0.68, structured_web: 0.62, web: 0.42,
  };
  return candidates.map((route) => {
    let score = typeBase[route.route_type];
    if (route.publisher_match === 'exact_domain') score += 0.10;
    else if (route.publisher_match === 'same_site') score += 0.08;
    else if (route.publisher_match === 'linked_from_domain') score += 0.04;
    if (route.machine_readable) score += 0.02;
    if (route.verification === 'search_only') score -= 0.12;
    if (route.auth === 'appears_required') score -= 0.12;
    if (route.auth === 'none_observed') score += 0.02;
    if (route.format && preferred.some((format) => format === route.format || (format === 'api' && ['official_api', 'openapi'].includes(route.route_type)) || (format === 'bulk_download' && ['bulk_download', 'dataset'].includes(route.route_type)))) score += 0.12;
    if (requireOfficial && route.publisher_match === 'search_discovered') score -= 0.25;
    const relevance = goalRelevance(goal, `${route.url} ${route.rankingText ?? ''}`);
    score += relevance * 0.24;
    if (route.providerScore !== undefined) score += route.providerScore * 0.025;
    if (route.verification === 'search_only' && relevance < 0.15) score -= 0.20;
    const sortScore = score;
    score = Math.max(0, Math.min(1, Math.round((score / (score + 1)) * 100) / 100));
    return { route: { ...route, score }, sortScore };
  }).sort((a, b) => b.sortScore - a.sortScore || a.route.url.localeCompare(b.route.url)).map(({ route }) => route);
}

function sitemapLocations(body: string, base: string): string[] {
  return [...body.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((match) => absoluteHttpUrl(match[1] ?? '', base)).filter((url): url is string => Boolean(url)).slice(0, 30);
}

function addSitemapCandidates(body: string, sitemapUrl: string, siteHost: string, suppliedHost: string, candidates: InternalCandidate[]): void {
  if (/<(?:sitemapindex|urlset)\b/i.test(body)) return;
  for (const location of sitemapLocations(body, sitemapUrl)) {
    const loc = new URL(location);
    if (loc.hostname.toLowerCase() !== siteHost.toLowerCase() || !/\.(?:json|csv|xml)(?:$|[?#])/i.test(loc.href)) continue;
    const ext = loc.pathname.split('.').pop()?.toLowerCase();
    if (isGenericAsset(loc)) continue;
    const feed = ext === 'xml' && isFeedLabel(loc.pathname);
    const publisherMatch = publisherRelationship(loc.hostname, suppliedHost, true);
    if (!feed && !/(?:dataset|download|data|indicator|records|observations)/i.test(loc.pathname) && ext !== 'json') continue;
    candidates.push(candidate(location, feed ? 'structured_feed' : 'dataset', ext, publisherMatch, true, ["Goal-like structured resource URL was listed in the site's sitemap."]));
  }
}

function searchHitCandidate(hit: SearchHit, domain: string | undefined): InternalCandidate {
  const url = new URL(hit.url);
  const label = `${hit.title} ${hit.description} ${url.pathname}`.toLowerCase();
  const match = domain ? publisherRelationship(url.hostname, domain) : 'search_discovered';
  const relationshipReason = match === 'exact_domain' || match === 'same_site' ? 'Search result is on the supplied publisher site family; page content was not fetched.' : 'Search result hostname was observed, but its relationship to an official publisher was not independently verified.';
  const contextualize = (route: InternalCandidate) => { route.rankingText = `${hit.title} ${hit.description} ${url.href}`; if (hit.providerScore !== undefined) route.providerScore = hit.providerScore; return route; };
  if (isGenericAsset(url)) return contextualize(candidate(hit.url, 'web', 'html', match, false, ['Search result points to a generic discovery or static asset, not a goal route.', relationshipReason]));
  const verifiedPublisher = match === 'exact_domain' || match === 'same_site';
  if (verifiedPublisher && /openapi|swagger/.test(label)) return contextualize(candidate(hit.url, 'openapi', 'json', match, false, ['Search result suggests an OpenAPI/Swagger document; content was not fetched.', relationshipReason]));
  if (verifiedPublisher && (/\.csv(?:$|[?#])/.test(url.href) || /bulk download|dataset|csv/.test(label))) return contextualize(candidate(hit.url, 'bulk_download', 'csv', match, false, ['Search result points to a possible structured download; content was not fetched.', relationshipReason]));
  if (isFeedLabel(label)) return contextualize(candidate(hit.url, 'structured_feed', 'rss', match, false, ['Search result identifies a possible feed; content was not fetched.', relationshipReason]));
  if (/api|developer|documentation|docs/.test(label)) return contextualize(candidate(hit.url, 'developer_docs', 'api', match, false, ['Search result describes API or developer documentation.', relationshipReason]));
  return contextualize(candidate(hit.url, 'web', 'html', match, false, ['Found by the single bounded external search query.', relationshipReason]));
}

async function readIfFetched(fetcher: SafeFetcher, url: string, requests: string[], budget: { pagesFetched: number }, startedAt: number, deadlineAt = startedAt + NETWORK_LIMITS.totalTimeoutMs, requestCap: number = NETWORK_LIMITS.maxHttpRequests): Promise<SafeFetchResult | undefined> {
  try {
    const remaining = Math.min(NETWORK_LIMITS.totalTimeoutMs - (Date.now() - startedAt), deadlineAt - Date.now());
    if (remaining <= 0) throw new Error('Total execution time limit reached.');
    const result = await fetcher.fetch(url, (requested) => {
      if (requests.length >= requestCap) throw new Error('HTTP request budget exceeded.');
      if (Date.now() - startedAt >= NETWORK_LIMITS.totalTimeoutMs || Date.now() >= deadlineAt) throw new Error('Discovery phase deadline reached.');
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
  let providerFailure = false;
  const candidates: InternalCandidate[] = [];
  const validatedCandidateUrls = new Set<string>();
  const limitations: string[] = [];
  const phaseDeadline = () => startedAt + (options.searchProvider ? DIRECT_BUDGET_WITH_SEARCH : NETWORK_LIMITS.totalTimeoutMs);
  let root: URL | undefined;
  let suppliedHost: string | undefined;
  let linked: Array<{ url: string; text: string; rel?: string; type?: string }> = [];

  if (input.domain || input.start_url) {
    const hostname = normalizeDomain(input.domain ?? new URL(input.start_url!).hostname);
    suppliedHost = hostname;
    const initial = input.start_url ? new URL(input.start_url) : new URL(`https://${hostname}`);
    root = new URL(initial.toString());
    try {
      const validationTime = Math.min(phaseDeadline() - Date.now(), NETWORK_LIMITS.totalTimeoutMs - (Date.now() - startedAt));
      if (validationTime <= 0) throw new Error('Total execution time limit reached.');
      await withTimeout(validateUrl(root.toString()), validationTime);
      const result = await readIfFetched(fetcher, root.toString(), requests, counters, startedAt, phaseDeadline(), options.searchProvider ? DIRECT_REQUEST_CAP_WITH_SEARCH : NETWORK_LIMITS.maxHttpRequests);
    if (result) {
        const finalUrl = new URL(result.url);
        root = finalUrl;
        linked = extractLinks(result.body, finalUrl.toString()).slice(0, 100);
        const rootPublisherMatch = publisherRelationship(finalUrl.hostname, hostname, true);
        for (const link of linked) {
          const found = linkedCandidate(link, hostname);
          if (found) { found.auth = 'unknown'; candidates.push(found); }
        }
        const rootCandidate = result.status >= 200 && result.status < 400 || result.status === 401 || result.status === 403
          ? classifyProbe(result.url, result.body, String(result.headers['content-type'] ?? ''), rootPublisherMatch, 'The domain root returned this structured response.', result.status) : undefined;
        if (rootCandidate) { rootCandidate.auth = authFromStatus(result.status); candidates.push(rootCandidate); }
    } else limitations.push('The supplied domain could not be fetched within the network safety and request limits.');
    } catch (error) {
    limitations.push(error instanceof Error ? `Domain fetch was blocked or failed: ${error.message}` : 'Domain fetch was blocked or failed.');
    }

    const paths = new Set<string>();
    if (!root.pathname.replace(/\/$/, '')) paths.add('/llms.txt');
    paths.add(new URL('/robots.txt', root.origin).toString());
    for (const link of linked) {
      const linkedUrl = new URL(link.url);
      const path = linkedUrl.pathname.toLowerCase();
      if (/openapi|swagger/.test(`${path} ${link.text}`)) paths.add(linkedUrl.toString());
      if (/sitemap/.test(`${path} ${link.text}`)) paths.add(linkedUrl.toString());
    }
    for (const link of linked.filter((x) => /sitemap/i.test(`${x.url} ${x.text}`)).slice(0, 1)) paths.add(link.url);
    const apiIntent = (input.preferred_formats ?? []).includes('api') || /\bapi\b|endpoint|openapi|swagger|machine readable schema/i.test(input.goal);
    if (apiIntent && !candidates.some((item) => item.route_type === 'openapi' && item.publisher_match !== 'search_discovered')) for (const path of OPENAPI_PATHS) paths.add(new URL(path, root.origin).toString());
    let rootAlreadyExposesOpenApi = false;
    const linkedOpenApi = rankCandidates(candidates, input.preferred_formats ?? [], input.require_official, input.goal)
      .find((route) => route.route_type === 'openapi' && route.machine_readable && route.score >= 0.92);
    if (linkedOpenApi) {
      try {
        const remaining = Math.min(phaseDeadline() - Date.now(), NETWORK_LIMITS.totalTimeoutMs - (Date.now() - startedAt));
        if (remaining > 0) {
          await withTimeout(validateUrl(linkedOpenApi.url), remaining);
          validatedCandidateUrls.add(linkedOpenApi.url);
          const linkedSpec = await readIfFetched(fetcher, linkedOpenApi.url, requests, counters, startedAt, phaseDeadline(), options.searchProvider ? DIRECT_REQUEST_CAP_WITH_SEARCH : NETWORK_LIMITS.maxHttpRequests);
          const candidateIndex = candidates.findIndex((route) => route.url === linkedOpenApi.url && route.route_type === 'openapi');
          const original = candidateIndex >= 0 ? candidates[candidateIndex] : undefined;
      if (linkedSpec) {
            const finalHost = new URL(linkedSpec.url).hostname.toLowerCase();
            const publisherMatch = publisherRelationship(finalHost, suppliedHost ?? finalHost, true);
            const verifiedSpec = classifyProbe(linkedSpec.url, linkedSpec.body, String(linkedSpec.headers['content-type'] ?? ''), publisherMatch, 'Fetched an OpenAPI reference linked from the supplied site.', linkedSpec.status);
            if (candidateIndex >= 0) candidates.splice(candidateIndex, 1);
            if (verifiedSpec?.route_type === 'openapi') {
              rootAlreadyExposesOpenApi = verifiedSpec.auth !== 'appears_required';
              if (original?.rankingText !== undefined) (verifiedSpec as InternalCandidate).rankingText = original.rankingText;
              verifiedSpec.auth = authFromStatus(linkedSpec.status);
              candidates.push(verifiedSpec);
              validatedCandidateUrls.add(verifiedSpec.url);
              rootAlreadyExposesOpenApi = verifiedSpec.auth !== 'appears_required';
            } else {
              const downgraded = candidate(linkedSpec.url, 'developer_docs', 'api', publisherMatch, false, ['The site linked a page labelled OpenAPI, but the fetched response did not confirm an OpenAPI document.']);
              if (original?.rankingText !== undefined) downgraded.rankingText = original.rankingText;
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
      if (requests.length >= (options.searchProvider ? DIRECT_REQUEST_CAP_WITH_SEARCH : NETWORK_LIMITS.maxHttpRequests)) break;
      const url = path.startsWith('http') ? path : new URL(path, root.origin).toString();
      if (requests.includes(url)) continue;
      try {
        const remaining = phaseDeadline() - Date.now();
        if (remaining <= 0) break;
        await withTimeout(validateUrl(url), remaining);
      } catch {
        limitations.push('A discovery probe was skipped because its URL did not pass public-address safety checks.');
        continue;
      }
      const result = await readIfFetched(fetcher, url, requests, counters, startedAt, phaseDeadline(), options.searchProvider ? DIRECT_REQUEST_CAP_WITH_SEARCH : NETWORK_LIMITS.maxHttpRequests);
      if (!result) continue;
      const contentType = String(result.headers['content-type'] ?? '');
      const responsePublisherMatch = publisherRelationship(new URL(result.url).hostname, suppliedHost ?? root.hostname, true);
      const candidateFromResponse = result.status >= 200 && result.status < 400 || result.status === 401 || result.status === 403
        ? classifyProbe(result.url, result.body, contentType, responsePublisherMatch, `Discovered via standard ${path} endpoint probe.`, result.status) : undefined;
      if (candidateFromResponse) { candidateFromResponse.auth = authFromStatus(result.status); candidates.push(candidateFromResponse); }
      else {
        const linkedIndex = candidates.findIndex((item) => item.url === result.url && item.verification === 'publisher_linked');
        if (linkedIndex >= 0 && /html/i.test(contentType)) {
          const previous = candidates[linkedIndex];
          if (previous) {
            const downgraded = candidate(result.url, /(?:api|developer|docs)/i.test(`${previous.rankingText ?? ''} ${result.url}`) ? 'developer_docs' : 'web', 'html', previous.publisher_match, false, ['Publisher-linked URL was fetched and returned HTML; provisional structured classification was downgraded.']);
            if (previous.rankingText !== undefined) downgraded.rankingText = previous.rankingText;
            downgraded.verification = 'content_verified';
            downgraded.auth = authFromStatus(result.status);
            candidates.splice(linkedIndex, 1, downgraded);
          }
        }
      }
      const fetchedPath = new URL(result.url).pathname;
      if (/sitemap/i.test(fetchedPath)) { addSitemapCandidates(result.body, result.url, root.hostname, suppliedHost ?? root.hostname, candidates); continue; }
      if (/robots\.txt/i.test(fetchedPath)) {
        for (const sitemap of [...result.body.matchAll(/^\s*Sitemap:\s*(\S+)/gim)].slice(0, 2)) {
          const sitemapUrl = absoluteHttpUrl(sitemap[1] ?? '', result.url);
          if (sitemapUrl) {
            try {
    const remaining = Math.min(phaseDeadline() - Date.now(), NETWORK_LIMITS.totalTimeoutMs - (Date.now() - startedAt));
              if (remaining <= 0) break;
              await withTimeout(validateUrl(sitemapUrl), remaining);
            } catch {
              limitations.push('A sitemap URL was skipped because it did not pass public-address safety checks.');
              continue;
            }
            const sitemapResult = await readIfFetched(fetcher, sitemapUrl, requests, counters, startedAt, phaseDeadline(), options.searchProvider ? DIRECT_REQUEST_CAP_WITH_SEARCH : NETWORK_LIMITS.maxHttpRequests);
            if (sitemapResult) addSitemapCandidates(sitemapResult.body, sitemapResult.url, root.hostname, suppliedHost ?? root.hostname, candidates);
          }
        }
      }
      if (/llms\.txt/i.test(new URL(result.url).pathname)) {
        for (const line of result.body.split(/\r?\n/).slice(0, 200)) {
          const match = line.match(/https?:\/\/[^\s)\]]+/i);
          if (!match) continue;
          const resourceUrl = match[0].replace(/["'<>.,;]+$/, '');
          try { new URL(resourceUrl); } catch { continue; }
          const found = linkedCandidate({ url: resourceUrl, text: line.slice(0, 240) }, suppliedHost ?? root.hostname);
          if (found) { found.reasons.unshift("Resource reference was listed in the site's llms.txt."); candidates.push(found); }
        }
      }
    }
  }

  const publicCandidates: InternalCandidate[] = [];
  const deduped = dedupeCandidates(candidates).slice(0, 30);
  if (candidates.length > 30) limitations.push('Candidate inspection was capped to keep validation work bounded.');
  for (const route of deduped) {
    if (validatedCandidateUrls.has(route.url)) { publicCandidates.push(route); continue; }
    try {
      const candidateUrl = new URL(route.url);
      if (!['http:', 'https:'].includes(candidateUrl.protocol) || candidateUrl.username || candidateUrl.password) continue;
              const remaining = Math.min(phaseDeadline() - Date.now(), NETWORK_LIMITS.totalTimeoutMs - (Date.now() - startedAt));
      if (remaining <= 0) throw new Error('Deadline reached.');
      await withTimeout(validateUrl(route.url), remaining);
      publicCandidates.push(route);
    } catch { limitations.push('A discovered candidate was omitted because its URL did not pass public-address safety checks.'); }
  }
  let ranked = rankCandidates(publicCandidates, input.preferred_formats ?? [], input.require_official, input.goal);
  for (const route of ranked) {
    const fetched = publicCandidates.find((item) => item.url === route.url && item.verification === 'content_verified');
    if (fetched) route.verification = 'content_verified';
  }
  let source: DiscoveryMetrics['source'] = ranked.length ? 'direct' : 'none';
  if (shouldSearch(ranked, input.goal) && options.searchProvider) {
    const query = searchQuery(input.goal, input.domain, input.preferred_formats);
    try {
      const remaining = NETWORK_LIMITS.totalTimeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) throw new Error('Total execution time limit reached.');
      counters.searchQueries = 1;
      source = 'search_fallback';
      const searchOptions = {
        timeoutMs: Math.min(remaining, NETWORK_LIMITS.requestTimeoutMs),
        ...(input.domain && input.require_official ? { restrictDomains: [getDomain(input.domain) ?? input.domain] } : {}),
        ...(input.domain && !input.require_official ? { preferredDomains: [getDomain(input.domain) ?? input.domain] } : {}),
      };
      const hits = await options.searchProvider.search(query, searchOptions);
      const safeHits: SearchHit[] = [];
      for (const hit of hits.slice(0, 10)) {
        try {
          const remainingForValidation = NETWORK_LIMITS.totalTimeoutMs - (Date.now() - startedAt);
          if (remainingForValidation <= 0) break;
          await withTimeout(validateUrl(hit.url), remainingForValidation);
          safeHits.push(hit);
        } catch { /* hostile results are discarded */ }
      }
      const eligibleHits = input.require_official ? safeHits.filter((hit) => suppliedHost && publisherRelationship(new URL(hit.url).hostname, suppliedHost) !== 'search_discovered') : safeHits;
      if (input.require_official && !root) limitations.push('An official publisher cannot be matched without a supplied domain; search-discovered candidates were excluded.');
      else if (input.require_official && eligibleHits.length !== safeHits.length) limitations.push('Search results without a directly observed match to the supplied domain were excluded because official sources were required.');
      const searchCandidates = eligibleHits.map((hit) => searchHitCandidate(hit, suppliedHost));
      let validationAllowance = Math.max(0, NETWORK_LIMITS.maxHttpRequests - requests.length);
      for (const route of searchCandidates.slice().sort((a, b) => (goalRelevance(input.goal, `${b.url} ${b.rankingText ?? ''}`) + (b.providerScore ?? 0) * 0.05) - (goalRelevance(input.goal, `${a.url} ${a.rankingText ?? ''}`) + (a.providerScore ?? 0) * 0.05)).slice(0, 1)) {
        if (validationAllowance <= 0) break;
        try {
          const remaining = NETWORK_LIMITS.totalTimeoutMs - (Date.now() - startedAt);
          if (remaining <= 0) break;
          await withTimeout(validateUrl(route.url), remaining);
          const fetched = await readIfFetched(fetcher, route.url, requests, counters, startedAt, startedAt + NETWORK_LIMITS.totalTimeoutMs, NETWORK_LIMITS.maxHttpRequests);
          validationAllowance = Math.max(0, NETWORK_LIMITS.maxHttpRequests - requests.length);
          if (fetched) {
            const verified = classifyProbe(fetched.url, fetched.body, String(fetched.headers['content-type'] ?? ''), route.publisher_match, 'Search result was fetched once for route validation.', fetched.status);
            const replacement = verified ?? (fetched.status >= 200 && fetched.status < 400 && /html/i.test(String(fetched.headers['content-type'] ?? ''))
              ? candidate(fetched.url, /(?:api|developer|docs)/i.test(`${route.rankingText ?? ''} ${fetched.url}`) ? 'developer_docs' : 'web', 'html', route.publisher_match, false, ['Search result was fetched and returned an HTML page; its snippet classification was downgraded.'])
              : undefined);
            if (replacement) {
              if (route.rankingText !== undefined) (replacement as InternalCandidate).rankingText = route.rankingText;
              if (route.providerScore !== undefined) (replacement as InternalCandidate).providerScore = route.providerScore;
              replacement.auth = authFromStatus(fetched.status);
              searchCandidates.splice(searchCandidates.indexOf(route), 1, replacement);
            }
          }
        } catch { /* keep the candidate as search-only when one-fetch validation is unavailable */ }
      }
      ranked = rankCandidates(dedupeCandidates([...ranked, ...searchCandidates]), input.preferred_formats ?? [], input.require_official, input.goal);
    } catch {
      providerFailure = true;
      limitations.push('External search fallback failed or was unavailable.');
    }
  }
  if (!options.searchProvider) limitations.push('External search fallback was unavailable because no search provider is configured; deterministic discovery was used.');
  if (Date.now() - startedAt > NETWORK_LIMITS.totalTimeoutMs) limitations.push('The total execution time limit was reached; remaining discovery was stopped.');
  if (!input.domain && !input.start_url && ranked.length === 0 && !options.searchProvider) limitations.push('Provide a domain or configure external search to discover candidate routes.');
  if (!ranked.length) limitations.push('No suitable route was found within checked scope; this does not establish that no route exists.');

  const routes = ranked.slice(0, Math.min(input.max_candidates, NETWORK_LIMITS.maxRoutes)).map((route) => {
    const publicRoute: RouteCandidate = { url: route.url, route_type: route.route_type, ...(route.format ? { format: route.format } : {}), publisher_match: route.publisher_match, verification: route.verification, machine_readable: route.machine_readable, auth: route.auth, score: route.score, reasons: route.reasons };
    return publicRoute;
  });
  return {
    routes,
    metrics: { requests, pagesFetched: counters.pagesFetched, searchQueries: counters.searchQueries, source, providerFailure },
    limitations: [...new Set(limitations)],
  };
}

function dedupeCandidates(candidates: InternalCandidate[]): InternalCandidate[] {
  const byUrl = new Map<string, RouteCandidate>();
  for (const current of candidates) {
    const key = current.url.replace(/#.*$/, '');
    const existing = byUrl.get(key);
    if (!existing || current.machine_readable && !existing.machine_readable) byUrl.set(key, current);
  }
  return [...byUrl.values()];
}
