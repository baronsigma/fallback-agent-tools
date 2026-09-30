import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getCatalog } from '../../src/surfaces/http/app.js';
import { makeOpenApi } from '../../src/surfaces/http/openapi.js';
import { toolRegistry } from '../../src/core/registry.js';

const baseUrl = 'https://fallback.example';

describe('generated projections', () => {
  it('keeps HTTP and MCP identifiers tied to the registry', () => {
    const spec = makeOpenApi(baseUrl) as { paths: Record<string, Record<string, { post: { operationId: string } }>> };
    for (const tool of toolRegistry) {
      expect(spec.paths[tool.httpRoute]?.post.operationId).toBe(tool.id);
      expect(tool.mcpName).toBe(tool.publicName);
    }
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
