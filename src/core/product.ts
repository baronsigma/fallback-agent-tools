export const productMetadata = {
  name: 'Fallback',
  description: "Small pay-per-call utilities that resolve uncertainty for autonomous agents. Don't spend a dollar of reasoning on a cent-sized problem.",
  version: '0.1.0',
  license: 'MIT',
  repositoryUrl: 'https://github.com/baronsigma/fallback-agent-tools',
  websiteUrl: 'https://fallback.example',
  endpoints: {
    mcp: '/mcp',
    catalog: '/catalog.json',
    openapi: '/openapi.json',
    llms: '/llms.txt',
    llmsFull: '/llms-full.txt',
    serverCard: '/.well-known/mcp/server-card.json',
    x402: '/.well-known/x402.json',
  },
  x402: { version: 2, bazaarExtension: 'bazaar', configured: false },
} as const;
