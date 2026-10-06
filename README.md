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

# Fallback

Tiny paid recovery and decision utilities for autonomous agents.

When an agent gets stuck, Fallback helps it find the next safe move without wasting a large reasoning loop.

source_route     Where should I look? ($0.02)\
error_route      Why did this fail? ($0.002)\
request_repair   Can I safely fix the request? ($0.005)\
stop_search      Is another search worth it? ($0.003)

## Use Fallback

Pay-per-call tools that help AI agents find sources, diagnose failures, repair requests, and decide when to stop searching. Fallback gives autonomous agents small, deterministic utilities for the moments where automation gets stuck: finding the right source, diagnosing a failed request, repairing a request from available evidence, and deciding whether another search or paid retrieval is worth the cost.

## Hosted service

MCP endpoint: https://fallback.factrail.online/mcp\
HTTP API base: https://fallback.factrail.online\
Payment: x402 V2 pay-per-call. Check each live challenge for network, asset, amount, and recipient.\
Agent skill: [skill.md](https://fallback.factrail.online/skill.md)\
OpenAPI: [openapi.json](https://fallback.factrail.online/openapi.json)\
Network: Base mainnet, canonical USDC\
Release: [v0.1.0-beta.1](https://github.com/baronsigma/fallback-agent-tools/releases/tag/v0.1.0-beta.1)

## Tools

- `source_route` ($0.02): **Where should I look?** Find likely authoritative or machine-readable sources.
- `error_route` ($0.002): **Why did my call fail?** Classify a failed request and recommend a bounded next action.
- `request_repair` ($0.005): **Can I safely fix the request?** Propose the smallest change supported by caller-supplied evidence.
- `stop_search` ($0.003): **Is further searching worth it?** Decide whether more bounded search effort is justified by the evidence and remaining cost.

These tools do not replace agent reasoning, and `stop_search` never proves universal absence.

## When an agent should use this

Use `source_route` when an agent knows **what** it needs and **which publisher** (a domain or start URL), but not **how** to get it in machine-readable form: an API, OpenAPI spec, bulk download, dataset or feed.

- Good fit: "Get the latest population dataset from Eurostat", "Find a JSON/CSV route for this agency's statistics", before the agent starts browsing page by page.
- Not a fit: general web research, answering a factual question, or verifying a fact (for source-backed facts, see [FACTRAIL MCP](https://github.com/baronsigma/factrail)).

How to read the result:
- `status: routes_found`: try routes in order. `score` is a deterministic ranking, **not** a probability or confidence.
- `status: no_suitable_route_found`: nothing suitable **within the checked scope** (see `checked.direct_probes`). This is **not** evidence that no route exists. The agent should look elsewhere (another host, the publisher's open-data portal), not conclude "there is no API".
- Always read `limitations`. It says, for example, whether external search was unavailable or candidate inspection was capped.

Limits per call: at most 8 direct HTTP requests, 12 s total, 1 MiB per response, and at most 1 external search request. No LLM inference. The hosted beta currently runs deterministic discovery only (no search provider configured).

Access: hosted MCP `https://fallback.factrail.online/mcp` (Streamable HTTP) or the HTTP tool routes, x402 pay-per-call (each challenge declares its payment network and amount; no account or API key). To try it without payment, self-host with `PAYMENT_MODE=disabled` (see Local development). Machine-readable summary: [`llms.txt`](llms.txt). More detail: [Using Fallback with agents](docs/USING_WITH_AGENTS.md).

Fallback is publicly launched. See the [current launch and distribution status](docs/LAUNCH_STATUS.md), [product rename impact audit](docs/RENAME_IMPACT_AUDIT.md), [discovery/distribution readiness audit](docs/LAUNCH_DISTRIBUTION_AUDIT.md), and [telemetry and 30-day KPI definitions](docs/TELEMETRY_AND_30_DAY_METRICS.md).

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

## 30-second start

Connect an x402-compatible agent to `https://fallback.factrail.online/mcp`, call the matching tool after a concrete failure or search decision, and approve only the network, token, recipient, and amount shown by its payment challenge. HTTP clients can use `POST /v1/tools/{tool_id}` on the hosted origin. See [skill.md](skill.md) for examples and schemas.

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
