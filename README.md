# Fallback

**Don't spend a dollar of reasoning on a cent-sized problem.**

Fallback is a collection of small, bounded, pay-per-call utilities for autonomous AI agents. It resolves small external uncertainties that block an agent's next action; it does not replace agent reasoning.

`source_route` is the first available tool (beta, $0.02/call). `stop_search` and `error_route` remain planned and unavailable. Source routing is bounded source-access discovery, not general web search or a research agent.

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

The server exposes `/`, `/healthz`, `/readyz`, `/catalog.json`, `/openapi.json`, `/llms.txt`, `/llms-full.txt`, `/.well-known/x402.json`, `/.well-known/mcp/server-card.json`, and `/mcp`. HTTP execution is active for `source_route`; the MCP route remains an inactive placeholder. Payment is not active.

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

The service is designed for x402 pay-per-call access without accounts or API keys. No wallet key is stored here. The scaffold does not accept payment until a supported network, receiving address, and verified payment middleware are configured.

## Example

```json
{
  "goal": "Download the latest population dataset",
  "domain": "statistics.example",
  "preferred_formats": ["csv", "json"]
}
```

Call `POST /v1/tools/source_route` with that body. The result is limited to the checked scope; a missing result does not mean that no route exists. Direct site discovery runs without Brave credentials. If `BRAVE_SEARCH_API_KEY` is configured, v0.1 may make at most one paid Brave Search API request as a fallback.

See [PRODUCT](docs/PRODUCT.md), [ARCHITECTURE](docs/ARCHITECTURE.md), [TOOL_ADMISSION](docs/TOOL_ADMISSION.md), [DISTRIBUTION](docs/DISTRIBUTION.md), and [RELEASE](docs/RELEASE.md).
