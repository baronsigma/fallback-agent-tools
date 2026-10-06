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
| MCP Registry | MANUAL ACTION REQUIRED | Manifest validates. Existing publisher token is expired. Complete GitHub device authorization, then publish and verify `io.github.baronsigma/fallback-agent-tools` version `0.1.0-beta.1`. |
| OpenX402 | LIVE | Four HTTP resources indexed with correct price, network, USDC asset, and receiver. Discovery records currently expose empty `metadata` fields. |
| Smithery | MANUAL ACTION REQUIRED | No authenticated publisher credentials available. Publish the remote MCP URL with the copy in `distribution/smithery/metadata.json`. |
| Glama | MANUAL ACTION REQUIRED | Root `glama.json` is valid; submit the GitHub repository or remote MCP URL using Glama’s Add MCP Server flow. |
| x402.new | PENDING | No Fallback match found. OpenX402 resources are present; x402.new documents Bazaar-based automatic indexing. Recheck after catalog propagation. |
| Roundhouse | NOT INDEXED | Current searches by hostname, receiver, and exact resource URL return no entries. |
| Market402 | PENDING | Published index remains stale and shows an earlier HTTP 404; it predates the successful production settlement and live 402 checks. Recheck when the directory refreshes. |
| x402-list | MANUAL ACTION REQUIRED | Submission details are prepared; a submitter contact email is mandatory and not available here. Closest supported category: **Verification**. |

## Launch telemetry baseline

Baseline timestamp: **2026-10-06 18:37 UTC**, after the launch smoke checks and before treating later traffic as potential external usage. Internal/test activity through this baseline:

- Paid HTTP seeds: five total across four resources (the prior `error_route` milestone plus one paid call each to `source_route`, `request_repair`, and `stop_search`).
- Paid MCP smoke tests: one `error_route` call.
- Known paid internal calls: six total; five HTTP and one MCP. No duplicate paid resource seed was made.
- Payment challenges and the one replay attempt are test activity too; the rejected replay produced no second settlement or paid handler result.
- Existing telemetry uses a payer HMAC fingerprint. This note stores no raw payer identity and does not rewrite historical telemetry.

This is a known-activity baseline, not a claim that all observed calls came from one client or that future paid activity is necessarily external. Use aggregate telemetry and settlement reconciliation for subsequent reporting.
