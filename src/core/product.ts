export const productIdentity = {
  productId: 'fallback',
  productName: 'Fallback',
  shortDescription: 'Small pay-per-call recovery utilities for autonomous agents.',
  tagline: "Don't spend a dollar of reasoning on a cent-sized problem.",
  publicBaseUrl: 'https://fallback.factrail.online',
  repositoryUrl: 'https://github.com/baronsigma/fallback-agent-tools',
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
