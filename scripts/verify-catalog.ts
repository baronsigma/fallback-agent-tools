import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getCatalog } from '../src/surfaces/http/app.js';
import { productMetadata } from '../src/core/product.js';
import { toolRegistry, validateRegistry } from '../src/core/registry.js';

validateRegistry();
const generated = JSON.parse(await readFile(resolve('src/generated/catalog.json'), 'utf8')) as unknown;
const expected = getCatalog(process.env['PUBLIC_BASE_URL'] ?? productMetadata.websiteUrl);
if (JSON.stringify(generated) !== JSON.stringify(expected)) throw new Error('Generated catalog does not match canonical registry. Run npm run generate.');
if (toolRegistry.some((tool) => tool.x402.enabled && tool.availability !== 'available')) throw new Error('An unavailable tool cannot be enabled for x402 discovery.');
process.stdout.write('Catalog matches canonical registry.\n');
