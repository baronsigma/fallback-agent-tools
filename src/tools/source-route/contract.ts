import { z } from 'zod';
import { isIP } from 'node:net';

export const preferredFormatSchema = z.enum(['json', 'csv', 'xml', 'rss', 'api', 'bulk_download', 'html']);

export const sourceRouteInputSchema = z.object({
  goal: z.string().trim().min(3).max(500),
  domain: z.hostname().trim().max(253).optional(),
  preferred_formats: z.array(preferredFormatSchema).max(7).optional(),
  require_official: z.boolean().default(false),
  max_candidates: z.number().int().min(1).max(10).default(5),
}).strict();

export const routeTypeSchema = z.enum([
  'official_api', 'openapi', 'bulk_download', 'structured_feed', 'dataset', 'developer_docs', 'structured_web', 'web',
]);

export const publisherMatchSchema = z.enum(['exact_domain', 'linked_from_domain', 'search_discovered']);
export const authSchema = z.enum(['none_observed', 'appears_required', 'unknown']);

export const sourceRouteOutputSchema = z.object({
  status: z.enum(['routes_found', 'no_suitable_route_found', 'insufficient_input']),
  routes: z.array(z.object({
    url: z.string().url(),
    route_type: routeTypeSchema,
    format: z.string().optional(),
    publisher_match: publisherMatchSchema,
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
  if (!parsed.domain) return parsed;
  try { return { ...parsed, domain: normalizeDomain(parsed.domain) }; }
  catch (error) { throw new SourceRouteInputError(error instanceof Error ? error.message : 'domain is invalid.'); }
}
