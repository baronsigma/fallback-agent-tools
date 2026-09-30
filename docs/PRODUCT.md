# Product

Fallback is a set of small, bounded utilities that resolve external uncertainty when an autonomous agent is blocked on its next action.

## Positioning

> Don't spend a dollar of reasoning on a cent-sized problem.

Fallback does not replace agent reasoning. Each service should answer a narrow operational question with structured output, predictable limits, and understandable per-call economics.

## Initial roadmap

| Tool | Purpose | Initial price | Status |
|---|---|---:|---|
| `source_route` | Find an authoritative or machine-readable access path | $0.01 | Planned |
| `stop_search` | Decide whether a bounded negative search can reasonably stop | $0.02 | Planned |
| `error_route` | Classify a tool/API error and select a next action | $0.002 | Planned |

These values are canonicalized in `src/core/registry.ts`. The tools have no behavioral implementation in this scaffold.

## Access model

The target production model is anonymous pay-per-call access using x402. No account or API key should be required. Payment acceptance and settlement remain disabled until deployment configuration and end-to-end payment verification are completed.
