# Architecture

## Source of truth

`src/core/registry.ts` owns every public tool identifier, description, schema, price, status, route, MCP name, example, latency target, x402 discovery setting, and marketplace identifier. Product-wide text and endpoint paths live in `src/core/product.ts`. The generator projects these sources into HTTP catalog/OpenAPI, LLM discovery text, server-card metadata, x402 readiness data, MCP Registry `server.json`, and marketplace mirror files.

Generated outputs are committed for review and deployment. Never edit them manually.

## Execution path

HTTP or MCP transport -> transport/payment adapter -> canonical availability gate -> runtime handler registry -> tool handler -> common response envelope. `src/core/registry.ts` remains the sole canonical metadata registry; `src/core/handlers.ts` maps canonical IDs to implementations and validates that every available ID has exactly a known executable implementation. Transports dispatch by ID through this shared registry and never own tool business logic. Pricing lookup is registry-owned. Marketplace logic is an offline publisher concern.

An unavailable tool is denied before its handler can run. An available paid tool will be exposed only after its payment configuration is verified. HTTP and MCP must call the same handler implementation.

`source_route` returns ranked candidate access routes and does not promise a unique canonical result. It starts at a supplied `start_url` (preserving its path and query) or at a supplied domain. It calls a shared safe-fetch utility that permits only HTTP/HTTPS to public addresses, revalidates redirects, pins a validated DNS result for the connection, limits request/response size, and enforces time budgets. Deterministic discovery runs first. If it finds no sufficiently useful direct route, the `SearchProvider` abstraction permits at most one external query using the explicitly selected provider. Tavily and Brave are supported; no provider is required.

`request_repair` keeps its canonical recursive JSON-compatible input validator for HTTP, OpenAPI, and MCP. `ToolRecord.discoveryInputSchema` is an optional projection used only for x402/Bazaar discovery metadata. Its `request_repair` projection expands the recursive JSON value schema once and leaves arbitrary nested values permissive, so the installed Bazaar validator receives no unresolved local references without weakening runtime validation.

`stop_search` weighs distinct fresh routes, source authority and coverage, explicit contradictions, risk, remaining-route value and cost, and remaining/already-spent search budget. It does not search. A stop recommendation is always scoped to caller-supplied evidence and never asserts universal absence.

`error_route` is a local deterministic classifier for failed HTTP, API, MCP, and tool requests. It consumes bounded caller-supplied status, headers, response text, and runtime error codes; redacts credential-like values; and returns a stable classification with conservative retry guidance. It makes no network request, does not call an LLM, and never executes the request being diagnosed.

`/mcp` is active Streamable HTTP. The current official MCP server package constructs a per-request server instance and derives callable tools from the canonical registry. HTTP and MCP both dispatch through the same runtime handler registry. In paid modes, official `@x402/express` middleware protects the HTTP route and official `@x402/mcp` wraps MCP tool calls using the x402 MCP payment exchange; both prices derive from the same registry record.

Payment modes are explicit: `disabled` permits local uncharged execution, `test` accepts Base Sepolia (`eip155:84532`), and `production` accepts Base mainnet (`eip155:8453`). Paid startup validates all configuration and initializes the configured facilitator before listening. No private receiving key is required. The external search or publisher fetch handler is unreachable until the relevant x402 verification/settlement path allows execution.

Anonymous rate limiting uses the socket IP by default. `TRUST_PROXY_HOPS` is zero by default and should be set only when the service is reachable solely through a known reverse-proxy chain. Production base URL is provided by `PUBLIC_BASE_URL`; there is no operational default hostname.

## Response envelope

Success and failure responses share `success`, `toolId`, `toolVersion`, `requestId`, and `execution`. Success carries `result`; failure carries a structured error with code, message, retryability, and optional details. Confidence or evidence fields belong only to tools whose semantics require them.

## Discovery and standards

- `/catalog.json`, `/openapi.json`, `/llms.txt`, `/llms-full.txt`, and `/skill.md` are Fallback projections.
- MCP Registry `server.json` uses the official registry server schema version dated 2025-12-11.
- The MCP Server Card follows the published MCP Server Card v1 schema and well-known URI. This surface is supplemental discovery metadata; server-card work is tracked separately from the MCP core tools protocol.
- x402 Bazaar discovery uses the official `bazaar` extension on payable route declarations. It is not a standalone catalog file format. `/.well-known/x402.json` is Fallback's own readiness and canonical metadata projection, not a claimed x402-standard endpoint.
- The payable HTTP route declares the official Bazaar extension when payment mode is active. MCP paid-tool challenges include the MCP Bazaar extension. The generated `/.well-known/x402.json` remains explicitly Fallback-owned metadata, not an x402-standard well-known endpoint.

## Dependencies

The implementation uses TypeScript, Zod, Express, the official MCP TypeScript server package, and official x402 V2 SDK packages. Payment dependencies are isolated behind `src/surfaces/x402/` so payment-specific APIs do not leak into domain handlers.
