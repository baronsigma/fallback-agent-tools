# Using Fallback with agents

This page is for agents and agent builders who *call* Fallback. (`AGENTS.md` at the repo root is for coding agents working on this repository.)

## When to call `source_route`

Call it when you know **what** data you need and **which publisher** (a domain or start URL), but not **how** to get it in machine-readable form (API, OpenAPI spec, bulk download, dataset, feed). Do not use it for general web research, answering factual questions, or verifying facts; for source-backed facts see [FACTRAIL MCP](https://github.com/baronsigma/factrail).

## When to call `error_route`

Call it after an HTTP, API, MCP, or tool request fails when retry behavior or the safe next action is unclear. It classifies the supplied status, headers, response text, or runtime error and returns bounded retry guidance. Do not use it when recovery is obvious, the user supplied explicit recovery instructions, or the problem requires deeper domain reasoning. It does not execute requests, search the web, or invent undocumented fixes.

## When to call `request_repair`

Call it after a failed API or HTTP request when evidence points to an input or request-shape problem. Supply the failed request, response, and any request schema or OpenAPI-derived schema available to you. It proposes only changes supported by that evidence and returns `insufficient_evidence` when a repair would require guessing.

Do not use it for API discovery, general troubleshooting, authentication/authorization failures, network or TLS failures, generic server errors, payment failures, or missing values you do not already have. It does not send requests or retry them. Review the proposed patch before retrying.

## Compact recovery workflow

```text
call API → failure → error_route → classification=schema_mismatch
→ request_repair(failed request + response + available schema)
→ review repaired_request and changes → retry if justified
```

`error_route` diagnoses and recommends; `request_repair` transforms only when the supplied evidence supports a minimal change.

## When to call `stop_search`

Call it after several source, browser, or search checks when another query or paid retrieval has a cost and the search is becoming repetitive. Include the distinct targets checked, their result, authority, coverage, any remaining routes and the search budget. It weighs independence, freshness, risk and expected value; a result of `stop` is scoped to those supplied checks.

Do not call it before meaningful search, while an obvious high-value route remains unchecked, to prove universal non-existence, or for a high-risk task with shallow coverage. It does not perform searches and does not claim that a route or API does not exist everywhere.

## Four-tool product loop

| Tool | Agent question |
|---|---|
| `source_route` | Where should I look? |
| `error_route` | Why did my call fail? |
| `request_repair` | Can I safely fix the request? |
| `stop_search` | Is further searching worth it? |

## Reading the result

- `routes_found`: try routes in order. `score` is a deterministic ranking, not a probability.
- `no_suitable_route_found`: nothing suitable **within the checked scope** (`checked.direct_probes`). It is not evidence that no route exists; try another host or the publisher's open-data portal.
- Always read `limitations`.

## Connecting

```json
{ "mcpServers": { "fallback": { "url": "https://fallback.factrail.online/mcp" } } }
```

The hosted service uses x402 V2 pay-per-call on the Base Sepolia test network (`eip155:84532`; test USDC, not real billing). Current prices are `source_route` $0.02, `error_route` $0.002, `request_repair` $0.005, and `stop_search` $0.003. HTTP and MCP payment flows for the existing tools have been validated; this milestone does not make a real paid `stop_search` call. MCP clients without x402 support receive a payment-required result; a payment-capable client (for example one built with `@x402/mcp`) is required for paid tool calls.

To use it with no payment at all, self-host with `PAYMENT_MODE=disabled` (see the README).
