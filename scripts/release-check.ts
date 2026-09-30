import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateRegistry, toolRegistry } from '../src/core/registry.js';
import { productMetadata } from '../src/core/product.js';

validateRegistry();
if (productMetadata.repositoryUrl.includes('REPLACE_WITH')) throw new Error('Set the canonical GitHub repository URL before release.');
const serverJson = JSON.parse(await readFile(resolve('distribution/mcp-registry/server.json'), 'utf8')) as { version?: string; description?: string };
if (serverJson.version !== productMetadata.version || serverJson.description !== productMetadata.description) throw new Error('Generated server.json metadata is stale.');
const catalog = JSON.parse(await readFile(resolve('src/generated/catalog.json'), 'utf8')) as { tools?: unknown[] };
if (catalog.tools?.length !== toolRegistry.length) throw new Error('Generated catalog is stale.');
process.stdout.write('Release metadata checks passed.\n');
