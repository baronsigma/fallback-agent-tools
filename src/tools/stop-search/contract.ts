import { z } from 'zod';

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const levelSchema = z.enum(['low', 'medium', 'high']);

const checkSchema = z.object({
  target: boundedText(300).describe('Route, URL, or source label already checked, from 1 to 300 characters.'),
  method: z.enum(['direct', 'search', 'documentation', 'api_catalog', 'registry', 'browser', 'other']).describe('How the caller checked this target: direct, search, documentation, api_catalog, registry, browser, or other.'),
  result: z.enum(['found', 'not_found', 'inconclusive', 'error', 'blocked', 'contradictory']).describe('Caller-reported outcome: found, not_found, inconclusive, error, blocked, or contradictory.'),
  authority: z.enum(['primary', 'official', 'secondary', 'general', 'unknown']).describe('Caller-reported source authority: primary, official, secondary, general, or unknown.'),
  coverage: levelSchema.describe('How much of this target the caller reports having covered: low, medium, or high.'),
  exhaustive: z.boolean().optional().default(false).describe('True only when the caller asserts this fresh high-coverage primary or official source was checked exhaustively for its own scope. Defaults to false.'),
  checked_at: z.string().datetime({ offset: true }).optional().describe('Optional RFC 3339 timestamp with a timezone offset. Evidence older than 30 days, or more than five minutes in the future, is treated as stale.'),
}).strict().describe('One caller-reported check. This tool does not perform the check.');

const remainingRouteSchema = z.object({
  route: boundedText(300).describe('Unchecked route the caller could still try, from 1 to 300 characters.'),
  expected_value: levelSchema.or(z.literal('unknown')).describe('Caller-estimated value of trying this route: low, medium, high, or unknown.'),
  estimated_cost_usd: z.number().finite().min(0).max(10000).optional().describe('Caller-estimated USD cost of trying this route, from 0 to 10000. Not a price charged by this service.'),
}).strict().describe('One route the caller has not checked yet.');

const budgetSchema = z.object({
  calls_used: z.number().int().min(0).max(10000).optional().describe('Search or retrieval calls the caller has already spent, from 0 to 10000.'),
  calls_remaining: z.number().int().min(0).max(10000).optional().describe('Search or retrieval calls the caller can still spend, from 0 to 10000.'),
  cost_used_usd: z.number().finite().min(0).max(10000).optional().describe('Caller-reported USD already spent on this search, from 0 to 10000.'),
  cost_remaining_usd: z.number().finite().min(0).max(10000).optional().describe('Caller-reported USD still available for this search, from 0 to 10000.'),
}).strict().optional().describe('Optional caller-reported search budget. This service does not meter or quote that budget.');

export const stopSearchInputSchema = z.object({
  goal: z.string().trim().min(1).max(500).optional().describe('What the caller is still trying to find, from 1 to 500 characters.'),
  checks: z.array(checkSchema).max(40).optional().default([]).describe('Checks the caller already performed, at most 40. Defaults to an empty list. This tool does not run them.'),
  remaining_routes: z.array(remainingRouteSchema).max(20).optional().default([]).describe('Routes the caller has not tried, at most 20. Defaults to an empty list.'),
  search_budget: budgetSchema,
  risk: levelSchema.optional().default('medium').describe('How costly a wrong stop would be for the search budget: low, medium, or high. Defaults to medium. This is not a legal, medical, or safety judgment.'),
}).strict().superRefine((input, context) => {
  if (JSON.stringify(input).length > 24000) context.addIssue({ code: 'custom', message: 'Search evidence exceeds the input size limit.' });
}).describe('Caller-supplied search evidence for a stop-or-continue decision. The tool performs no searches and does not prove absence.');

export const stopSearchReasonCodes = [
  'primary_sources_checked',
  'exhaustive_source_checked',
  'independent_routes_checked',
  'routes_redundant',
  'remaining_expected_value_low',
  'budget_exhausted',
  'budget_nearly_exhausted',
  'evidence_too_shallow',
  'high_risk_requires_more_coverage',
  'promising_route_remaining',
  'insufficient_independence',
  'contradictory_results',
] as const;

export const stopSearchOutputSchema = z.object({
  decision: z.enum(['stop', 'continue', 'insufficient_evidence']),
  confidence: z.number().min(0).max(1),
  reason_codes: z.array(z.enum(stopSearchReasonCodes)).min(1).max(6),
  coverage: z.object({
    primary: levelSchema,
    secondary: levelSchema,
    independent_routes: z.number().int().min(0).max(40),
  }).strict(),
  next_action: z.enum(['return_not_found_with_scope', 'continue_search', 'use_found_candidate', 'gather_more_evidence']),
  scope_note: z.string().min(1).max(240),
  limits: z.array(z.string().max(180)).max(4),
}).strict();

export type StopSearchInput = z.input<typeof stopSearchInputSchema>;
export type ParsedStopSearchInput = z.output<typeof stopSearchInputSchema>;
export type StopSearchOutput = z.infer<typeof stopSearchOutputSchema>;
