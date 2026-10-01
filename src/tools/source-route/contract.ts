import { z } from 'zod';
import { isIP } from 'node:net';
import { getDomain as getRegistrableDomain } from 'tldts';

export const preferredFormatSchema = z.enum(['json', 'csv', 'xml', 'rss', 'api', 'bulk_download', 'html']);

export const sourceRouteInputSchema = z.object({
  goal: z.string().trim().min(3).max(500),
  domain: z.hostname().trim().max(253).optional(),
  start_url: z.string().max(2048).refine((value) => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } }, 'start_url must be an absolute HTTP or HTTPS URL.').optional(),
  preferred_formats: z.array(preferredFormatSchema).max(7).optional(),
  require_official: z.boolean().default(false),
  max_candidates: z.number().int().min(1).max(10).default(5),
}).strict();

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
    score: z.number().min(0).max(1),
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
