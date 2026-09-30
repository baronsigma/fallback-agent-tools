# Architecture

## Source of truth

`src/core/registry.ts` owns every public tool identifier, description, schema, price, status, route, MCP name, example, latency target, x402 discovery setting, and marketplace identifier. Product-wide text and endpoint paths live in `src/core/product.ts`. The generator projects these sources into HTTP catalog/OpenAPI, LLM discovery text, server-card metadata, x402 readiness data, MCP Registry `server.json`, and marketplace mirror files.

Generated outputs are committed for review and deployment. Never edit them manually.

## Execution path

HTTP or MCP transport -> transport/payment adapter -> shared availability gate -> tool handler -> common response envelope. Transport and payment verification are middleware concerns; pricing lookup is registry-owned. Marketplace logic is an offline publisher concern. Tool handlers implement only domain behavior.

An unavailable tool is denied before its handler can run. An available paid tool will be exposed only after its payment configuration is verified. HTTP and MCP must call the same handler implementation.

## Response envelope

Success and failure responses share `success`, `toolId`, `toolVersion`, `requestId`, and `execution`. Success carries `result`; failure carries a structured error with code, message, retryability, and optional details. Confidence or evidence fields belong only to tools whose semantics require them.

## Discovery and standards

- `/catalog.json`, `/openapi.json`, `/llms.txt`, and `/llms-full.txt` are Fallback projections.
- MCP Registry `server.json` uses the official registry server schema version dated 2025-12-11.
- The MCP Server Card follows the published MCP Server Card v1 schema and well-known URI. This surface is supplemental discovery metadata; server-card work is tracked separately from the MCP core tools protocol.
- x402 Bazaar discovery uses the official `bazaar` extension on payable route declarations. It is not a standalone catalog file format. `/.well-known/x402.json` is Fallback's own readiness and canonical metadata projection, not a claimed x402-standard endpoint.
- Planned tools are omitted from the MCP card's callable tool list and are not advertised as payable Bazaar resources.

## Dependencies

The implementation uses TypeScript, Zod, Express, the official MCP TypeScript server package, and official x402 SDK packages. Payment dependencies are isolated behind `src/surfaces/x402/` so payment-specific APIs do not leak into domain handlers.
