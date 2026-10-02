# Fallback

```text
  ______      _ _
 |  ____|    | | |
 | |__  __ _ | | |__   __ _  ___| | __
 |  __|/ _` || | '_ \ / _` |/ __| |/ /
 | |  | (_| || | |_) | (_| | (__|   <
 |_|   \__,_||_|_.__/ \__,_|\___|_|\_\

       find the route forward
```

**Don't spend a dollar of reasoning on a cent-sized problem.**

Fallback is a small paid recovery and decision layer for autonomous agents. When an agent gets stuck, uncertain, or receives a bad tool/API response, it offers a cheap, bounded next move without requiring a large reasoning loop.

The available tools are `source_route` ($0.02/call), which finds likely authoritative or machine-readable sources, and `error_route` ($0.002/call), which classifies a failed request and recommends a bounded next action. `stop_search` remains planned. Neither tool replaces agent reasoning or claims certainty beyond its checked evidence.

## Hosted beta

The public beta is available at [fallback.factrail.online](https://fallback.factrail.online). Its Streamable HTTP MCP endpoint is [fallback.factrail.online/mcp](https://fallback.factrail.online/mcp), and its health check is [fallback.factrail.online/healthz](https://fallback.factrail.online/healthz). The [agent skill](https://fallback.factrail.online/skill.md) explains when to use each tool. `source_route` costs $0.02/call; `error_route` costs $0.002/call. **Payments run on the Base Sepolia test network only** (x402 TEST mode, `eip155:84532`, testnet USDC): this is not real billing, and mainnet is not enabled. Use testnet funds only; the paid end-to-end settlement flow is still being verified.

## When an agent should use this

Use `source_route` when an agent knows **what** it needs and **which publisher** (a domain or start URL), but not **how** to get it in machine-readable form: an API, OpenAPI spec, bulk download, dataset or feed.

- Good fit: "Get the latest population dataset from Eurostat", "Find a JSON/CSV route for this agency's statistics", before the agent starts browsing page by page.
- Not a fit: general web research, answering a factual question, or verifying a fact (for source-backed facts, see [FACTRAIL MCP](https://github.com/baronsigma/factrail)). `stop_search` remains planned.

How to read the result:
- `status: routes_found`: try routes in order. `score` is a deterministic ranking, **not** a probability or confidence.
- `status: no_suitable_route_found`: nothing suitable **within the checked scope** (see `checked.direct_probes`). This is **not** evidence that no route exists. The agent should look elsewhere (another host, the publisher's open-data portal), not conclude "there is no API".
- Always read `limitations`. It says, for example, whether external search was unavailable or candidate inspection was capped.

Limits per call: at most 8 direct HTTP requests, 12 s total, 1 MiB per response, and at most 1 external search request. No LLM inference. The hosted beta currently runs deterministic discovery only (no search provider configured).

Access: hosted MCP `https://fallback.factrail.online/mcp` (Streamable HTTP) or the documented HTTP tool routes, x402 pay-per-call, **currently Base Sepolia testnet only** (`eip155:84532`, testnet USDC; no account or API key). To try it without any payment, self-host with `PAYMENT_MODE=disabled` (see Local development). Machine-readable summary: [`llms.txt`](llms.txt) (also served at `/llms.txt`). More detail: [Using Fallback with agents](docs/USING_WITH_AGENTS.md).

## When to use `error_route`

Use it after an HTTP, API, MCP, or tool request fails when the safe next action is unclear. It classifies supplied evidence and returns bounded retry guidance. Do not use it when recovery is already obvious or the task needs deeper domain reasoning; it does not execute requests or invent undocumented fixes.

## Requirements

- Current Node.js LTS (Node 24 at scaffold creation; supported engine is Node 22+)
- npm

## Local development

```sh
npm install
cp .env.example .env
npm run generate
npm run dev
```

The server exposes `/`, `/healthz`, `/readyz`, `/catalog.json`, `/openapi.json`, `/llms.txt`, `/llms-full.txt`, `/skill.md`, `/.well-known/x402.json`, `/.well-known/mcp/server-card.json`, and the Streamable HTTP MCP endpoint at `/mcp`. Both HTTP and MCP dispatch through the shared runtime handler registry. `PAYMENT_MODE=disabled` supports local development; paid deployments must explicitly select `test` or `production` and provide complete x402 configuration.

## Verification

```sh
npm test
npm run typecheck
npm run lint
npm run benchmark:source-route
npm run benchmark:error-route
npm run verify:catalog
npm run release:check
```

## Architecture

`src/core/registry.ts` is the one canonical tool registry. Every discovery surface and distribution artifact is derived from it. Each tool gets a directory under `src/tools/` with a contract and handler; future tool tests and fixtures belong alongside the matching contract test/fixture directories. HTTP and MCP adapters must call the same tool handler. Payment middleware and marketplace integrations stay outside tool logic.

The service supports x402 V2 per-call payment without accounts or API keys. The server only receives payment at `X402_PAY_TO`; no receiving wallet private key is required. Paid startup fails closed if the required network, receiving address, facilitator URL, or production URL is missing or invalid. See [deployment and payment setup](docs/DEPLOYMENT.md).

## Example

```json
{
  "goal": "Download the latest population dataset",
  "start_url": "https://ec.europa.eu/eurostat/",
  "preferred_formats": ["csv", "json"]
}
```

Call `POST /v1/tools/source_route` with a goal and either `start_url` or `domain`. The result is limited to the checked scope; a missing result does not mean that no route exists. Direct site discovery runs without external search credentials. If Tavily or Brave is configured and direct discovery is insufficient, the tool can make at most one search request.

See [PRODUCT](docs/PRODUCT.md), [ARCHITECTURE](docs/ARCHITECTURE.md), [TOOL_ADMISSION](docs/TOOL_ADMISSION.md), [DISTRIBUTION](docs/DISTRIBUTION.md), and [RELEASE](docs/RELEASE.md).

## Related: FACTRAIL MCP

Fallback comes from the same author and design rule as [FACTRAIL MCP](https://github.com/baronsigma/factrail): agent tools should report what they checked, not only what they found. FACTRAIL answers "what is established about this fact, and from which source?" by returning evidence envelopes with support levels, unresolved fields and receipts ("unknown is better than invented"). Fallback answers "where can I get this data?" ("absence is not proof of nonexistence"). The two are independent services with no code dependency, and you can use either one alone.
