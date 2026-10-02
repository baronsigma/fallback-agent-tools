export const productIdentity = {
  productId: 'fallback',
  productName: 'Fallback',
  shortDescription: 'Small pay-per-call recovery utilities for autonomous agents.',
  tagline: "Don't spend a dollar of reasoning on a cent-sized problem.",
  publicBaseUrl: 'https://fallback.factrail.online',
  repositoryUrl: 'https://github.com/baronsigma/fallback-agent-tools',
  paymentNetworks: {
    test: { network: 'eip155:84532', label: 'Base Sepolia testnet, testnet USDC; mainnet is not enabled' },
    production: { network: 'eip155:8453', label: 'Base mainnet, USDC' },
  },
  agentGuidance: [
    'Use source_route when you know what information you need but not where to retrieve it in machine-readable form; do not use it for general research or fact verification.',
    'Use error_route after an API, HTTP, MCP, or tool request fails when the safe next action is unclear; do not use it when recovery is obvious or requires deeper domain reasoning.',
    'Read error_route evidence and limitations. It classifies supplied information only; it does not execute requests or claim undocumented fixes.',
  ],
  related: [
    { name: 'FACTRAIL MCP', url: 'https://factrail.online/llms.txt', summary: 'Separate service for source-backed facts with support levels, unresolved fields, and receipts.' },
  ],
} as const;

export function productIdentityFor(publicBaseUrl: string = productIdentity.publicBaseUrl) {
  return { ...productIdentity, publicBaseUrl };
}

export const productMetadata = {
  ...productIdentity,
  fullDescription: `${productIdentity.shortDescription} ${productIdentity.tagline}`,
  version: '0.1.0-beta.1',
  license: 'MIT',
  endpoints: {
    mcp: '/mcp',
    catalog: '/catalog.json',
    openapi: '/openapi.json',
    serverCard: '/.well-known/mcp/server-card.json',
    x402: '/.well-known/x402.json',
    skill: '/skill.md',
  },
  transports: { httpEnabled: true, mcpEnabled: true },
  x402: { version: 2, bazaarExtension: 'bazaar' },
} as const;
