# request_repair

`request_repair` is a deterministic-first, evidence-bound request transformer. `error_route` diagnoses a failure and recommends an action; `request_repair` applies only the smallest change justified by the supplied schema or error evidence. It never sends a request, searches the web, or uses an LLM.

## Contract

HTTP: `POST /v1/tools/request_repair`
MCP: `request_repair`
Version: `0.1.0-beta.1`
Price: `$0.005` per call, sourced from the canonical registry.

Inputs may include a goal, request (method, URL, headers, query and JSON-compatible body), response status/headers/body, an optional `error_route` classification, an optional JSON Schema/OpenAPI request schema, and method/URL change constraints. Individual text values and JSON structures are bounded by the input contract.

Output status is `repair_available` or `insufficient_evidence`. A repair includes the redacted original request, proposed request, at most three field-level changes, evidence signals, confidence, retry safety and limits. An abstention explains what evidence is missing without echoing raw response text.

## Evidence order

1. Caller-supplied request schema, including OpenAPI-derived parameter and body schemas.
2. Machine-readable server validation errors.
3. Standard HTTP semantics and explicit response headers.
4. Tightly constrained textual error patterns.

Conflicting schema evidence causes abstention. Lower-ranked text does not override a schema. Instructions present in response bodies are treated as untrusted data, never as directives.

## Supported changes

- Remove an explicitly rejected field.
- Rename a field only when the replacement name is explicit and schema-compatible when a schema is supplied.
- Change content type only when a 415 response explicitly lists a supported type.
- Change method only when a 405 `Allow` header identifies one method and the caller permits method changes.
- Normalize a scalar only when the schema proves the expected type.
- Move a parameter between query and body only when the supplied schema identifies its location.
- Add a missing required field only when the value already exists in caller input.
- Respect `Retry-After` as retry timing guidance without changing the request payload.

No credentials, identifiers, enum values, URLs, endpoints or other business values are invented. More than three semantic changes produces an abstention/manual-review outcome.

## Abstention cases

Authentication or authorization failures, DNS/TLS failures, payment failures, CAPTCHA/challenges, unknown endpoints, generic 5xx responses, ambiguous errors, unknown required values, enum mismatches without an explicit allowed value, and conflicting schemas do not produce a repaired request. The result identifies the kind of evidence needed where practical.

## Privacy

Credential-bearing headers and secret-like fields are redacted before output. Raw response bodies are not copied into evidence or limits. The handler is local and deterministic; it performs no network access and records no request payload.

## Evaluation

`npm run benchmark:request-repair` runs a deterministic labeled corpus and reports repair correctness, false repairs, unsupported changes, abstention accuracy, intent preservation, excessive changes, secret leakage and latency. Availability is gated on the documented acceptance thresholds.
