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

Fallback is a collection of small, bounded, pay-per-call utilities for autonomous AI agents. It resolves small external uncertainties that block an agent's next action; it does not replace agent reasoning.

`source_route` is the first available tool (v0.1.0-beta.1, $0.02/call). It returns **ranked candidate access routes**, preferably authoritative and machine-readable where possible, within a bounded checked scope. It does not guarantee one canonical route; absence is not proof of nonexistence. `stop_search` and `error_route` remain planned and unavailable.

## Hosted beta

The public beta is available at [fallback.factrail.online](https://fallback.factrail.online). Its Streamable HTTP MCP endpoint is [fallback.factrail.online/mcp](https://fallback.factrail.online/mcp), and its health check is [fallback.factrail.online/healthz](https://fallback.factrail.online/healthz). The service currently offers `source_route` at $0.02 per call. **Payments run on the Base Sepolia test network only** (x402 TEST mode, `eip155:84532`, testnet USDC): this is not real billing, and mainnet is not enabled. Use testnet funds only; the paid end-to-end settlement flow is still being verified.

## When an agent should use this

Use `source_route` when an agent knows **what** it needs and **which publisher** (a domain or start URL), but not **how** to get it in machine-readable form: an API, OpenAPI spec, bulk download, dataset or feed.

- Good fit: "Get the latest population dataset from Eurostat", "Find a JSON/CSV route for this agency's statistics", before the agent starts browsing page by page.
- Not a fit: general web research, answering a factual question, or verifying a fact (for source-backed facts, see [FACTRAIL MCP](https://github.com/baronsigma/factrail)). Planned tools (`stop_search`, `error_route`) are not callable.

How to read the result:
- `status: routes_found`: try routes in order. `score` is a deterministic ranking, **not** a probability or confidence.
- `status: no_suitable_route_found`: nothing suitable **within the checked scope** (see `checked.direct_probes`). This is **not** evidence that no route exists. The agent should look elsewhere (another host, the publisher's open-data portal), not conclude "there is no API".
- Always read `limitations`. It says, for example, whether external search was unavailable or candidate inspection was capped.

Limits per call: at most 8 direct HTTP requests, 12 s total, 1 MiB per response, and at most 1 external search request. No LLM inference. The hosted beta currently runs deterministic discovery only (no search provider configured).

Access: hosted MCP `https://fallback.factrail.online/mcp` (Streamable HTTP) or `POST /v1/tools/source_route`, x402 pay-per-call, **currently Base Sepolia testnet only** (testnet USDC; no account or API key). To try it without any payment, self-host with `PAYMENT_MODE=disabled` (see Local development). Machine-readable summary: [`llms.txt`](llms.txt) (also served at `/llms.txt`). More detail: [Using Fallback with agents](docs/USING_WITH_AGENTS.md).

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

The server exposes `/`, `/healthz`, `/readyz`, `/catalog.json`, `/openapi.json`, `/llms.txt`, `/llms-full.txt`, `/.well-known/x402.json`, `/.well-known/mcp/server-card.json`, and the Streamable HTTP MCP endpoint at `/mcp`. Both HTTP and MCP dispatch through the shared runtime handler registry. `PAYMENT_MODE=disabled` supports local development; paid deployments must explicitly select `test` or `production` and provide complete x402 configuration.

## Verification

```sh
npm test
npm run typecheck
npm run lint
npm run benchmark:source-route
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
