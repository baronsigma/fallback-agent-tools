# Release checklist

1. Confirm all tool contracts and implementation status in `src/core/registry.ts`.
2. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run generate`, `npm run verify:catalog`, `npm run release:check`, and `npm run benchmark:source-route`.
3. Run `npm run generate`, inspect the diff, then rerun checks.
4. Verify the MCP Registry server JSON against the current official schema and validate any Server Card against the published schema.
5. For available paid tools, verify the x402 V2 payment challenge and test-network settlement using the official SDK and configured facilitator. Keep receiving credentials outside source control.
6. Review `distribution/canonical.yaml` against the generated listings.
7. Do not create a public release until the deployed Base Sepolia HTTP and MCP payment flows are validated, settlement is independently checked, and production promotion blockers in `PRODUCTION_LAUNCH_CHECKLIST.md` are cleared.
8. After explicit release approval and all external requirements are met, create the GitHub release/tag and follow `docs/DISTRIBUTION.md`.

Do not list planned or disabled tools as callable or payable.
