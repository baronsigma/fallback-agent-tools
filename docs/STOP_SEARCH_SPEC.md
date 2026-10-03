# stop_search

`stop_search` estimates whether the next bounded search step is worth its cost given checks and routes supplied by the caller. It does not search, call `source_route`, use an LLM, prove non-existence, or verify the evidence itself.

## Contract

- HTTP: `POST /v1/tools/stop_search`
- MCP: `stop_search`
- Version: `0.1.0-beta.1`
- Price: `$0.003` from the canonical registry.
- Results: `stop`, `continue`, or `insufficient_evidence`.

The bounded input accepts an optional goal, up to 40 checked routes, up to 20 remaining routes, optional call/cost budget and a risk level. A check records its target, method, result, authority, coverage, optional exhaustive-source assertion and optional timestamp. Inputs are capped at 24 KB.

The result reports confidence, stable reason codes, coverage by source authority, count of distinct fresh routes, a bounded next action, a scope note and limits. A stop recommendation says only that further search is not justified within the supplied scope and budget. It never says the route or API does not exist.

## Decision factors

The evaluator is deterministic and local. It:

1. Excludes evidence older than 30 days and caller timestamps more than five minutes in the future.
2. Collapses route aliases by normalized host (or normalized text label) so repeated checks do not inflate independence.
3. Abstains on contradictory results for the same route.
4. Gives more weight to primary/official sources and high-coverage checks.
5. Requires progressively stronger independent negative coverage for low, medium and high-risk tasks.
6. Continues when a high-value route remains affordable; a medium-value route can also justify continuing when the search budget is not nearly spent.
7. Uses caller-reported calls/cost already spent together with remaining budget. Near-exhausted budgets prevent low-value continuation, but weak evidence then yields abstention rather than an unsupported stop.
8. Accepts an exhaustive negative only when the caller marks a fresh high-coverage primary/official source as exhaustive. Even then the outcome remains scoped to that source's stated scope.

High risk is about search-budget conservatism only. The tool makes no legal, financial, medical or safety determination.

## Reason codes

`primary_sources_checked`, `exhaustive_source_checked`, `independent_routes_checked`, `routes_redundant`, `remaining_expected_value_low`, `budget_exhausted`, `budget_nearly_exhausted`, `evidence_too_shallow`, `high_risk_requires_more_coverage`, `promising_route_remaining`, `insufficient_independence`, and `contradictory_results`.

## Evaluation

Run `npm run benchmark:stop-search` for the labeled deterministic corpus. It reports stop/continue/abstention accuracy, premature stops, unnecessary continuation, high-risk premature stops, unsupported universal-absence claims and latency. Availability requires at least 94% accuracy, no high-risk premature stops or universal-absence violations, no more than 2% premature stops, and p95 latency under 25 ms.
