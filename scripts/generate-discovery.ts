import { writeFile } from 'node:fs/promises';
import { toolRegistry, validateRegistry } from '../src/core/registry.js';
import { productMetadata } from '../src/core/product.js';
import { getCatalog, getLlmsText } from '../src/surfaces/http/app.js';
import { makeOpenApi } from '../src/surfaces/http/openapi.js';
import { makeServerCard } from '../src/surfaces/mcp/card.js';
import { makeX402Discovery } from '../src/surfaces/x402/discovery.js';
import { resolve } from 'node:path';

const baseUrl = process.env['PUBLIC_BASE_URL'] ?? productMetadata.websiteUrl;
validateRegistry();
const catalog = getCatalog(baseUrl);
const openapi = makeOpenApi(baseUrl);
const card = makeServerCard(baseUrl);
const x402 = makeX402Discovery(baseUrl);
const distribution = {
  product: productMetadata.name,
  version: productMetadata.version,
  description: productMetadata.description,
  endpoints: Object.fromEntries(Object.entries(productMetadata.endpoints).map(([key, path]) => [key, `${baseUrl}${path}`])),
  transports: productMetadata.transports,
  pricing: Object.fromEntries(toolRegistry.map((tool) => [tool.id, { amount: tool.priceUsd, currency: 'USD', model: 'pay-per-call' }])),
  tools: toolRegistry.map((tool) => ({ id: tool.id, name: tool.publicName, status: tool.availability, mcpName: tool.mcpName, httpRoute: tool.httpRoute, marketplaceIds: tool.distribution })),
};
const serverJson = {
  $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
  name: 'com.fallback.agent-tools',
  description: productMetadata.description,
  title: productMetadata.name,
  websiteUrl: productMetadata.websiteUrl,
  repository: { url: productMetadata.repositoryUrl, source: 'github' },
  version: productMetadata.version,
  ...(productMetadata.transports.mcpEnabled ? { remotes: [{ type: 'streamable-http', url: `${baseUrl}/mcp` }] } : {}),
  _meta: { 'io.modelcontextprotocol.registry/publisher-provided': { pricingModel: 'x402-pay-per-call', catalogUrl: `${baseUrl}/catalog.json` } },
};
const apify = { actorId: 'fallback/agent-tools', title: productMetadata.name, description: productMetadata.description, pricing: 'Pay per event; per-tool USD prices are in distribution/canonical.yaml.', tools: distribution.tools };
const listings = {
  smithery: { name: 'fallback-agent-tools', description: productMetadata.description, transportStatus: productMetadata.transports.mcpEnabled ? 'active' : 'inactive', ...(productMetadata.transports.mcpEnabled ? { mcpUrl: `${baseUrl}/mcp` } : {}), tools: distribution.tools },
  glama: { name: 'Fallback', description: productMetadata.description, transportStatus: productMetadata.transports.mcpEnabled ? 'active' : 'inactive', ...(productMetadata.transports.mcpEnabled ? { mcpUrl: `${baseUrl}/mcp` } : {}), tools: distribution.tools },
};
const yaml = [
  `product: ${JSON.stringify(distribution.product)}`,
  `version: ${distribution.version}`,
  `description: ${JSON.stringify(distribution.description)}`,
  'transports:',
  `  http: ${productMetadata.transports.httpEnabled ? 'active' : 'inactive'}`,
  `  mcp: ${productMetadata.transports.mcpEnabled ? 'active' : 'inactive'}`,
  'endpoints:',
  ...Object.entries(distribution.endpoints).map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`),
  'tools:',
  ...toolRegistry.flatMap((tool) => [
    `  - id: ${tool.id}`,
    `    version: ${tool.version}`,
    `    name: ${tool.publicName}`,
    `    status: ${tool.availability}`,
    `    httpRoute: ${tool.httpRoute}`,
    `    mcpName: ${tool.mcpName}`,
    `    priceUsd: "${tool.priceUsd}"`,
    `    apifyActorId: ${tool.distribution.apifyActorId}`,
    `    smitheryServerId: ${tool.distribution.smitheryServerId}`,
    `    glamaServerId: ${tool.distribution.glamaServerId}`,
  ]),
].join('\n') + '\n';
const outputs: Record<string, unknown> = {
  'src/generated/catalog.json': catalog,
  'src/generated/openapi.json': openapi,
  'src/generated/server-card.json': card,
  'src/generated/x402.json': x402,
  'distribution/canonical.yaml': yaml,
  'distribution/mcp-registry/server.json': serverJson,
  'distribution/apify/metadata.json': apify,
  'distribution/smithery/metadata.json': listings.smithery,
  'distribution/glama/metadata.json': listings.glama,
};
for (const [path, data] of Object.entries(outputs)) {
  const content = typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(resolve(path), content, 'utf8');
}
await writeFile(resolve('src/generated/llms.txt'), getLlmsText(baseUrl), 'utf8');
await writeFile(resolve('src/generated/llms-full.txt'), getLlmsText(baseUrl, true), 'utf8');
