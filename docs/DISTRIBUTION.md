# Distribution

## Canonical release flow

1. GitHub release is canonical.
2. Generate and verify machine-readable discovery artifacts (`npm run generate`, `npm run verify:catalog`, and `npm run release:check`).
3. Publish/update x402 Bazaar discovery by adding the official Bazaar extension to enabled paid route declarations and verifying the facilitator's discovery response.
4. Publish/update the official MCP Registry using `distribution/mcp-registry/server.json` after schema validation and namespace authorization.
5. Publish/update the Apify Pay-Per-Event mirror when enabled.
6. Update secondary developer discovery listings such as Smithery and Glama.

Do not execute these external publication steps as part of ordinary code changes. Marketplace publication requires an explicit release action.

## Anti-drift manifest

`distribution/canonical.yaml` is generated from the one tool registry and product metadata. It captures product version/description, public endpoints, tool IDs, routes, prices, and marketplace identifiers. Files under `distribution/` are generated projections or templates, not independent sources of truth.

Marketplace descriptions and tool identifiers should be generated from the canonical data. Marketplace-specific billing and package fields may be added in projection code, but must not redefine tool contracts or prices.

## Platform notes

- x402 Bazaar discovery is sent through the x402 Bazaar extension on an enabled payable endpoint. This repository's local `/.well-known/x402.json` is a Fallback-owned readiness document, not an official x402 schema.
- MCP Registry `server.json` uses the GitHub owner namespace `io.github.baronsigma/fallback-agent-tools`; validate the current registry schema and publisher authorization before any publish.
- Apify Pay-Per-Event is a mirror, not the canonical implementation or source of price definitions.
- Smithery and Glama are secondary discovery listings. Their generated metadata references the canonical MCP server and tool IDs.
