# Product

Fallback is a small paid recovery and decision layer for autonomous agents. When an agent gets stuck, uncertain, or receives a bad tool/API response, Fallback provides the cheapest safe next move without requiring a large reasoning loop. It is not a generic API marketplace or a broad collection of unrelated utilities.

## Positioning

> Don't spend a dollar of reasoning on a cent-sized problem.

Fallback does not replace agent reasoning. Each service should answer a narrow operational question with structured output, predictable limits, and understandable per-call economics.

## Initial roadmap

| Tool | Purpose | Initial price | Status |
|---|---|---:|---|
| `source_route` | Find likely authoritative or machine-readable sources when the agent knows what it needs but not where to retrieve it | $0.02 | Available (beta) |
| `error_route` | Classify a failed request and return a bounded, safe next action | $0.002 | Available (beta) |
| `request_repair` | Propose the smallest request change justified by supplied schema or error evidence | $0.005 | Available (beta) |
| `stop_search` | Decide whether more bounded search effort is worth its expected cost | $0.003 | Available (beta) |

Tool pricing and availability are canonicalized in `src/core/registry.ts`. The product loop is: `source_route` — Where should I look? `error_route` — Why did my call fail? `request_repair` — Can I safely fix the request? `stop_search` — Is further searching worth it? `fetch_resolve` remains deferred pending usage evidence.

`source_route` starts at a supplied `start_url` (including its path) or at a supplied domain, then inspects a bounded set of publisher and standard discovery references. When no sufficiently useful direct route is found, it may use at most one configured external search request. Tavily and Brave are supported; external search is optional. It does not use LLM inference, guarantee one canonical route, or claim that an undiscovered route does not exist. `error_route` is deterministic-first and local: it uses status, selected headers, structured error fields, bounded text patterns, and common network error codes. It does not call an LLM, perform web search, retry the failed request, or echo request/response payloads. `request_repair` transforms a failed request only when caller-supplied schema, machine-readable errors, explicit HTTP headers, or tightly constrained text support a minimal change; otherwise it abstains. It never executes requests or invents credentials, identifiers, URLs, or business values. `stop_search` compares independent fresh checks, authority, coverage, risk, remaining routes and supplied search budget. It never searches and only recommends a scoped stopping point; it does not prove that information is universally absent.

## Access model

The service supports anonymous x402 V2 pay-per-call access. The price comes from the canonical registry. `PAYMENT_MODE=disabled` is for local development; `test` uses Base Sepolia (`eip155:84532`); `production` uses Base (`eip155:8453`). Production/mainnet remains operationally disabled until deployment configuration and a successful deployed test payment have been verified. No account or API key is required.
