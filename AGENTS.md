# Fallback engineering rules

## Product scope
- Fallback is a collection of small, bounded, pay-per-call utilities that resolve external uncertainties blocking an agent's next action.
- Do not add dashboards, user accounts, subscriptions, or unrelated product scope to the MVP.
- A planned tool is unavailable until an explicit implementation is admitted and enabled. `source_route` is implemented; `stop_search` and `error_route` remain planned.

## Canonical metadata
- `src/core/registry.ts` is the only canonical tool registry. Tool identity, schemas, prices, status, routes, MCP names, examples, latency targets, x402 discovery metadata, and distribution IDs originate there.
- Public metadata, HTTP contracts, MCP declarations, OpenAPI/catalog/LLM artifacts, x402 metadata, and marketplace artifacts must be derived from the registry/product metadata. Never duplicate authoritative values by hand.
- `src/generated/**` and generated distribution artifacts must not be edited manually. Run the generator and commit its output.
- Every change must keep documentation and generated discovery artifacts synchronized.

## Tool modules and execution
- Each tool lives in its own `src/tools/<tool-id>/` directory and supplies contract, handler, tests, and fixtures where useful.
- HTTP and MCP must invoke the same handler exported by the tool module.
- Tool handlers contain business logic only. Transport, payment verification, pricing policy, and marketplace-specific behavior stay outside handlers.
- Availability is enforced at the shared execution boundary. A `planned` or `disabled` entry cannot execute.
- Do not claim `stop_search` or `error_route` are implemented until their behavior and contracts are complete.

## Contracts and safety
- Use strict TypeScript and explicit JSON Schema/Zod contracts. Keep the common response envelope compact and include request and execution metadata.
- Prices are sourced from the registry and validated as non-negative decimal USD strings with explicit precision policy.
- Never commit credentials, payment secrets, private keys, real wallet seeds, or sensitive logs. Examples use placeholders only.
- Intended production access is pay-per-call without API keys or accounts.

## Verification
- Tests are required for every public schema or registry change. Cover canonical identifier projections, generated artifact determinism, and unavailable-tool execution denial.
- Run tests, typecheck, lint, catalog verification, and release checks for changes that affect them; fix failures before committing.
- Distribution listings are projections of the manifest and canonical registry. GitHub release is canonical; follow `docs/DISTRIBUTION.md` for release order.
- Do not publish to any external marketplace during scaffold work unless explicitly asked.
