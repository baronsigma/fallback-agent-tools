# Fallback

**Don't spend a dollar of reasoning on a cent-sized problem.**

Fallback is a collection of small, bounded, pay-per-call utilities for autonomous AI agents. It resolves small external uncertainties that block an agent's next action; it does not replace agent reasoning.

`source_route` is the first available tool (v0.1.0-beta.1, $0.02/call). It returns **ranked candidate access routes**, preferably authoritative and machine-readable where possible, within a bounded checked scope. It does not guarantee one canonical route; absence is not proof of nonexistence. `stop_search` and `error_route` remain planned and unavailable.

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
