import { z } from 'zod';
import { isIP } from 'node:net';
import { getDomain as getRegistrableDomain } from 'tldts';

export const preferredFormatSchema = z.enum(['json', 'csv', 'xml', 'rss', 'api', 'bulk_download', 'html']).describe('One preferred route format: json, csv, xml, rss, api, bulk_download, or html.');

export const sourceRouteDescription = 'Find likely authoritative or machine-readable sources when you know what information you need but not where to retrieve it. Provide a goal and optional publisher domain or start URL; it returns ranked candidate routes and bounded evidence. Use it before blind searching. Do not use it when you already have the correct source or only need reasoning over supplied context.';

export const sourceRouteInputSchema = z.object({
  goal: z.string().trim().min(3).max(500).describe('What information to retrieve, in 3 to 500 characters. Used to rank access routes, not to answer a general research question.'),
  domain: z.hostname().trim().max(253).optional().describe('Optional publisher DNS hostname to inspect. IP addresses, URLs, and credentials are rejected.'),
  start_url: z.string().max(2048).refine((value) => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } }, 'start_url must be an absolute HTTP or HTTPS URL.').optional().describe('Optional absolute HTTP or HTTPS URL to start from. Its path and query are kept. When domain is also set, both must identify the same publisher root.'),
  preferred_formats: z.array(preferredFormatSchema).max(7).optional().describe('Optional formats to prefer when ranking routes, at most 7. Each item is json, csv, xml, rss, api, bulk_download, or html.'),
  require_official: z.boolean().default(false).describe('When true, omit search results that are not on the supplied publisher host. Defaults to false. This does not assert legal authority.'),
  max_candidates: z.number().int().min(1).max(10).default(5).describe('Maximum ranked routes to return, from 1 to 10. Defaults to 5.'),
}).strict().describe('Publisher and goal for bounded source-route discovery. The tool may read public HTTP resources; it does not accept credentials or executable content.');

export const routeTypeSchema = z.enum([
  'official_api', 'openapi', 'bulk_download', 'structured_feed', 'dataset', 'developer_docs', 'structured_web', 'web',
]);

export const publisherMatchSchema = z.enum(['exact_domain', 'same_site', 'linked_from_domain', 'search_discovered']);
export const verificationSchema = z.enum(['content_verified', 'publisher_linked', 'search_only']);
export const authSchema = z.enum(['none_observed', 'appears_required', 'unknown']);

export const sourceRouteOutputSchema = z.object({
  status: z.enum(['routes_found', 'no_suitable_route_found', 'insufficient_input']),
  routes: z.array(z.object({
    url: z.string().url(),
    route_type: routeTypeSchema,
    format: z.string().optional(),
    publisher_match: publisherMatchSchema,
    verification: verificationSchema,
    machine_readable: z.boolean(),
    auth: authSchema,
    score: z.number().min(0).max(1).describe('Bounded route-ranking value combining publisher relationship, route semantics, goal relevance, format preference, and observed authentication. Not a probability or confidence estimate.'),
    reasons: z.array(z.string()).max(8),
  }).strict()).max(10),
  checked: z.object({
    direct_probes: z.array(z.string()).max(16),
    pages_fetched: z.number().int().nonnegative(),
    search_queries: z.number().int().min(0).max(1),
  }).strict(),
  limitations: z.array(z.string()).max(12),
}).strict();

export type SourceRouteInput = z.infer<typeof sourceRouteInputSchema>;
export type SourceRouteOutput = z.infer<typeof sourceRouteOutputSchema>;

export class SourceRouteInputError extends Error {
  constructor(message: string) { super(message); this.name = 'SourceRouteInputError'; }
}

export function normalizeDomain(input: string): string {
  const value = input.trim();
  if (!value) throw new Error('domain must not be empty.');
  if (value.includes('://') || /[/\\@?#]/.test(value)) throw new Error('domain must be a hostname; protocols, credentials, paths, queries, and fragments are not accepted.');
  const hostname = value.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname.length > 253 || hostname.includes('%')) throw new Error('domain is malformed.');
  if (hostname.includes(':') && !isIP(hostname)) throw new Error('domain is malformed.');
  if (isIP(hostname)) throw new Error('domain must be a DNS hostname, not an IP address.');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new Error('Local hostnames are not allowed.');
  if (!hostname.includes(':') && !isIP(hostname) && (!hostname.includes('.') || !hostname.split('.').every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part)))) {
    throw new Error('domain must be a valid hostname.');
  }
  return hostname;
}

export function parseSourceRouteInput(input: unknown): SourceRouteInput {
  const parsed = sourceRouteInputSchema.parse(input);
  let domain = parsed.domain;
  let startUrl: URL | undefined;
  try {
    if (domain) domain = normalizeDomain(domain);
    if (parsed.start_url) {
      startUrl = new URL(parsed.start_url);
      if (!['http:', 'https:'].includes(startUrl.protocol)) throw new Error('start_url must use HTTP or HTTPS.');
      if (startUrl.username || startUrl.password) throw new Error('start_url credentials are not allowed.');
      startUrl.hash = '';
      const startHost = normalizeDomain(startUrl.hostname);
      if (domain && normalizeDomain(domain) !== startHost && getRegistrableDomain(normalizeDomain(domain)) !== getRegistrableDomain(startHost)) throw new Error('domain and start_url must identify compatible publisher roots.');
      domain ??= startHost;
    }
    return { ...parsed, ...(domain ? { domain } : {}), ...(startUrl ? { start_url: startUrl.toString() } : {}) };
  } catch (error) { throw new SourceRouteInputError(error instanceof Error ? error.message : 'domain or start_url is invalid.'); }
}
