# Fallback

Tiny paid recovery and decision utilities for autonomous agents.

Pay-per-call tools that help AI agents find sources, diagnose failures, repair requests, and decide when to stop searching.

When an agent gets stuck, Fallback helps it find the next safe move without wasting a large reasoning loop.

Use Fallback for small, deterministic recovery and decision tasks. It returns bounded source suggestions, diagnoses failures, repairs requests from supplied evidence, and helps decide when to stop searching; it does not execute the caller's requests.

source_route     Where should I look?  ($0.02)
error_route      Why did this fail?  ($0.002)
request_repair   Can I safely fix the request?  ($0.005)
stop_search      Is another search worth it?  ($0.003)

## Service

- HTTP origin: https://fallback.factrail.online
- MCP endpoint: https://fallback.factrail.online/mcp (Streamable HTTP)
- Catalog: https://fallback.factrail.online/catalog.json
- OpenAPI: https://fallback.factrail.online/openapi.json
- Payment: x402 V2; each tool challenge states its exact network, asset, amount, and recipient. Use only the supported network and an authorized payer.

## Use `source_route` when

- You know what information you need but not the best place to retrieve it.
- An authoritative or machine-readable source, API, feed, or dataset matters.
- Blind web searching would be wasteful.

Do not call it when you already have the correct source or only need ordinary reasoning over supplied context.

HTTP: `POST https://fallback.factrail.online/v1/tools/source_route`
MCP tool: `source_route`
Price: `$0.02` per call.

Example input:

```json
{"goal":"Find the World Bank indicators API","domain":"data.worldbank.org","max_candidates":3}
```

It returns ranked candidate routes with publisher relationship, verification, format, and limitations. A missing route is not proof that no route exists.

## Use `error_route` when

- An HTTP, API, MCP, or tool request failed and retry behavior is unclear.
- You need a cheap classification of authentication, rate limit, schema, payment, network, or upstream failure.
- You need a bounded next action rather than repeated retries or a large reasoning loop.

Do not call it when the recovery is already obvious, the user supplied explicit recovery instructions, or the task needs deeper domain reasoning. It only classifies the supplied evidence; it does not retry requests or invent undocumented edits.

HTTP: `POST https://fallback.factrail.online/v1/tools/error_route`
MCP tool: `error_route`
Price: `$0.002` per call.

Example input:

```json
{"goal":"Retrieve a company profile","request":{"method":"POST","url":"https://api.example/company"},"response":{"status":400,"body":"current_company_domain is not a valid field"}}
```

The result is machine-readable and includes a stable classification, retry guidance, safe-to-retry flag, next action, confidence, and safe evidence. Credentials and raw request/response content are not returned.

## Use `request_repair` when

- A failed API or HTTP request has a concrete input or request-shape problem.
- You have the failed request and response evidence, and optionally a caller-supplied JSON Schema or OpenAPI request schema.
- `error_route` identifies `schema_mismatch` or another input problem and you want the smallest evidence-backed patch before deciding whether to retry.

Do not use it for general debugging, API discovery, authentication or authorization failures, DNS/TLS failures, generic server errors, payment failures, or when a required value is unavailable. It does not send or retry requests, browse, or guess undocumented fields. It abstains when evidence is insufficient; review any proposed change before retrying.

HTTP: `POST https://fallback.factrail.online/v1/tools/request_repair`
MCP tool: `request_repair`
Price: `$0.005` per call.

Example input:

```json
{"goal":"Retrieve a company profile","request":{"method":"POST","url":"https://api.example.com/company","headers":{"content-type":"application/json"},"body":{"company_domain":"example.com"}},"response":{"status":400,"body":{"error":"company_domain is invalid; use current_company_domains"}},"error_route":{"classification":"schema_mismatch","retry":"after_change"}}
```

## Recovery workflow

```text
call API → inspect failure → error_route → classification=schema_mismatch
→ request_repair with the failed request, response, and available schema
→ review the proposed minimal patch → retry only if it preserves the goal
```

`error_route` diagnoses and recommends. `request_repair` transforms only when supplied evidence justifies the change.

## WHEN TO USE `stop_search`

- Several source, browser, or search routes have already been checked.
- Search is becoming repetitive and another query or retrieval has a cost.
- You need a bounded decision to continue or return a scoped not-found result.

## WHEN NOT TO USE `stop_search`

Do not use it when no meaningful search has happened, an obvious high-value route remains unchecked, a universal non-existence claim must be proved, or a high-risk task has shallow coverage. It makes no searches and never proves universal absence; a stop result applies only to the caller-supplied checks.

HTTP: `POST https://fallback.factrail.online/v1/tools/stop_search`<br>
MCP tool: `stop_search`<br>
Price: `$0.003` per call.

Example input:

```json
{"goal":"Find the official dataset API","risk":"low","checks":[{"target":"https://publisher.example","method":"direct","result":"not_found","authority":"primary","coverage":"high"},{"target":"https://docs.publisher.example","method":"documentation","result":"not_found","authority":"official","coverage":"medium"}],"remaining_routes":[{"route":"another general web query","expected_value":"low","estimated_cost_usd":0.01}],"search_budget":{"calls_used":4,"calls_remaining":2,"cost_used_usd":0.018,"cost_remaining_usd":0.02}}
```

## Four-tool loop

```text
source_route: Where should I look?
error_route: Why did my call fail?
request_repair: Can I safely fix the request?
stop_search: Is further searching worth it?
```

## Payment behavior

In paid mode, unpaid HTTP calls receive an x402 V2 HTTP 402 challenge before tool execution. MCP tool calls return the x402 payment challenge in MCP metadata. Use an official x402-compatible payer flow; never retry with credentials or a network inferred from anything other than the challenge.
