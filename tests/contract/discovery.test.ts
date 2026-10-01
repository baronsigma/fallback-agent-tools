import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getCatalog } from '../../src/surfaces/http/app.js';
import { makeOpenApi } from '../../src/surfaces/http/openapi.js';
import { toolRegistry } from '../../src/core/registry.js';

const baseUrl = 'https://fallback.test';

describe('generated projections', () => {
  it('keeps HTTP and MCP identifiers tied to the registry', () => {
    const spec = makeOpenApi(baseUrl) as { paths: Record<string, { post: { operationId: string; responses: Record<string, unknown>; 'x-fallback-x402-active': boolean } }> };
    for (const tool of toolRegistry.filter((entry) => entry.availability === 'available')) {
      expect(spec.paths[tool.httpRoute]?.['post']?.operationId).toBe(tool.id);
      expect(tool.mcpName).toBe(tool.publicName);
    }
    expect(spec.paths['/v1/tools/stop_search']).toBeUndefined();
    expect(spec.paths['/v1/tools/error_route']).toBeUndefined();
    expect(spec.paths['/v1/tools/source_route']?.post['x-fallback-x402-active']).toBe(false);
    expect(spec.paths['/v1/tools/source_route']?.post.responses['402']).toBeUndefined();
    const paidSpec = makeOpenApi(baseUrl, true) as typeof spec;
    expect(paidSpec.paths['/v1/tools/source_route']?.post['x-fallback-x402-active']).toBe(true);
    expect(paidSpec.paths['/v1/tools/source_route']?.post.responses['402']).toBeDefined();
  });

  it('matches generated catalog', async () => {
    const generated = JSON.parse(await readFile(resolve('src/generated/catalog.json'), 'utf8')) as unknown;
    expect(generated).toEqual(getCatalog(baseUrl));
  });

  it('is deterministic across generator runs', async () => {
    const before = await Promise.all(['src/generated/catalog.json', 'src/generated/openapi.json', 'src/generated/llms.txt', 'src/generated/llms-full.txt', 'src/generated/x402.json', 'src/generated/server-card.json', 'distribution/canonical.yaml', 'distribution/mcp-registry/server.json', 'distribution/apify/metadata.json', 'distribution/smithery/metadata.json', 'distribution/glama/metadata.json'].map((file) => readFile(resolve(file), 'utf8')));
    const { execFileSync } = await import('node:child_process');
    execFileSync('npm', ['run', 'generate'], { stdio: 'ignore' });
    const after = await Promise.all(['src/generated/catalog.json', 'src/generated/openapi.json', 'src/generated/llms.txt', 'src/generated/llms-full.txt', 'src/generated/x402.json', 'src/generated/server-card.json', 'distribution/canonical.yaml', 'distribution/mcp-registry/server.json', 'distribution/apify/metadata.json', 'distribution/smithery/metadata.json', 'distribution/glama/metadata.json'].map((file) => readFile(resolve(file), 'utf8')));
    expect(after).toEqual(before);
  });
});
