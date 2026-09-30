import { toolRegistry } from '../../core/registry.js';
import { productMetadata } from '../../core/product.js';

// x402 Bazaar discovery is an extension in payable 402 declarations; it is not an independent catalog standard.
// This document communicates readiness and canonical declarations without fabricating payment requirements.
export function makeX402Discovery(baseUrl: string): Record<string, unknown> {
  return {
    x402Version: productMetadata.x402.version,
    service: { name: productMetadata.name, description: productMetadata.description, resource: baseUrl },
    bazaar: { extension: productMetadata.x402.bazaarExtension, configured: productMetadata.x402.configured },
    resources: toolRegistry.map((tool) => ({
      id: tool.id,
      resource: `${baseUrl}${tool.httpRoute}`,
      type: tool.x402.resourceType,
      toolName: tool.mcpName,
      description: tool.description,
      inputSchema: tool.inputSchema.toJSONSchema({ io: 'input' }),
      priceUsd: tool.priceUsd,
      availability: tool.availability,
      enabled: tool.x402.enabled,
    })),
  };
}
