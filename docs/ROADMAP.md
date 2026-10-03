# Recovery product roadmap

Fallback is a small paid recovery and decision layer for autonomous agents, not a generic API marketplace or a broad collection of unrelated utilities.

## Sequence

1. `source_route` — find likely authoritative or machine-readable sources when the agent knows what it needs but not where to retrieve it.
2. `error_route` — classify failed requests and recommend a bounded safe next action.
3. `request_repair` — available beta: minimally transform a request when schema or error evidence supports the change. See [REQUEST_REPAIR_SPEC](REQUEST_REPAIR_SPEC.md).
4. `stop_search` — available beta: decide whether more bounded searching is justified by independent evidence, risk, remaining routes and budget. See [STOP_SEARCH_SPEC](STOP_SEARCH_SPEC.md).
5. `fetch_resolve` — deferred until usage evidence shows a need for controlled fetching and resolution.

`request_repair` and `stop_search` passed their deterministic evaluation gates and are available in beta. Do not add generic provider marketplaces, general procedural route ranking, or model-based diagnosis to `error_route`.
