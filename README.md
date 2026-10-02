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

The available tools are `source_route` ($0.02/call), which finds likely authoritative or machine-readable sources, and `error_route` ($0.002/call), which classifies a failed request and recommends a bounded next action. `stop_search` remains planned. Neither tool replaces agent reasoning or claims certainty beyond its checked evidence.

## Hosted beta

The public beta is available at [fallback.factrail.online](https://fallback.factrail.online). Its Streamable HTTP MCP endpoint is [fallback.factrail.online/mcp](https://fallback.factrail.online/mcp), and its [agent skill](https://fallback.factrail.online/skill.md) explains when to use each tool. `source_route` costs $0.02/call; `error_route` costs $0.002/call. x402 payments use Base Sepolia (`eip155:84532`). Use testnet funds only; paid end-to-end settlement is still being verified.

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
