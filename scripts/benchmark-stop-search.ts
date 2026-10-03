import { evaluateStopSearch } from '../src/tools/stop-search/handler.js';
import { stopSearchCases } from '../tests/fixtures/stop-search-cases.js';

const benchmarkNow = new Date('2026-10-03T00:00:00.000Z');
const durations: number[] = [];
const failures: Array<Record<string, unknown>> = [];
let correct = 0;
let correctStops = 0;
let correctContinues = 0;
let correctAbstentions = 0;
let prematureStops = 0;
let unnecessaryContinues = 0;
let highRiskPrematureStops = 0;
let universalAbsenceViolations = 0;

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return Number((sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0).toFixed(3));
}

for (const testCase of stopSearchCases) {
  const start = performance.now();
  let result;
  try { result = evaluateStopSearch(testCase.input, benchmarkNow); }
  catch (error) {
    failures.push({ id: testCase.id, error: error instanceof Error ? error.message : String(error) });
    continue;
  }
  durations.push(performance.now() - start);
  const matched = result.decision === testCase.expected;
  if (matched) {
    correct += 1;
    if (result.decision === 'stop') correctStops += 1;
    if (result.decision === 'continue') correctContinues += 1;
    if (result.decision === 'insufficient_evidence') correctAbstentions += 1;
  } else failures.push({ id: testCase.id, expected: testCase.expected, actual: result.decision, reasons: result.reason_codes });
  if (result.decision === 'stop' && testCase.expected !== 'stop') {
    prematureStops += 1;
    if (testCase.highRiskClear) highRiskPrematureStops += 1;
  }
  if (result.decision === 'continue' && testCase.expected === 'stop') unnecessaryContinues += 1;
  const hasExhaustivePrimary = Boolean((testCase.input as { checks?: Array<{ exhaustive?: boolean; coverage?: string; authority?: string }> }).checks?.some((check) => check.exhaustive && check.coverage === 'high' && ['primary', 'official'].includes(check.authority ?? '')));
  if (/\b(?:does not exist|doesn't exist|no such (?:route|api) exists|none exists anywhere)\b/i.test(result.scope_note) && !hasExhaustivePrimary) universalAbsenceViolations += 1;
}

const scoredCases = durations.length;
const nonStopCases = stopSearchCases.filter((testCase) => testCase.expected !== 'stop').length;
const expectedStops = stopSearchCases.filter((testCase) => testCase.expected === 'stop').length;
const summary = {
  cases: stopSearchCases.length,
  scoredCases,
  correctStopDecisions: correctStops,
  correctContinueDecisions: correctContinues,
  correctAbstentions: correctAbstentions,
  overallDecisionAccuracyPercent: Number((correct / Math.max(1, scoredCases) * 100).toFixed(2)),
  prematureStopRatePercent: Number((prematureStops / Math.max(1, nonStopCases) * 100).toFixed(2)),
  unnecessaryContinueRatePercent: Number((unnecessaryContinues / Math.max(1, expectedStops) * 100).toFixed(2)),
  highRiskPrematureStopCount: highRiskPrematureStops,
  universalAbsenceClaimViolationCount: universalAbsenceViolations,
  latencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), max: Number(Math.max(0, ...durations).toFixed(3)) },
  failures,
  gates: {
    overallAccuracyAtLeast94Percent: correct / Math.max(1, scoredCases) >= 0.94,
    zeroHighRiskPrematureStops: highRiskPrematureStops === 0,
    zeroUnsupportedUniversalAbsenceClaims: universalAbsenceViolations === 0,
    prematureStopRateAtMost2Percent: prematureStops / Math.max(1, nonStopCases) <= 0.02,
    p95Below25Ms: percentile(durations, 0.95) < 25,
  },
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (Object.values(summary.gates).some((passed) => !passed)) process.exitCode = 1;
