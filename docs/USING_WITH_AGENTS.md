# Using Fallback with agents

This page is for agents and agent builders who *call* Fallback. (`AGENTS.md` at the repo root is for coding agents working on this repository.)

## When to call `source_route`

Call it when you know **what** data you need and **which publisher** (a domain or start URL), but not **how** to get it in machine-readable form (API, OpenAPI spec, bulk download, dataset, feed). Do not use it for general web research, answering factual questions, or verifying facts; for source-backed facts see [FACTRAIL MCP](https://github.com/baronsigma/factrail).

## When to call `error_route`

Call it after an HTTP, API, MCP, or tool request fails when retry behavior or the safe next action is unclear. It classifies the supplied status, headers, response text, or runtime error and returns bounded retry guidance. Do not use it when recovery is obvious, the user supplied explicit recovery instructions, or the problem requires deeper domain reasoning. It does not execute requests, search the web, or invent undocumented fixes.

## Reading the result

- `routes_found`: try routes in order. `score` is a deterministic ranking, not a probability.
- `no_suitable_route_found`: nothing suitable **within the checked scope** (`checked.direct_probes`). It is not evidence that no route exists; try another host or the publisher's open-data portal.
- Always read `limitations`.

## Connecting

```json
{ "mcpServers": { "fallback": { "url": "https://fallback.factrail.online/mcp" } } }
```

The hosted service charges $0.02 per `source_route` call and $0.002 per `error_route` call via x402, **currently on the Base Sepolia test network only** (`eip155:84532`, testnet USDC; not real billing). MCP clients without x402 support receive a payment-required result; a payment-capable client (for example one built with `@x402/mcp`) is required for paid tool calls. No paid call has yet been independently verified on-chain.

To use it with no payment at all, self-host with `PAYMENT_MODE=disabled` (see the README).
