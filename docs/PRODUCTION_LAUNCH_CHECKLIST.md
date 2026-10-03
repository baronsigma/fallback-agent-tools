# Base mainnet launch checklist

Status: **not authorized/activated**. The live service remains in test mode on Base Sepolia. Do not paste production secrets into this repository or this document.

## Required production settings

Production startup currently requires the following values in the protected runtime environment:

```env
NODE_ENV=production
PUBLIC_BASE_URL=https://<approved-public-origin>
PAYMENT_MODE=production
X402_NETWORK=eip155:8453
X402_PAY_TO=<validated operator-controlled EVM receiver>
X402_FACILITATOR_URL=https://<facilitator supporting x402 V2 exact on eip155:8453>
X402_FACILITATOR_AUTHORIZATION=<only if that facilitator requires it>
TELEMETRY_PAYER_HMAC_KEY=<random secret, at least 32 bytes>
```

Keep the existing search-provider settings and rate-limit/proxy settings as separately reviewed. `X402_ASSET` is not currently an application setting: the installed `@x402/evm` 2.28 dependency selects Base mainnet native USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals) for `eip155:8453`. Confirm the actual public 402 challenge carries that address and the receiving address before accepting any payment. The server itself needs no receiver private key.

## Go/no-go sequence

- [ ] Validate the receiving address through a second operator-controlled channel; confirm it is controlled by the intended business/operator, nonzero, checksummed/verified, and not the payer/test wallet. Independently compare the 402 `payTo` byte-for-byte with the approved address.
- [ ] Select a production facilitator and query its live `/supported` response. Require `x402Version: 2`, `scheme: exact`, `network: eip155:8453`; then verify documented settlement/finality, supported Base native USDC, fee payer/gas sponsorship, limits, uptime, auth, and incident/support policy. Do not infer mainnet support from Sepolia.
- [x] Live candidate check on 2026-10-03: OpenX402 `GET https://facilitator.openx402.ai/supported` returned V2 `exact`, `eip155:8453`, asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, and `assetTransferMethod: eip3009`. Its response did not include decimals, so Base mainnet RPC `eth_chainId` returned `8453` and the token `decimals()` call returned `6`. This satisfies the advertised network/asset/method gate; settlement still requires the live smoke test below.
- [ ] Keep the current `https://x402.org` facilitator blocked for mainnet promotion unless a later live `/facilitator/supported` response adds Base mainnet. The configured SDK-style endpoint returned HTTP 200 on 2026-10-03 and advertised x402 V2 exact on `eip155:84532`, but no `eip155:8453` kind; testnet support does not establish mainnet support.
- [ ] Back up the current `/etc/fallback/fallback.env` securely, verify owner/mode, and prepare a separate production config offline. Do not edit the live mode/network as part of preparation.
- [ ] Deploy the reviewed build/config during a controlled window. Check `GET /healthz` and `GET /readyz`; require `status=ready`, `payment.mode=production`, `payment.network=eip155:8453`, four available tools, and payer telemetry configured. The endpoint must not disclose addresses, facilitator URL/auth, API keys, or HMAC key.
- [ ] Before any mainnet spend, make an unpaid `error_route` request. Require HTTP 402 and inspect x402 V2, exact, Base mainnet, native USDC address above, amount `2000` (6 decimals = `$0.002`), and approved `payTo`.
- [ ] Use one explicitly authorized payer for the first live paid call: `error_route` with a deterministic `429` + `Retry-After: 60` example. Let the official x402 client sign and retry once. Cap the test at `$0.002`; require the expected result, successful settlement and a transaction hash.
- [ ] Independently query Base mainnet chain ID 8453, transaction and receipt. Require successful receipt, USDC `Transfer` or relevant authorization-settlement event, payer, approved payee and exactly `2,000` raw units; record block number and explorer/RPC evidence. Reconcile sender token balance.
- [ ] Only after HTTP verification, perform one paid MCP `error_route` smoke call at `$0.002` with the official x402 MCP client. Confirm challenge, paid retry, result, settlement receipt and independent chain verification. This is a second `$0.002` spend; do not bundle it into the first test without explicit spend authorization.
- [ ] Test an identical accepted authorization replay once against the read-only `error_route`. Require replay rejection/idempotent settlement from protocol/facilitator evidence and no second transfer. Confirm any handler-call evidence is one execution for the successful original call; distinguish payment replay protection from application-level idempotency.
- [ ] Confirm public MCP `tools/list` contains exactly `source_route`, `error_route`, `request_repair`, `stop_search`; verify OpenAPI, catalog, skill, `llms.txt`, server card and x402 challenge report the production host and stable prices.
- [ ] Review telemetry event samples for aggregate completeness and absence of body, prompt, credential, raw payer address, signature, IP, or raw user-agent values. Confirm journald retention/access and a dashboard/query consumer for the event schema before relying on the 30-day KPIs.
- [ ] Record the release artifact/hash, config version, operator, time, first transaction hash, receipt block, balance reconciliation and rollback owner in the launch record.

## Rollback

If the facilitator, settlement, result delivery, or readiness check fails, stop paid traffic at the existing edge/operator control, restore the saved known-good test environment, and restart with `PAYMENT_MODE=test` plus `X402_NETWORK=eip155:84532`. Confirm `/readyz` reports test mode and Base Sepolia, and confirm an unpaid challenge advertises only Sepolia USDC. Never roll back by setting `PAYMENT_MODE=disabled` on the public paid service. Preserve sanitized incident/transaction evidence and rotate credentials if exposure is suspected; do not copy secrets into tickets or Git.

## Secret handling

- Store facilitator authorization and `TELEMETRY_PAYER_HMAC_KEY` only in the protected runtime secret store/environment file with least privilege.
- Do not commit payer keys, seed phrases, facilitator tokens, production transaction signing keys, or real authorization payloads.
- The service requires no payer key and no receiving-wallet private key.
- The telemetry key is distinct from facilitator credentials and wallet keys. Rotate it only with a documented analytics continuity decision because payer pseudonyms change across rotation.
- Redact environment, HTTP headers, payment signatures, payer addresses, and request/response bodies from logs and support captures.
