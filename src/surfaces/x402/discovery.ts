import { toolRegistry } from '../../core/registry.js';
import { productMetadata } from '../../core/product.js';
import type { AppConfig } from '../../core/config.js';
import type { ToolRecord } from '../../core/registry.js';

// x402 Bazaar discovery is an extension in payable 402 declarations; it is not an independent catalog standard.
// This document communicates readiness and canonical declarations without fabricating payment requirements.
export function makeX402Discovery(baseUrl: string, config: Pick<AppConfig, 'paymentMode' | 'paymentConfigured'> = { paymentMode: 'disabled', paymentConfigured: false }, registry: readonly ToolRecord[] = toolRegistry): Record<string, unknown> {
  return {
    documentType: 'fallback-owned-readiness-metadata',
    protocolStandard: false,
    note: 'x402 payment requirements and Bazaar discovery extensions are returned by payable resource responses. This document is not a protocol-standard well-known endpoint.',
    x402Version: productMetadata.x402.version,
    service: { name: productMetadata.name, description: productMetadata.description, resource: baseUrl },
    paymentMode: config.paymentMode,
    bazaar: { extension: productMetadata.x402.bazaarExtension, active: config.paymentConfigured },
    resources: registry.filter((tool) => tool.availability === 'available').map((tool) => ({
      id: tool.id,
      resource: `${baseUrl}${tool.httpRoute}`,
      type: tool.x402.resourceType,
      toolName: tool.mcpName,
      description: tool.description,
      inputSchema: tool.inputSchema.toJSONSchema({ io: 'input' }),
      priceUsd: tool.priceUsd,
      availability: tool.availability,
      enabled: tool.x402.enabled,
      active: config.paymentConfigured && tool.x402.enabled,
    })),
  };
}
