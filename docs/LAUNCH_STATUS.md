# Fallback launch status

Product: **Fallback**  
Product status: **PUBLICLY LAUNCHED**  
Distribution status: expanding / partially indexed  
Public origin: https://fallback.factrail.online  
MCP: https://fallback.factrail.online/mcp  
Release: [v0.1.0-beta.1](https://github.com/baronsigma/fallback-agent-tools/releases/tag/v0.1.0-beta.1)

## Product

Payment uses x402 V2 exact on Base mainnet (`eip155:8453`) with canonical USDC.

| Tool | Price |
|---|---:|
| `source_route` | $0.020 |
| `error_route` | $0.002 |
| `request_repair` | $0.005 |
| `stop_search` | $0.003 |

Validated: paid HTTP settlement, paid MCP settlement, independent on-chain transfer checks, MCP payment replay protection, privacy-safe telemetry, and all four OpenX402 Bazaar resource entries. Production endpoints and the four MCP tools are publicly available.

## Distribution

| Surface | Status | Evidence / remaining action |
|---|---|---|
| GitHub | LIVE | Public repository and `v0.1.0-beta.1` prerelease: https://github.com/baronsigma/fallback-agent-tools/releases/tag/v0.1.0-beta.1 |
| MCP Registry | LIVE | Active listing is searchable as `io.github.baronsigma/fallback-agent-tools`, version `0.1.0-beta.1`; remote: https://fallback.factrail.online/mcp. [Official Registry record](https://registry.modelcontextprotocol.io/v0/servers/io.github.baronsigma%2Ffallback-agent-tools/versions/0.1.0-beta.1). |
| OpenX402 | LIVE | Four HTTP resources indexed with correct price, network, USDC asset, and receiver. Discovery records currently expose empty `metadata` fields. |
| Smithery | MANUAL ACTION REQUIRED | No Smithery credentials/session are available here and no listing was found. Sign in at https://smithery.ai/new, publish the remote URL `https://fallback.factrail.online/mcp`, and use the submission copy below. |
| Glama | MANUAL ACTION REQUIRED | Root `glama.json` is valid, but no listing/authenticated submission is available here. Sign in to Glama, choose **Add Server**, and submit `https://github.com/baronsigma/fallback-agent-tools` with display name “Fallback” and the description below. |
| x402.new | PENDING | No match by hostname or service name. Its current listing page describes Bazaar-based indexing and automatic sync; no separate free listing form was found. Recheck after propagation. |
| Roundhouse | NOT INDEXED | Current searches by hostname, receiver, and exact resource URL return no entries. |
| Market402 | PENDING | Current public index remains timestamped `2026-10-06T03:11:54Z` and shows the earlier HTTP 404; it has not re-probed the later successful production settlement in its available published record. |
| x402-list | MANUAL ACTION REQUIRED | Submission is prepared with category **AI**. A submitter contact email is mandatory and remains the only blocker. |

### Secondary listing copy

**Smithery**

- Name: Fallback
- Description: Pay-per-call tools that help AI agents find sources, diagnose failures, repair requests, and decide when to stop searching.
- MCP: https://fallback.factrail.online/mcp
- Repository: https://github.com/baronsigma/fallback-agent-tools
- Homepage: https://fallback.factrail.online

**Glama**

- Repository: https://github.com/baronsigma/fallback-agent-tools
- Display name: Fallback
- Description: Pay-per-call tools that help AI agents find sources, diagnose failures, repair requests, and decide when to stop searching.
- Existing root metadata: `glama.json`. Public MCP: https://fallback.factrail.online/mcp

**x402-list**

- Name: Fallback
- Website: https://fallback.factrail.online
- MCP: https://fallback.factrail.online/mcp
- Repository: https://github.com/baronsigma/fallback-agent-tools
- Description: Pay-per-call recovery and decision utilities for autonomous agents.
- Category: AI
- Network/payment: Base mainnet; x402 V2 / USDC
- Tools: `source_route` $0.020; `error_route` $0.002; `request_repair` $0.005; `stop_search` $0.003.
- Blocker: required submitter contact email is not available here.

## Launch telemetry baseline

Baseline timestamp: **2026-10-06 18:37 UTC**, after the launch smoke checks and before treating later traffic as potential external usage. Internal/test activity through this baseline:

- Paid HTTP seeds: four total across four resources (the prior `error_route` milestone plus one paid call each to `source_route`, `request_repair`, and `stop_search`).
- Paid MCP smoke tests: one `error_route` call.
- Known paid internal calls: five total; four HTTP and one MCP. No duplicate paid resource seed was made.
- Payment challenges and the one replay attempt are test activity too; the rejected replay produced no second settlement or paid handler result.
- Existing telemetry uses a payer HMAC fingerprint. This note stores no raw payer identity and does not rewrite historical telemetry.

This is a known-activity baseline, not a claim that all observed calls came from one client or that future paid activity is necessarily external. Use aggregate telemetry and settlement reconciliation for subsequent reporting.

The operator command `npm run usage:report -- --since 24h` reuses the same validated telemetry event schema, excludes known internal launch payer fingerprints held in the ignored, permission-restricted `.local/internal-payer-fingerprints.txt`, and reports total activity alongside organic paid usage. It prints counts only, never the payer fingerprints or wallet addresses.
