# Tool admission

Every proposal must pass all of these checks before it becomes available:

- Solves a recurring agent problem.
- Is atomic and independently useful.
- Has bounded execution, inputs, and resource use.
- Returns structured, machine-readable output.
- Gives an agent a clear reason to buy a result instead of reasoning through the task itself.
- Has understandable pay-per-call economics, including external data or compute costs.
- Fits Fallback's uncertainty and unblocking story.

Admission also requires a versioned input/output contract, examples, failure behavior, latency target, price rationale, fixtures, unit/contract tests, and documentation. The handler must contain only business logic and must be shared by HTTP and MCP. Payment and marketplace code belong in their respective surfaces. A tool may be marked available for beta execution while x402 remains disabled; enabling payment is a separate deployment/release decision.

An entry marked `planned` or `disabled` cannot execute. Changing availability to `available` requires a reviewed implementation, full public schema tests, shared-handler transport wiring or an explicit inactive transport disclosure, and generated artifact updates. Payment configuration is required before charging for calls, not before beta functionality can be evaluated.
