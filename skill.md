# Fallback agent skill

Use Fallback as a small recovery and decision layer. It returns bounded source suggestions or diagnoses a failed request; it does not execute the caller's requests.

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

## Payment behavior

In paid mode, unpaid HTTP calls receive an x402 V2 HTTP 402 challenge before tool execution. MCP tool calls return the x402 payment challenge in MCP metadata. Use an official x402-compatible payer flow; never retry with credentials or a network inferred from anything other than the challenge.
