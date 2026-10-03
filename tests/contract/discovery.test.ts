import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { getCatalog } from '../../src/surfaces/http/app.js';
import { makeOpenApi } from '../../src/surfaces/http/openapi.js';
import { toolRegistry } from '../../src/core/registry.js';

const baseUrl = 'https://fallback.test';
const generatedFiles = ['src/generated/catalog.json', 'src/generated/openapi.json', 'src/generated/llms.txt', 'llms.txt', 'src/generated/llms-full.txt', 'src/generated/skill.md', 'src/generated/x402.json', 'src/generated/server-card.json', 'distribution/canonical.yaml', 'distribution/mcp-registry/server.json', 'distribution/apify/metadata.json', 'distribution/smithery/metadata.json', 'distribution/glama/metadata.json'];

async function generateFixture(outputDir: string): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  execFileSync('npm', ['run', 'generate'], { stdio: 'ignore', env: { ...process.env, NODE_ENV: 'test', PUBLIC_BASE_URL: baseUrl, DISCOVERY_OUTPUT_DIR: outputDir } });
}

describe('generated projections', () => {
  it('keeps HTTP and MCP identifiers tied to the registry', () => {
    const spec = makeOpenApi(baseUrl) as { paths: Record<string, { post: { operationId: string; responses: Record<string, unknown>; 'x-fallback-x402-active': boolean; 'x-fallback-price-usd': string } }> };
    for (const tool of toolRegistry.filter((entry) => entry.availability === 'available')) {
      expect(spec.paths[tool.httpRoute]?.['post']?.operationId).toBe(tool.id);
      expect(tool.mcpName).toBe(tool.publicName);
    }
    expect(spec.paths['/v1/tools/stop_search']?.post.operationId).toBe('stop_search');
    expect(spec.paths['/v1/tools/stop_search']?.post['x-fallback-price-usd']).toBe('0.003');
    expect(spec.paths['/v1/tools/error_route']?.post.operationId).toBe('error_route');
    expect(spec.paths['/v1/tools/error_route']?.post['x-fallback-x402-active']).toBe(false);
    expect(spec.paths['/v1/tools/source_route']?.post['x-fallback-x402-active']).toBe(false);
    expect(spec.paths['/v1/tools/source_route']?.post.responses['402']).toBeUndefined();
    const paidSpec = makeOpenApi(baseUrl, true) as typeof spec;
    expect(paidSpec.paths['/v1/tools/source_route']?.post['x-fallback-x402-active']).toBe(true);
    expect(paidSpec.paths['/v1/tools/source_route']?.post.responses['402']).toBeDefined();
    expect(paidSpec.paths['/v1/tools/error_route']?.post['x-fallback-x402-active']).toBe(true);
    expect(paidSpec.paths['/v1/tools/error_route']?.post.responses['402']).toBeDefined();
    expect(paidSpec.paths['/v1/tools/stop_search']?.post['x-fallback-x402-active']).toBe(true);
    expect(paidSpec.paths['/v1/tools/stop_search']?.post.responses['402']).toBeDefined();
  });

  it('matches generated catalog', async () => {
    const fixtureDir = await mkdtemp(resolve(tmpdir(), 'fallback-discovery-'));
    try {
      await generateFixture(fixtureDir);
      const generated = JSON.parse(await readFile(resolve(fixtureDir, 'src/generated/catalog.json'), 'utf8')) as unknown;
      expect(generated).toEqual(getCatalog(baseUrl));
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it('keeps the generated MCP Registry server description within its published limit', async () => {
    const fixtureDir = await mkdtemp(resolve(tmpdir(), 'fallback-mcp-registry-'));
    try {
      await generateFixture(fixtureDir);
      const manifest = JSON.parse(await readFile(resolve(fixtureDir, 'distribution/mcp-registry/server.json'), 'utf8')) as { description: string; name: string; remotes: Array<{ url: string }> };
      expect(manifest.description.length).toBeLessThanOrEqual(100);
      expect(manifest.name).toBe('io.github.baronsigma/fallback-agent-tools');
      expect(manifest.remotes[0]?.url).toBe(`${baseUrl}/mcp`);
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it('is deterministic across generator runs', async () => {
    const firstDir = await mkdtemp(resolve(tmpdir(), 'fallback-discovery-a-'));
    const secondDir = await mkdtemp(resolve(tmpdir(), 'fallback-discovery-b-'));
    try {
      await generateFixture(firstDir);
      await generateFixture(secondDir);
      const [first, second] = await Promise.all([firstDir, secondDir].map((dir) => Promise.all(generatedFiles.map((file) => readFile(resolve(dir, file), 'utf8')))));
      expect(second).toEqual(first);
    } finally {
      await Promise.all([rm(firstDir, { recursive: true, force: true }), rm(secondDir, { recursive: true, force: true })]);
    }
  });
});
