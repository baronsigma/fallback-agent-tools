# Product

Fallback is a set of small, bounded utilities that resolve external uncertainty when an autonomous agent is blocked on its next action.

## Positioning

> Don't spend a dollar of reasoning on a cent-sized problem.

Fallback does not replace agent reasoning. Each service should answer a narrow operational question with structured output, predictable limits, and understandable per-call economics.

## Initial roadmap

| Tool | Purpose | Initial price | Status |
|---|---|---:|---|
| `source_route` | Find a practical, preferably authoritative and machine-readable access path | $0.02 | Available (beta) |
| `stop_search` | Decide whether a bounded negative search can reasonably stop | $0.02 | Planned |
| `error_route` | Classify a tool/API error and select a next action | $0.002 | Planned |

These values are canonicalized in `src/core/registry.ts`. `stop_search` and `error_route` have no behavioral implementation yet.

`source_route` inspects a supplied domain's root, a short list of standard discovery endpoints, linked OpenAPI/feed/download references, `robots.txt` sitemap declarations, `llms.txt`, and sitemap entries. When no sufficiently useful direct route is found, it may use at most one configured external search request. Tavily is the preferred MVP provider; Brave remains supported. External search is optional. It does not use LLM inference or claim that an undiscovered route does not exist.

## Access model

The target production model is anonymous pay-per-call access using x402. No account or API key should be required. Payment acceptance and settlement remain disabled until deployment configuration and end-to-end payment verification are completed.
