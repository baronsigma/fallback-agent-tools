# Release checklist

1. Confirm all tool contracts and implementation status in `src/core/registry.ts`.
2. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run verify:catalog`, and `npm run release:check`.
3. Run `npm run generate`, inspect the diff, then rerun checks.
4. Verify the MCP Registry server JSON against the current official schema and validate any Server Card against the published schema.
5. For available paid tools, verify payment terms using the official x402 SDK and a supported facilitator/network. Keep receiving credentials outside source control.
6. Review `distribution/canonical.yaml` against the generated listings.
7. Create a GitHub release and tag; GitHub is canonical.
8. Execute the distribution sequence in `docs/DISTRIBUTION.md` and record resulting listing versions/URLs.

Do not list planned or disabled tools as callable or payable.
