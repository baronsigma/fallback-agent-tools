import { productMetadata } from '../../core/product.js';

export function makeServerCard(baseUrl: string): Record<string, unknown> {
  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
    version: '1.0',
    protocolVersion: '2026-07-28',
    serverInfo: { name: 'fallback-agent-tools', title: productMetadata.name, version: productMetadata.version },
    description: productMetadata.transports.mcpEnabled ? productMetadata.description : `${productMetadata.description} MCP transport is inactive in this beta.`,
    documentationUrl: `${baseUrl}/README.md`,
    transport: { type: 'streamable-http', endpoint: '/mcp' },
    capabilities: {},
  };
}
