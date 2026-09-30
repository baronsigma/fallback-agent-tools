import { toolRegistry } from '../../core/registry.js';
import { productMetadata } from '../../core/product.js';

export function makeServerCard(baseUrl: string): Record<string, unknown> {
  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
    version: '1.0',
    protocolVersion: '2025-11-25',
    serverInfo: { name: 'fallback-agent-tools', title: productMetadata.name, version: productMetadata.version },
    description: productMetadata.description,
    documentationUrl: `${baseUrl}/README.md`,
    transport: { type: 'streamable-http', endpoint: '/mcp' },
    capabilities: { tools: { listChanged: false } },
    tools: toolRegistry.filter((tool) => tool.availability === 'available').map((tool) => ({ name: tool.mcpName, description: tool.description, inputSchema: tool.inputSchema.toJSONSchema() })),
  };
}
