# Product telemetry and first 30-day metrics

## Event coverage

The service emits one `fallback.tool_call` JSON event per accepted HTTP tool route and each MCP tool callback. Events are sent to stdout for systemd/journald collection. Fields are schema-versioned and include tool ID, channel, canonical registry price, response latency, payment state (`free`, `challenged`, `settled`, `settlement_failed`, or `settlement_unconfirmed`), result category, mapped error code, abstention flag, and normalized client family. HTTP families are allowlisted (`browser`, `curl`, `node`, `python`, `mcp`, `other`); MCP is currently labeled `mcp`.

Events never contain raw prompts, input/output bodies, credentials, authorization headers, payment signatures, transaction hashes, IP addresses, raw user-agent strings, or raw wallet addresses. If `TELEMETRY_PAYER_HMAC_KEY` is configured, a payer address reported in a successful x402 settlement response is transformed in memory into a keyed HMAC-SHA256 fingerprint. Without the key, settlement and call counts remain available but unique/repeat-payer metrics do not. Events include `payment_mode` so test and production usage can be separated.

The repository includes a small aggregate-only JSONL report command. Use journald’s `-o cat` mode so telemetry event messages remain one JSON object per line:

```sh
journalctl -u fallback.service --since "30 days ago" -o cat | npm run telemetry:report
```

Or pass an already-exported JSONL file with `npm run telemetry:report -- /secure/path/events.jsonl`. The report prints only counts, aggregate categories, latency percentiles, estimated revenue and payer fingerprint counts; it never prints the fingerprints themselves. Revenue uses each event’s registry-derived per-call price and should be reconciled against settlement records. The challenged-to-settled ratio is an aggregate proxy, not request-level attribution.

On the current host, journald is persistent with a 35-day maximum retention override and the existing `SystemMaxUse=1G` cap. The 2026-10-04 check reported 161.4 MB used, so this is the selected sink; rerun `systemd-analyze cat-config systemd/journald.conf` and `journalctl --disk-usage` before each 30-day report. If the disk cap evicts older records earlier, label the report incomplete; do not increase the cap without checking disk capacity.

`latency_ms` is end-to-end server callback latency for MCP, and the HTTP request duration through response finish for HTTP; keep these channel definitions separate in percentile charts. Client family is a coarse hint, not an authenticated identity. Calls rejected before the registered handler (for example malformed JSON or MCP schema validation) may not produce a tool-result event and should be monitored through separate aggregate process/edge error counters without capturing bodies.

## First 30-day KPI definitions

Use UTC calendar days and a rolling day-1-to-day-30 cohort. Filter to available tool IDs and count a payment only when `payment_state=settled`. Test-mode activity must be labeled separately and excluded from production revenue/adoption.

| Metric | Definition |
|---|---|
| Unique paying wallets | Distinct nonempty HMAC payer fingerprints among successful settlement events. Report unavailable/incomplete if the HMAC key was not configured for any period. This is a pseudonymous wallet count, not a person count. |
| Paid calls per tool | Count settled events grouped by `tool_id`; report HTTP and MCP separately and total together. |
| Repeat payer rate | Distinct payer fingerprints with at least two settled calls divided by distinct paying fingerprints during the same cohort. |
| Revenue per tool | Sum canonical `price_usd` for settled events per tool, cross-checked against verified facilitator/on-chain settlement totals. Use settled records, never challenge counts. |
| Payment conversion after 402 | Aggregate paid settled calls divided by 402 challenges, grouped by tool, channel and UTC day. Because challenge and retry are separate stateless requests and no caller/request join key is stored, this is a cohort-level proxy, not exact per-challenge attribution; disclose ratios above 100% or changing denominators. |
| `error_route` unknown rate | Settled or free `error_route` calls whose result category is `unknown`, divided by completed `error_route` result events. Also publish all result categories. |
| `request_repair` repair vs abstain | Counts/rates of `repair_available` versus `insufficient_evidence` among completed results. Treat schema/validation errors separately. |
| `stop_search` stop/continue/abstain | Counts/rates by decision result category (`stop`, `continue`, `insufficient_evidence`). |
| `source_route` routes-found rate | `routes_found` results divided by completed `source_route` result events; also report `no_suitable_route_found` and `insufficient_input` separately. |
| Latency | p50/p95 end-to-end HTTP/MCP latency by tool and channel; do not merge channels. |
| Error rate/category | Mapped execution `error_category` counts divided by accepted tool calls, by tool/channel; keep result classifications (such as `schema_mismatch`) separate from transport failures. |
| Client family | Call and paid-settlement distribution by normalized client family. Never infer individual users from this field. |

The payment conversion proxy intentionally avoids storing a request body, payment authorization, IP, or persistent per-request tracking token. If exact funnel attribution becomes important, review it as a separate privacy and architecture decision.
