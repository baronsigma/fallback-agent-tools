# Product

Fallback is a set of small, bounded utilities that resolve external uncertainty when an autonomous agent is blocked on its next action.

## Positioning

> Don't spend a dollar of reasoning on a cent-sized problem.

Fallback does not replace agent reasoning. Each service should answer a narrow operational question with structured output, predictable limits, and understandable per-call economics.

## Initial roadmap

| Tool | Purpose | Initial price | Status |
|---|---|---:|---|
| `source_route` | Return ranked candidate access routes, preferably authoritative and machine-readable where possible | $0.02 | Available (beta) |
| `stop_search` | Decide whether a bounded negative search can reasonably stop | $0.02 | Planned |
| `error_route` | Classify a tool/API error and select a next action | $0.002 | Planned |

These values are canonicalized in `src/core/registry.ts`. `stop_search` and `error_route` have no behavioral implementation yet.

`source_route` starts at a supplied `start_url` (including its path) or at a supplied domain, then inspects a bounded set of publisher and standard discovery references. When no sufficiently useful direct route is found, it may use at most one configured external search request. Tavily and Brave are supported; external search is optional. It does not use LLM inference, guarantee one canonical route, or claim that an undiscovered route does not exist.

## Access model

The service supports anonymous x402 V2 pay-per-call access. The price comes from the canonical registry. `PAYMENT_MODE=disabled` is for local development; `test` uses Base Sepolia (`eip155:84532`); `production` uses Base (`eip155:8453`). Production/mainnet remains operationally disabled until deployment configuration and a successful deployed test payment have been verified. No account or API key is required.
