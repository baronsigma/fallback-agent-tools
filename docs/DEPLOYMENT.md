# Linux service deployment and payment setup

This describes a service deployment only. It does not publish a marketplace listing or create a GitHub release.

## Build and run

Use Node.js 22 or newer and a locked install. Set the final public origin before generating artifacts:

```sh
npm ci
PUBLIC_BASE_URL=https://your-real-service-host.example npm run generate:production
npm run build
NODE_ENV=production npm start
```

Replace the example host with the actual HTTPS origin before running the production generator. Production configuration rejects reserved example/test hosts, IP addresses, HTTP URLs, paths, credentials, and missing `PUBLIC_BASE_URL`.

Keep runtime configuration in an environment file outside the checkout, readable only by the service user. For example, `/etc/fallback/fallback.env` should be owned by root/service group and mode `0640`. Do not put secrets in shell history, unit files, logs, generated metadata, or Git.

Example systemd unit (`/etc/systemd/system/fallback.service`):

```ini
[Unit]
Description=Fallback agent tools
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=fallback
Group=fallback
WorkingDirectory=/opt/fallback
EnvironmentFile=/etc/fallback/fallback.env
ExecStart=/usr/bin/node --env-file-if-exists=.env dist/src/index.js
Restart=on-failure
RestartSec=2
KillSignal=SIGTERM
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

The service binds to `127.0.0.1` so it is reachable only through a local proxy or tunnel connector. The service writes concise startup/shutdown messages to stdout. It does not log tool request bodies, payment signatures, wallet keys, Tavily keys, or facilitator credentials. systemd/journald can collect process output. `SIGTERM` stops accepting new connections and closes MCP resources after in-flight HTTP work drains.

## Health and readiness

- `GET /healthz` checks that the process responds.
- `GET /readyz` reports the active search provider, available-tool count, MCP status, payment mode, network, whether payment configuration is active, and whether payer-fingerprint telemetry is configured. It never returns the receiving address, facilitator URL, authorization header, HMAC key, or provider keys.
- Paid-mode startup initializes and checks the configured facilitator before opening the listener. If the facilitator cannot initialize, startup fails closed.

The request limiter is in-memory, per process, and keyed by the direct socket address by default. It allows 30 tool/MCP requests per client in a 60-second window. Set `RATE_LIMIT_MAX_REQUESTS` and `RATE_LIMIT_WINDOW_MS` to adjust within validated bounds. For multiple instances, enforce an equivalent aggregate limit at the edge.

If a trusted reverse proxy terminates TLS, set `TRUST_PROXY_HOPS` only when the service port is firewall-restricted so clients can reach it only through that exact proxy chain. The default is `0`; untrusted `X-Forwarded-For` values are ignored. Configure the count to the actual fixed proxy-hop count, not a wildcard.

## Environment variables

```env
NODE_ENV=production
PUBLIC_BASE_URL=https://your-real-service-host.example
PORT=3000
SEARCH_PROVIDER=none
PAYMENT_MODE=test
X402_PAY_TO=0x0000000000000000000000000000000000000000
X402_NETWORK=eip155:84532
X402_FACILITATOR_URL=https://your-facilitator.example
X402_FACILITATOR_AUTHORIZATION=
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=30
TRUST_PROXY_HOPS=0
```

The address above is a placeholder only. Set an operator-controlled receiving address. The server does not need a private key to receive x402 payments. If a facilitator requires credentials, put its authorization value in `X402_FACILITATOR_AUTHORIZATION`; it is sent only to the configured facilitator and is omitted from readiness and discovery output.

Optional `TELEMETRY_PAYER_HMAC_KEY` (at least 32 bytes) enables stable, keyed payer fingerprints for unique/repeat payer metrics. It is independent of wallet and facilitator keys. With no key, calls and settlement outcomes are still counted, but unique payer metrics are incomplete. Tool telemetry emits a small JSON event to stdout/journald; it omits prompts, request/response bodies, credentials, raw wallet addresses, raw user-agent strings, IPs, and transaction hashes. Use `journalctl -u fallback.service --since "30 days ago" -o cat | npm run telemetry:report` for aggregate-only metrics; see [metric definitions and retention](TELEMETRY_AND_30_DAY_METRICS.md).

Payment modes:

| Mode | Network | Required configuration | Behavior |
| --- | --- | --- | --- |
| `disabled` | none | no x402 settings | Local execution; no payment challenge |
| `test` | Base Sepolia `eip155:84532` | pay-to, network, HTTPS facilitator URL | Requires a valid x402 V2 test payment |
| `production` | Base `eip155:8453` | pay-to, network, HTTPS facilitator URL, `NODE_ENV=production` | Requires a valid x402 V2 production payment |

Paid modes fail startup if any required setting is absent or invalid. Do not use `disabled` for a public paid service. Production uses an explicitly configured facilitator; the public x402.org facilitator is not assumed to be a mainnet production service.

Prices are sourced from `src/core/registry.ts`: `source_route` `$0.02`, `error_route` `$0.002`, `request_repair` `$0.005`, `stop_search` `$0.003`. HTTP payment middleware is installed before JSON parsing/schema validation and before the runtime handler, so an unpaid request cannot cause handler execution. MCP uses the x402 MCP V2 tool exchange and wraps only callable registry tools.

## Test payment flow

First run a service with `PAYMENT_MODE=test`, Base Sepolia settings, and a facilitator that supports x402 V2 EVM exact payments on Base Sepolia. Fund a separate test wallet with the compatible test asset. Do not use a production wallet.

Then configure only on the operator's workstation or a protected CI secret store:

Provide `X402_E2E_BASE_URL`, `X402_E2E_NETWORK=eip155:84532`, and `X402_E2E_PRIVATE_KEY` from a protected secret manager or local secret environment, then run:

```sh
npm run test:x402:e2e
```

The script first observes an unpaid 402 challenge, signs one test payment with the explicitly supplied test wallet, retries the same source_route call, verifies the normal response and settlement metadata, and prints the request/transaction identifiers. It never prints the key. This command is excluded from normal CI and may use one configured external search request during the paid call.

Do not switch to `PAYMENT_MODE=production` until the deployed test payment succeeds and the production facilitator is confirmed live for x402 V2 exact on `eip155:8453`. The first mainnet smoke payment must use `error_route` for `$0.002`, followed by independent on-chain verification. Follow [the Base mainnet launch checklist](PRODUCTION_LAUNCH_CHECKLIST.md); it is a procedure only and does not enable mainnet.
