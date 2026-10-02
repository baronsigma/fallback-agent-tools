import { classifyErrorRoute } from '../src/tools/error-route/handler.js';
import { benchmarkNow, errorRouteCases } from '../tests/fixtures/error-route-cases.js';

const durations: number[] = [];
const failures: Array<Record<string, unknown>> = [];
const confusion = new Map<string, number>();
let correctClassification = 0;
let correctRetry = 0;
let unsafeRecommendations = 0;
let unknownCount = 0;

for (const testCase of errorRouteCases) {
  const start = performance.now();
  const result = classifyErrorRoute(testCase.input, benchmarkNow);
  durations.push(performance.now() - start);
  const key = `${testCase.classification} -> ${result.classification}`;
  confusion.set(key, (confusion.get(key) ?? 0) + 1);
  const classOk = result.classification === testCase.classification;
  const retryOk = result.retry === testCase.retry;
  if (classOk) correctClassification += 1;
  if (retryOk) correctRetry += 1;
  if (!testCase.safe && result.safe_to_retry) unsafeRecommendations += 1;
  if (result.classification === 'unknown') unknownCount += 1;
  if (!classOk || !retryOk || !testCase.safe && result.safe_to_retry) failures.push({ id: testCase.id, expected: { classification: testCase.classification, retry: testCase.retry, safe: testCase.safe }, actual: { classification: result.classification, retry: result.retry, safe: result.safe_to_retry } });
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return Number((sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0).toFixed(3));
}
const clearCount = errorRouteCases.filter((testCase) => testCase.clear).length;
const summary = {
  cases: errorRouteCases.length,
  clearLabeledCases: clearCount,
  classificationAccuracyPercent: Number((correctClassification / clearCount * 100).toFixed(2)),
  retryPolicyAccuracyPercent: Number((correctRetry / clearCount * 100).toFixed(2)),
  unsafeRecommendationCount: unsafeRecommendations,
  unknownCount,
  unknownRatePercent: Number((unknownCount / errorRouteCases.length * 100).toFixed(2)),
  latencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), max: Number(Math.max(...durations).toFixed(3)) },
  confusion: Object.fromEntries([...confusion.entries()].sort(([a], [b]) => a.localeCompare(b))),
  failures,
  gates: { classificationAtLeast90Percent: correctClassification / clearCount >= 0.9, retryAtLeast95Percent: correctRetry / clearCount >= 0.95, zeroUnsafeRecommendations: unsafeRecommendations === 0, p95Below50ms: percentile(durations, 0.95) < 50 },
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (Object.values(summary.gates).some((passed) => !passed)) process.exitCode = 1;
