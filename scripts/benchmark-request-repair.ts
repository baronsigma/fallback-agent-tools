import { repairRequest } from '../src/tools/request-repair/handler.js';
import { requestRepairCases } from '../tests/fixtures/request-repair-cases.js';

const durations: number[] = [];
let correctRepairs = 0;
let falseRepairs = 0;
let unsupportedModifications = 0;
let intentPreservationFailures = 0;
let excessiveChangeCount = 0;
let correctAbstentions = 0;
let secretLeakCount = 0;
const failures: Array<Record<string, unknown>> = [];

function equal(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown): unknown => Array.isArray(value)
    ? value.map(normalize)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, normalize(entry)]))
      : value;
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return Number((sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0).toFixed(3));
}

for (const testCase of requestRepairCases) {
  const start = performance.now();
  let result;
  try { result = repairRequest(testCase.input); }
  catch (error) {
    failures.push({ id: testCase.id, failure: error instanceof Error ? error.message : String(error) });
    if (testCase.shouldRepair) unsupportedModifications += 1;
    continue;
  }
  durations.push(performance.now() - start);
  const repaired = result.status === 'repair_available';
  let correct = !testCase.shouldRepair && !repaired;
  if (repaired && !testCase.shouldRepair) falseRepairs += 1;
  if (testCase.shouldRepair && repaired) {
    const expectedChanges = testCase.expectedChanges ?? [];
    const actualChanges = result.changes.map(({ path, operation }) => ({ path, operation }));
    correct = equal(actualChanges, expectedChanges)
      && (testCase.expectedBody === undefined || equal(result.repaired_request?.body, testCase.expectedBody))
      && (testCase.expectedQuery === undefined || equal(result.repaired_request?.query, testCase.expectedQuery))
      && (testCase.expectedHeaders === undefined || equal(result.repaired_request?.headers, testCase.expectedHeaders))
      && (testCase.expectedMethod === undefined || result.repaired_request?.method === testCase.expectedMethod);
  }
  if (testCase.shouldRepair && correct) correctRepairs += 1;
  if (!testCase.shouldRepair && correct) correctAbstentions += 1;
  if (testCase.shouldRepair && !correct || !testCase.shouldRepair && repaired) unsupportedModifications += 1;
  if (result.changes.length > 3) excessiveChangeCount += 1;
  if (repaired && result.repaired_request?.url !== result.original_request.url) intentPreservationFailures += 1;
  if (testCase.expectedMethod !== undefined && repaired && result.repaired_request?.method !== testCase.expectedMethod) intentPreservationFailures += 1;
  const serialized = JSON.stringify(result);
  for (const secret of ['benchmark-secret-token', 'benchmark-body-secret']) if (serialized.includes(secret)) secretLeakCount += 1;
  if (!correct) failures.push({ id: testCase.id, expected: { shouldRepair: testCase.shouldRepair, changes: testCase.expectedChanges, body: testCase.expectedBody, query: testCase.expectedQuery, headers: testCase.expectedHeaders, method: testCase.expectedMethod }, actual: { status: result.status, changes: result.changes, request: result.repaired_request } });
}

const repairable = requestRepairCases.filter((testCase) => testCase.shouldRepair).length;
const nonRepairable = requestRepairCases.length - repairable;
const summary = {
  cases: requestRepairCases.length,
  repairableCases: repairable,
  nonRepairableCases: nonRepairable,
  correctRepairRatePercent: Number((correctRepairs / repairable * 100).toFixed(2)),
  falseRepairRatePercent: Number((falseRepairs / nonRepairable * 100).toFixed(2)),
  unsupportedModificationCount: unsupportedModifications,
  abstentionAccuracyPercent: Number((correctAbstentions / nonRepairable * 100).toFixed(2)),
  intentPreservationFailureCount: intentPreservationFailures,
  excessiveChangeCount,
  secretLeakCount,
  latencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), max: Number(Math.max(...durations).toFixed(3)) },
  failures,
  gates: {
    correctRepairAtLeast92Percent: correctRepairs / repairable >= 0.92,
    noUnsupportedInventedValues: unsupportedModifications === 0,
    abstentionAtLeast98Percent: correctAbstentions / nonRepairable >= 0.98,
    noSecretLeakage: secretLeakCount === 0,
    noIntentChangingSubstitutions: intentPreservationFailures === 0,
    p95Below50Ms: percentile(durations, 0.95) < 50,
    maxThreeSemanticChanges: excessiveChangeCount === 0,
  },
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (Object.values(summary.gates).some((passed) => !passed)) process.exitCode = 1;
