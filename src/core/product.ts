export const productMetadata = {
  name: 'Fallback',
  description: "Small pay-per-call utilities that resolve uncertainty for autonomous agents. source_route returns ranked candidate access routes, preferably authoritative and machine-readable where possible, within a bounded checked scope. Absence is not proof of nonexistence.",
  version: '0.1.0-beta.1',
  license: 'MIT',
  repositoryUrl: 'https://github.com/baronsigma/fallback-agent-tools',
  endpoints: {
    mcp: '/mcp',
    catalog: '/catalog.json',
    openapi: '/openapi.json',
    serverCard: '/.well-known/mcp/server-card.json',
    x402: '/.well-known/x402.json',
  },
  transports: { httpEnabled: true, mcpEnabled: true },
  x402: { version: 2, bazaarExtension: 'bazaar' },
  paymentNetworks: {
    test: { network: 'eip155:84532', label: 'Base Sepolia testnet, testnet USDC; mainnet is not enabled' },
    production: { network: 'eip155:8453', label: 'Base mainnet, USDC' },
  },
  agentGuidance: [
    'Use source_route when you know what data you need and which publisher (domain or start_url), but not the machine-readable way to get it (API, OpenAPI, bulk download, dataset, feed).',
    'Do not use it for general web research, answering factual questions, or fact verification.',
    'score is a deterministic ranking, not a probability. no_suitable_route_found means "nothing suitable within the checked scope", not "no route exists". Always read limitations.',
  ],
  related: [
    { name: 'FACTRAIL MCP', url: 'https://factrail.online/llms.txt', summary: 'Separate service, same design rule (report what was checked): source-backed facts with support levels, unresolved fields and receipts.' },
  ],
} as const;
