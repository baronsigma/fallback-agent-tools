import { z } from 'zod';

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const levelSchema = z.enum(['low', 'medium', 'high']);

const checkSchema = z.object({
  target: boundedText(300),
  method: z.enum(['direct', 'search', 'documentation', 'api_catalog', 'registry', 'browser', 'other']),
  result: z.enum(['found', 'not_found', 'inconclusive', 'error', 'blocked', 'contradictory']),
  authority: z.enum(['primary', 'official', 'secondary', 'general', 'unknown']),
  coverage: levelSchema,
  exhaustive: z.boolean().optional().default(false),
  checked_at: z.string().datetime({ offset: true }).optional(),
}).strict();

const remainingRouteSchema = z.object({
  route: boundedText(300),
  expected_value: levelSchema.or(z.literal('unknown')),
  estimated_cost_usd: z.number().finite().min(0).max(10000).optional(),
}).strict();

const budgetSchema = z.object({
  calls_used: z.number().int().min(0).max(10000).optional(),
  calls_remaining: z.number().int().min(0).max(10000).optional(),
  cost_used_usd: z.number().finite().min(0).max(10000).optional(),
  cost_remaining_usd: z.number().finite().min(0).max(10000).optional(),
}).strict().optional();

export const stopSearchInputSchema = z.object({
  goal: z.string().trim().min(1).max(500).optional(),
  checks: z.array(checkSchema).max(40).optional().default([]),
  remaining_routes: z.array(remainingRouteSchema).max(20).optional().default([]),
  search_budget: budgetSchema,
  risk: levelSchema.optional().default('medium'),
}).strict().superRefine((input, context) => {
  if (JSON.stringify(input).length > 24000) context.addIssue({ code: 'custom', message: 'Search evidence exceeds the input size limit.' });
});

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
