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
} as const;
