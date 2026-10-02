# Recovery product roadmap

Fallback is a small paid recovery and decision layer for autonomous agents, not a generic API marketplace or a broad collection of unrelated utilities.

## Sequence

1. `source_route` — find likely authoritative or machine-readable sources when the agent knows what it needs but not where to retrieve it.
2. `error_route` — classify failed requests and recommend a bounded safe next action.
3. `request_repair` — future spec only: minimally transform a request when strong schema or error evidence supports the change. See [REQUEST_REPAIR_SPEC](REQUEST_REPAIR_SPEC.md).
4. `stop_search` — future decision tool to decide whether additional searching is justified from bounded negative evidence.
5. `fetch_resolve` — deferred until usage evidence shows a need for controlled fetching and resolution.

Only the first two are candidates for implementation in this phase. Do not add generic provider marketplaces, general procedural route ranking, or model-based diagnosis to `error_route`.
