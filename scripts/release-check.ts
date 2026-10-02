import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateRegistry, toolRegistry } from '../src/core/registry.js';
import { productMetadata } from '../src/core/product.js';

validateRegistry();
if (productMetadata.repositoryUrl.includes('REPLACE_WITH')) throw new Error('Set the canonical GitHub repository URL before release.');
const serverJson = JSON.parse(await readFile(resolve('distribution/mcp-registry/server.json'), 'utf8')) as { version?: string; description?: string };
if (serverJson.version !== productMetadata.version || serverJson.description !== productMetadata.fullDescription) throw new Error('Generated server.json metadata is stale.');
const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as { version?: string };
if (packageJson.version !== productMetadata.version || toolRegistry.some((tool) => tool.version !== productMetadata.version)) throw new Error('Package/product/tool versions must agree for a coordinated release.');
const catalog = JSON.parse(await readFile(resolve('src/generated/catalog.json'), 'utf8')) as { tools?: unknown[] };
if (catalog.tools?.length !== toolRegistry.length) throw new Error('Generated catalog is stale.');
const openapi = JSON.parse(await readFile(resolve('src/generated/openapi.json'), 'utf8')) as { paths?: Record<string, unknown> };
for (const tool of toolRegistry) if (tool.availability !== 'available' && openapi.paths?.[tool.httpRoute]) throw new Error(`Unavailable tool '${tool.id}' must not appear as a callable OpenAPI operation.`);
process.stdout.write('Release metadata checks passed.\n');
