import { describe, expect, it } from 'vitest';
import { createHttpApp } from '../../src/surfaces/http/app.js';
import { loadConfig } from '../../src/core/config.js';
import type { SafeFetcher } from '../../src/core/safe-fetch.js';

describe('public HTTP scaffold', () => {
  it('provides health and discovery endpoints and denies planned execution', async () => {
    const fetcher: SafeFetcher = {
      async fetch(url, onRequest) {
        onRequest(url);
        const spec = url.endsWith('/openapi.json');
        return { url, status: 200, headers: { 'content-type': spec ? 'application/json' : 'text/html' }, body: spec ? '{"openapi":"3.1.0","paths":{}}' : '<a href="/openapi.json">OpenAPI specification</a>' };
      },
    };
    const app = createHttpApp(loadConfig({ PUBLIC_BASE_URL: 'https://fallback.example', PORT: '3000', NODE_ENV: 'test' }), { fetcher, validateUrl: async (value) => new URL(value) });
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
      const direct = await fetch(`${base}/v1/tools/source_route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'Find schema', domain: 'statistics.test' }) });
      expect(direct.status).toBe(200);
      expect((await direct.json()).result.routes[0].route_type).toBe('openapi');
      const invalidInput = await fetch(`${base}/v1/tools/source_route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'Find records', domain: '127.0.0.1' }) });
      expect(invalidInput.status).toBe(400);
      const unavailable = await fetch(`${base}/v1/tools/stop_search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(unavailable.status).toBe(404);
      expect((await fetch(`${base}/mcp`)).status).toBe(501);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
