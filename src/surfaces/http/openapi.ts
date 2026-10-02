import { toolRegistry } from '../../core/registry.js';
import { productMetadata } from '../../core/product.js';

export function makeOpenApi(baseUrl: string, paymentConfigured = false): Record<string, unknown> {
  const paths = Object.fromEntries(toolRegistry.filter((tool) => tool.availability === 'available').map((tool) => [tool.httpRoute, {
    post: {
      operationId: tool.id,
      summary: tool.publicName,
      description: tool.description,
      tags: [tool.category],
      'x-fallback-tool-id': tool.id,
      'x-fallback-status': tool.availability,
      'x-fallback-price-usd': tool.priceUsd,
      'x-fallback-x402-active': paymentConfigured && tool.x402.enabled && tool.availability === 'available',
      requestBody: { required: true, content: { 'application/json': { schema: tool.inputSchema.toJSONSchema({ io: 'input' }) } } },
      responses: {
        '200': { description: 'Tool response envelope', content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolResponse' } } } },
        ...(paymentConfigured && tool.x402.enabled ? { '402': { description: 'Payment required for this available paid tool.' } } : {}),
        '404': { description: 'Tool is unknown or unavailable.' },
      },
    },
  }]));
  return {
    openapi: '3.1.1',
    info: { title: productMetadata.productName, version: productMetadata.version, description: productMetadata.fullDescription, license: { name: productMetadata.license } },
    servers: [{ url: baseUrl }],
    paths,
    components: { schemas: { ToolResponse: { type: 'object', required: ['success', 'toolId', 'toolVersion', 'requestId', 'execution'], properties: { success: { type: 'boolean' }, toolId: { type: 'string' }, toolVersion: { type: 'string' }, requestId: { type: 'string' }, result: {}, error: { type: 'object' }, execution: { type: 'object' } } } } },
  };
}
