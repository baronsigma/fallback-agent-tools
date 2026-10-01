import { describe, expect, it } from 'vitest';
import { createHttpApp } from '../../src/surfaces/http/app.js';
import { loadConfig } from '../../src/core/config.js';
import type { SafeFetcher } from '../../src/core/safe-fetch.js';
import { createSourceRouteHandler } from '../../src/tools/source-route/handler.js';
import { toolRegistry } from '../../src/core/registry.js';

describe('public HTTP scaffold', () => {
  it('provides health and discovery endpoints and denies planned execution', async () => {
    const fetcher: SafeFetcher = {
      async fetch(url, onRequest) {
        onRequest(url);
        const spec = url.endsWith('/openapi.json');
        return { url, status: 200, headers: { 'content-type': spec ? 'application/json' : 'text/html' }, body: spec ? '{"openapi":"3.1.0","paths":{}}' : '<a href="/openapi.json">OpenAPI specification</a>' };
      },
    };
    const app = createHttpApp(loadConfig({ PUBLIC_BASE_URL: 'https://fallback.example', PORT: '3000', NODE_ENV: 'test' }), { sourceRouteHandler: createSourceRouteHandler({ fetcher, validateUrl: async (value) => new URL(value) }) });
    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server.');
      const base = `http://127.0.0.1:${address.port}`;
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
      expect((await fetch(`${base}/catalog.json`)).status).toBe(200);
      const execution = await fetch(`${base}/v1/tools/source_route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'Find the public dataset' }) });
      expect(execution.status).toBe(200);
      expect((await execution.json()).result.status).toBe('insufficient_input');
      let fakeCalls = 0;
      const fakeTool = { ...toolRegistry[0]!, id: 'fake_available', publicName: 'fake_available', httpRoute: '/v1/tools/fake_available', mcpName: 'fake_available' };
      const isolated = createHttpApp(loadConfig({ NODE_ENV: 'test' }), {
        registry: [...toolRegistry, fakeTool],
        handlers: [
          { id: 'source_route', handler: async (input, context) => createSourceRouteHandler({ fetcher, validateUrl: async (value) => new URL(value) })(input as { goal: string }, context) as Promise<import('../../src/core/response.js').ToolResponse<unknown>> },
          { id: 'fake_available', handler: async (_input, context) => { fakeCalls += 1; return { success: true, toolId: 'fake_available', toolVersion: '1', requestId: context.requestId, result: { marker: 'fake' }, execution: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 0 } }; } },
        ],
      });
      const isolatedServer = isolated.listen(0);
      try {
        const isolatedAddress = isolatedServer.address();
        if (!isolatedAddress || typeof isolatedAddress === 'string') throw new Error('Expected TCP server.');
        const fake = await fetch(`http://127.0.0.1:${isolatedAddress.port}/v1/tools/fake_available`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"goal":"fake call"}' });
        expect(fake.status).toBe(200);
        expect((await fake.json()).result.marker).toBe('fake');
        expect(fakeCalls).toBe(1);
      } finally {
        await new Promise<void>((resolve, reject) => isolatedServer.close((error) => error ? reject(error) : resolve()));
      }
      const direct = await fetch(`${base}/v1/tools/source_route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'Find schema', domain: 'statistics.test' }) });
      expect(direct.status).toBe(200);
      expect((await direct.json()).result.routes[0].route_type).toBe('openapi');
      const invalidInput = await fetch(`${base}/v1/tools/source_route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'Find records', domain: '127.0.0.1' }) });
      expect(invalidInput.status).toBe(400);
      const unavailable = await fetch(`${base}/v1/tools/stop_search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(unavailable.status).toBe(404);
      const mcp = await fetch(`${base}/mcp`);
      expect(mcp.status).toBe(501);
      expect((await mcp.json()).error).toBe('The MCP transport is not yet enabled.');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
