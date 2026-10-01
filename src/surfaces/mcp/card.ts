import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server';
import { productMetadata } from '../../core/product.js';

export function makeServerCard(baseUrl: string): Record<string, unknown> {
  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
    version: '1.0',
    protocolVersion: LATEST_PROTOCOL_VERSION,
    serverInfo: { name: 'fallback-agent-tools', title: productMetadata.name, version: productMetadata.version },
    description: productMetadata.description,
    documentationUrl: `${productMetadata.repositoryUrl}#readme`,
    transport: { type: 'streamable-http', endpoint: `${baseUrl}/mcp` },
    capabilities: { tools: { listChanged: false } },
  };
}
