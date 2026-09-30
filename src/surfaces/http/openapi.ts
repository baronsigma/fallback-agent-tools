import { toolRegistry } from '../../core/registry.js';
import { productMetadata } from '../../core/product.js';

export function makeOpenApi(baseUrl: string): Record<string, unknown> {
  const paths = Object.fromEntries(toolRegistry.map((tool) => [tool.httpRoute, {
    post: {
      operationId: tool.id,
      summary: tool.publicName,
      description: tool.description,
      tags: [tool.category],
      'x-fallback-tool-id': tool.id,
      'x-fallback-status': tool.availability,
      'x-fallback-price-usd': tool.priceUsd,
      requestBody: { required: true, content: { 'application/json': { schema: tool.inputSchema.toJSONSchema({ io: 'input' }) } } },
      responses: {
        '200': { description: 'Tool response envelope', content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolResponse' } } } },
        '402': { description: 'Payment required for an available paid tool.' },
        '404': { description: 'Tool is unknown or unavailable.' },
      },
    },
  }]));
  return {
    openapi: '3.1.1',
    info: { title: productMetadata.name, version: productMetadata.version, description: productMetadata.description, license: { name: productMetadata.license } },
    servers: [{ url: baseUrl }],
    paths,
    components: { schemas: { ToolResponse: { type: 'object', required: ['success', 'toolId', 'toolVersion', 'requestId', 'execution'], properties: { success: { type: 'boolean' }, toolId: { type: 'string' }, toolVersion: { type: 'string' }, requestId: { type: 'string' }, result: {}, error: { type: 'object' }, execution: { type: 'object' } } } } },
  };
}
