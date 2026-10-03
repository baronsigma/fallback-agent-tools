import { successResponse } from '../../core/response.js';
import type { ToolHandler } from '../../core/tool.js';
import { stopSearchInputSchema, stopSearchOutputSchema, type ParsedStopSearchInput, type StopSearchOutput } from './contract.js';

const level = { low: 0, medium: 1, high: 2 } as const;
const STOP_LIMIT = 'A stop decision applies only to the supplied, checked scope and does not prove universal absence.';

type Check = ParsedStopSearchInput['checks'][number];
function routeKey(target: string): string {
  try {
    const url = new URL(target.includes('://') ? target : `https://${target}`);
    if (url.hostname.includes('.')) return `host:${url.hostname.toLowerCase().replace(/^www\./, '')}`;
  } catch { /* Normalize non-URL route labels below. */ }
  const normalized = target.toLowerCase().normalize('NFKC')
    .replace(/\b(?:google|bing|duckduckgo|general|web)\s+(?:web\s+)?search(?:\s+(?:for|query))?\b/g, '')
    .replace(/\b(?:search|query|website|homepage|route|source|the|for)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  return `label:${normalized}`;
}

function isStale(check: Check, now: Date): boolean {
  if (!check.checked_at) return false;
  const checked = Date.parse(check.checked_at);
  return !Number.isFinite(checked) || checked > now.getTime() + 5 * 60_000 || now.getTime() - checked > 30 * 24 * 60 * 60_000;
}

function coverageLevel(checks: Check[], authority: 'primary' | 'secondary'): StopSearchOutput['coverage']['primary'] {
  const matching = checks.filter((check) => authority === 'primary'
    ? check.authority === 'primary' || check.authority === 'official'
    : check.authority === 'secondary' || check.authority === 'general');
  const best = matching.reduce((current, check) => Math.max(current, level[check.coverage]), -1);
  return best < 0 ? 'low' : best === 2 ? 'high' : best === 1 ? 'medium' : 'low';
}

function decide(parsed: ParsedStopSearchInput, now: Date): StopSearchOutput {
  const reason = new Set<StopSearchOutput['reason_codes'][number]>();
  const fresh = parsed.checks.filter((check) => !isStale(check, now));
  const staleCount = parsed.checks.length - fresh.length;
  const groups = new Map<string, Check[]>();
  for (const check of fresh) {
    const key = routeKey(check.target);
    groups.set(key, [...(groups.get(key) ?? []), check]);
  }
  const contradictory = [...groups.values()].some((entries) => entries.some((check) => check.result === 'contradictory')
    || entries.some((check) => check.result === 'found') && entries.some((check) => check.result === 'not_found'));
  const independentChecks = [...groups.values()].map((entries) => entries
    .sort((left, right) => level[right.coverage] - level[left.coverage])[0]!).filter(Boolean);
  const negatives = independentChecks.filter((check) => check.result === 'not_found');
  const found = independentChecks.filter((check) => check.result === 'found');
  const primary = negatives.filter((check) => check.authority === 'primary' || check.authority === 'official');
  const highCoverage = negatives.filter((check) => check.coverage === 'high').length;
  const exhaustive = negatives.some((check) => check.exhaustive && check.coverage === 'high'
    && (check.authority === 'primary' || check.authority === 'official'));
  const callsRemaining = parsed.search_budget?.calls_remaining;
  const callsUsed = parsed.search_budget?.calls_used;
  const costRemaining = parsed.search_budget?.cost_remaining_usd;
  const costUsed = parsed.search_budget?.cost_used_usd;
  const exhausted = callsRemaining === 0 || costRemaining === 0;
  const budgetUseRatios = [
    callsUsed !== undefined && callsRemaining !== undefined && callsUsed + callsRemaining > 0 ? callsUsed / (callsUsed + callsRemaining) : undefined,
    costUsed !== undefined && costRemaining !== undefined && costUsed + costRemaining > 0 ? costUsed / (costUsed + costRemaining) : undefined,
  ].filter((ratio): ratio is number => ratio !== undefined);
  const budgetNearlyExhausted = !exhausted && budgetUseRatios.some((ratio) => ratio >= 0.8);
  const affordableRoutes = parsed.remaining_routes.filter((route) =>
    (callsRemaining === undefined || callsRemaining > 0)
    && (costRemaining === undefined || route.estimated_cost_usd === undefined || route.estimated_cost_usd <= costRemaining));
  const promisingRoutes = affordableRoutes.filter((route) => route.expected_value === 'high');
  const worthwhileRoutes = affordableRoutes.filter((route) => route.expected_value === 'high' || route.expected_value === 'medium');
  const routesUnaffordable = parsed.remaining_routes.length > 0 && affordableRoutes.length === 0;
  const routeCount = independentChecks.length;
  const coverage = {
    primary: coverageLevel(negatives, 'primary'),
    secondary: coverageLevel(negatives, 'secondary'),
    independent_routes: routeCount,
  };
  const base = { coverage, limits: [STOP_LIMIT] };
  const result = (decision: StopSearchOutput['decision'], confidence: number, codes: StopSearchOutput['reason_codes'], next: StopSearchOutput['next_action'], note: string): StopSearchOutput => ({
    ...base, decision, confidence, reason_codes: [...new Set(codes)], next_action: next, scope_note: note,
  });

  if (contradictory) {
    reason.add('contradictory_results');
    return result('insufficient_evidence', 0.2, [...reason], 'gather_more_evidence', 'The supplied checks disagree about the same route; resolve that conflict before deciding whether the search scope is covered.');
  }

  if (found.length > 0 && parsed.risk !== 'high' && worthwhileRoutes.length === 0 && found.some((check) =>
    (check.authority === 'primary' || check.authority === 'official') && check.coverage === 'high')) {
    reason.add('primary_sources_checked');
    if (routeCount > 1) reason.add('independent_routes_checked');
    return result('stop', 0.9, [...reason], 'use_found_candidate', 'A candidate was reported in the checked scope; this decision does not verify that candidate.');
  }

  if (exhaustive) {
    reason.add('primary_sources_checked');
    reason.add('exhaustive_source_checked');
    return result('stop', 0.97, [...reason], 'return_not_found_with_scope', 'No suitable result was reported by the caller-designated exhaustive source within its stated scope.');
  }

  const enoughCoverage = parsed.risk === 'low'
    ? negatives.length >= 2 && primary.length >= 1 && highCoverage >= 1
    : parsed.risk === 'medium'
      ? negatives.length >= 3 && primary.length >= 2 && highCoverage >= 1
      : negatives.length >= 4 && primary.length >= 3 && highCoverage >= 2;

  if (primary.length > 0) reason.add('primary_sources_checked');
  if (routeCount >= 2) reason.add('independent_routes_checked');
  if (routeCount < fresh.length) reason.add('routes_redundant');
  if (routeCount < 2) reason.add('insufficient_independence');
  if (staleCount > 0 || negatives.length < (parsed.risk === 'high' ? 4 : parsed.risk === 'medium' ? 3 : 2) || highCoverage === 0) reason.add('evidence_too_shallow');

  if (parsed.risk === 'high' && !enoughCoverage) reason.add('high_risk_requires_more_coverage');
  if (promisingRoutes.length > 0) reason.add('promising_route_remaining');
  else if (parsed.remaining_routes.length === 0 || affordableRoutes.length > 0 && affordableRoutes.every((route) => route.expected_value === 'low' || route.expected_value === 'unknown')) reason.add('remaining_expected_value_low');
  if (exhausted || routesUnaffordable) reason.add('budget_exhausted');
  if (budgetNearlyExhausted) reason.add('budget_nearly_exhausted');

  if (enoughCoverage && budgetNearlyExhausted && promisingRoutes.length === 0) {
    const note = found.length > 0
      ? 'A candidate was reported within the checked scope; the remaining budget and evidence do not justify another search, but this does not verify the candidate.'
      : 'No suitable route was found within the checked scope and most of the supplied search budget has been used; this does not establish that none exists elsewhere.';
    return result('stop', 0.86, [...reason], found.length > 0 ? 'use_found_candidate' : 'return_not_found_with_scope', note);
  }

  if (enoughCoverage && promisingRoutes.length === 0 && worthwhileRoutes.length === 0) {
    const note = found.length > 0
      ? 'A candidate was reported in the checked scope; this decision does not verify that candidate.'
      : 'No suitable route was found within the checked publisher and documentation scope; this does not establish that none exists elsewhere.';
    return result('stop', parsed.risk === 'high' ? 0.9 : 0.86, [...reason], found.length > 0 ? 'use_found_candidate' : 'return_not_found_with_scope', note);
  }
  if (promisingRoutes.length > 0 || !budgetNearlyExhausted && (worthwhileRoutes.length > 0 || !enoughCoverage && affordableRoutes.length > 0 && !exhausted)) {
    if (reason.size === 0) reason.add('evidence_too_shallow');
    return result('continue', parsed.risk === 'high' ? 0.84 : promisingRoutes.length > 0 ? 0.8 : 0.72, [...reason], 'continue_search', 'Continue only within the remaining routes and budget supplied by the caller.');
  }
  if (reason.size === 0) reason.add('evidence_too_shallow');
  return result('insufficient_evidence', 0.35, [...reason], 'gather_more_evidence', 'The supplied checks do not establish enough independent coverage to recommend stopping or spending another search step.');
}

export function evaluateStopSearch(rawInput: unknown, now = new Date()): StopSearchOutput {
  const parsed = stopSearchInputSchema.parse(rawInput);
  return stopSearchOutputSchema.parse(decide(parsed, now));
}

export const handleStopSearch: ToolHandler<typeof stopSearchInputSchema, typeof stopSearchOutputSchema> = async (rawInput, context) => {
  const startedAt = new Date();
  const result = evaluateStopSearch(rawInput);
  return successResponse({ toolId: 'stop_search', toolVersion: '0.1.0-beta.1', requestId: context.requestId, result, startedAt });
};
