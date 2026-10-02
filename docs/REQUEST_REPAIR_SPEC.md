# request_repair design

`request_repair` is a future transformation tool, distinct from `error_route`:

- `error_route` diagnoses a failure and recommends a bounded next action.
- `request_repair` proposes a minimally changed request using evidence supplied with the failure.

It is not implemented, registered as callable, or priced yet. It must not retry or send the request itself.

## Evidence order

1. Caller-supplied request schema or exact validation contract.
2. OpenAPI or another machine-readable schema for the same endpoint and version.
3. Structured error fields that identify a specific invalid field or constraint.
4. Endpoint documentation explicitly tied to that endpoint and version.
5. Inference only when the correction is uniquely constrained; otherwise return `insufficient_evidence`.

The output should contain a patch/diff, evidence references, confidence, and unresolved assumptions. It must preserve unrelated fields and redact credentials in both input and output. Never invent field names, enum values, authentication, or endpoint paths. Require caller review before a changed request is sent.

Reuse `error_route` classifications to reject inapplicable repairs: authentication and payment failures need authorized credentials/payment, network and TLS failures are not request-body repairs, and unknown failures should not produce speculative edits.
