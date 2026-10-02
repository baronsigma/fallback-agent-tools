# source_route evaluation set

`source-route-cases.json` is the public evaluation set for `source_route`: 27 publisher cases (statistics agencies, open-data portals, registries, developer docs, feeds), each with the route types, domains and URL terms that count as a useful answer. Run it yourself:

```sh
npm run eval:source-route            # deterministic discovery only (no search provider)
npm run eval:source-route -- --search --provider tavily   # needs provider credentials
```

Each run writes a JSON + Markdown report to `eval-results/` (git-ignored). Published runs are kept in [`results/`](results/).

## Published runs

| Date | Mode | Useful top-1 | Useful top-3 | No route | p95 latency | Notes |
|---|---|---:|---:|---:|---:|---|
| 2026-10-02 | deterministic-only | 70.4% | 77.8% | 7.4% | 6.7 s | [report](results/2026-10-02-deterministic.md). Adds platform-aware spec probes (Opendatasoft/Huwise, udata). Same-day baseline without them: 66.7% / 74.1%, BOAMP no route. |

The provisional quality gates (top-1 ≥ 75%, top-3 ≥ 90%, p95 ≤ 5.5 s) are **not yet met**. Results depend on live third-party sites and change over time; treat them as a snapshot, not a guarantee.
