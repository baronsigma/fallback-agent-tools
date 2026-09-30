import { describe, expect, it } from 'vitest';
import { createHttpApp } from '../../src/surfaces/http/app.js';
import { loadConfig } from '../../src/core/config.js';

describe('public HTTP scaffold', () => {
  it('provides health and discovery endpoints and denies planned execution', async () => {
    const app = createHttpApp(loadConfig({ PUBLIC_BASE_URL: 'https://fallback.example', PORT: '3000', NODE_ENV: 'test' }));
    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server.');
      const base = `http://127.0.0.1:${address.port}`;
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
      expect((await fetch(`${base}/catalog.json`)).status).toBe(200);
      const execution = await fetch(`${base}/v1/tools/source_route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(execution.status).toBe(404);
      expect((await execution.json()).error.code).toBe('TOOL_UNAVAILABLE');
      expect((await fetch(`${base}/mcp`)).status).toBe(501);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
