import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/core/config.js';
import { createHttpApp } from '../../src/surfaces/http/app.js';

describe('anonymous request limits', () => {
  it('limits tool requests by the direct client unless a proxy hop count is explicitly configured', async () => {
    const config = loadConfig({ NODE_ENV: 'test', RATE_LIMIT_MAX_REQUESTS: '1', RATE_LIMIT_WINDOW_MS: '60000' });
    const server = createHttpApp(config).listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server.');
      const endpoint = `http://127.0.0.1:${address.port}/v1/tools/source_route`;
      const first = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(first.status).toBe(400);
      const second = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.99' }, body: '{}' });
      expect(second.status).toBe(429);
      expect(second.headers.get('retry-after')).toBeTruthy();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
