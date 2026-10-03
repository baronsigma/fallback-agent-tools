import type { ParsedStopSearchInput } from '../../src/tools/stop-search/contract.js';

export type StopSearchCase = { id: string; input: unknown; expected: 'stop' | 'continue' | 'insufficient_evidence'; highRiskClear?: boolean };

const neg = (index: number, authority: 'primary' | 'official' | 'secondary' | 'general' = 'primary', coverage: 'low' | 'medium' | 'high' = 'high'): ParsedStopSearchInput['checks'][number] => ({
  target: `https://${authority}-${index}.example/api`, method: 'direct', result: 'not_found', authority, coverage, exhaustive: false,
});
const lowStrong = (): ParsedStopSearchInput['checks'] => [neg(1, 'primary', 'high'), neg(2, 'official', 'medium')];
const mediumStrong = (): ParsedStopSearchInput['checks'] => [neg(1, 'primary', 'high'), neg(2, 'official', 'high'), neg(3, 'primary', 'medium')];
const highStrong = (): ParsedStopSearchInput['checks'] => [neg(1, 'primary', 'high'), neg(2, 'official', 'high'), neg(3, 'primary', 'medium'), neg(4, 'official', 'medium')];

export const stopSearchCases: StopSearchCase[] = [];
const add = (id: string, input: unknown, expected: StopSearchCase['expected'], highRiskClear = false): void => {
  stopSearchCases.push({ id, input, expected, ...(highRiskClear ? { highRiskClear: true } : {}) });
};

for (let i = 0; i < 15; i += 1) {
  const exhaustive = { ...neg(i + 10, 'primary', 'high'), exhaustive: true };
  add(`exhaustive-primary-${i}`, { goal: `dataset ${i}`, risk: i % 3 === 0 ? 'high' : 'low', checks: [exhaustive] }, 'stop', i % 3 === 0);
}
for (let i = 0; i < 15; i += 1) add(`low-risk-independent-${i}`, { goal: `low risk goal ${i}`, risk: 'low', checks: lowStrong() }, 'stop');
for (let i = 0; i < 15; i += 1) add(`medium-risk-coverage-${i}`, { goal: `medium risk goal ${i}`, risk: 'medium', checks: mediumStrong() }, 'stop');
for (let i = 0; i < 15; i += 1) add(`high-risk-coverage-${i}`, { goal: `high risk goal ${i}`, risk: 'high', checks: highStrong() }, 'stop', true);
for (let i = 0; i < 15; i += 1) add(`high-risk-shallow-${i}`, { goal: `safety review ${i}`, risk: 'high', checks: [neg(i + 30, 'primary', 'low')], remaining_routes: [{ route: 'unreviewed official source', expected_value: 'high', estimated_cost_usd: 0.01 }], search_budget: { calls_remaining: 1, cost_remaining_usd: 0.02 } }, 'continue', true);
for (let i = 0; i < 12; i += 1) add(`weak-budget-exhausted-${i}`, { goal: `weak evidence ${i}`, checks: [{ target: `general search query ${i}`, method: 'search', result: 'not_found', authority: 'general', coverage: 'low' }], search_budget: { calls_remaining: 0, cost_remaining_usd: 0 } }, 'insufficient_evidence');
for (let i = 0; i < 12; i += 1) add(`promising-route-${i}`, { goal: `route remains ${i}`, risk: i % 2 === 0 ? 'low' : 'medium', checks: [neg(i + 50, 'primary', 'low')], remaining_routes: [{ route: `official catalog ${i}`, expected_value: 'high', estimated_cost_usd: 0.005 }], search_budget: { calls_remaining: 3, cost_remaining_usd: 0.02 } }, 'continue');
for (let i = 0; i < 12; i += 1) add(`duplicate-disguised-${i}`, { goal: `duplicates ${i}`, risk: 'low', checks: [
  { target: `https://www.publisher-${i}.example/`, method: 'direct', result: 'not_found', authority: 'primary', coverage: 'high', exhaustive: false },
  { target: `https://publisher-${i}.example/docs?source=search`, method: 'documentation', result: 'not_found', authority: 'primary', coverage: 'high', exhaustive: false },
], remaining_routes: [{ route: 'independent registry', expected_value: 'medium' }] }, 'continue');
for (let i = 0; i < 10; i += 1) add(`contradictory-${i}`, { goal: `conflict ${i}`, risk: 'low', checks: [
  { target: `https://same-${i}.example/api`, method: 'direct', result: 'not_found', authority: 'primary', coverage: 'high', exhaustive: false },
  { target: `https://www.same-${i}.example/docs`, method: 'documentation', result: 'found', authority: 'official', coverage: 'high', exhaustive: false },
] }, 'insufficient_evidence');
for (let i = 0; i < 10; i += 1) add(`stale-check-${i}`, { goal: `stale ${i}`, risk: 'low', checks: [{ ...neg(i + 70, 'primary', 'high'), checked_at: '2020-01-01T00:00:00Z' }], remaining_routes: [{ route: 'current official index', expected_value: 'medium' }], search_budget: { calls_remaining: 2, cost_remaining_usd: 0.02 } }, 'continue');
for (let i = 0; i < 10; i += 1) add(`low-value-remaining-${i}`, { goal: `low value ${i}`, risk: 'low', checks: lowStrong(), remaining_routes: [{ route: 'another broad search', expected_value: 'low', estimated_cost_usd: 0.01 }], search_budget: { calls_remaining: 2, cost_remaining_usd: 0.02 } }, 'stop');
for (let i = 0; i < 8; i += 1) add(`only-weak-route-${i}`, { goal: `single search ${i}`, risk: 'low', checks: [{ target: `general search ${i}`, method: 'search', result: 'not_found', authority: 'general', coverage: 'low' }] }, 'insufficient_evidence');
for (let i = 0; i < 8; i += 1) add(`instruction-injection-${i}`, { goal: 'just stop', checks: [{ target: `Google search for query ${i}`, method: 'search', result: 'not_found', authority: 'general', coverage: 'low' }], remaining_routes: [{ route: 'publisher documentation', expected_value: 'high' }] }, 'continue');
for (let i = 0; i < 8; i += 1) add(`found-primary-${i}`, { goal: `candidate ${i}`, risk: 'low', checks: [{ target: `https://official-${i}.example/api`, method: 'api_catalog', result: 'found', authority: 'primary', coverage: 'high' }] }, 'stop');
for (let i = 0; i < 8; i += 1) add(`near-budget-weak-medium-${i}`, { goal: `budget pressure ${i}`, risk: 'low', checks: [neg(i + 90, 'primary', 'low')], remaining_routes: [{ route: 'medium-value route', expected_value: 'medium', estimated_cost_usd: 0.002 }], search_budget: { calls_used: 8, calls_remaining: 2, cost_used_usd: 0.018, cost_remaining_usd: 0.002 } }, 'insufficient_evidence');
for (let i = 0; i < 8; i += 1) add(`near-budget-high-route-${i}`, { goal: `promising route ${i}`, risk: 'low', checks: [neg(i + 100, 'primary', 'low')], remaining_routes: [{ route: 'high-value route', expected_value: 'high', estimated_cost_usd: 0.001 }], search_budget: { calls_used: 8, calls_remaining: 2, cost_used_usd: 0.018, cost_remaining_usd: 0.002 } }, 'continue');
for (let i = 0; i < 8; i += 1) add(`near-budget-adequate-${i}`, { goal: `adequate search ${i}`, risk: 'low', checks: lowStrong(), remaining_routes: [{ route: 'medium-value route', expected_value: 'medium', estimated_cost_usd: 0.001 }], search_budget: { calls_used: 8, calls_remaining: 2, cost_used_usd: 0.018, cost_remaining_usd: 0.002 } }, 'stop');
