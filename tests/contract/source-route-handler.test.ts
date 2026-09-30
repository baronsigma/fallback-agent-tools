import { describe, expect, it } from 'vitest';
import { createSourceRouteHandler } from '../../src/tools/source-route/handler.js';
import type { SafeFetcher } from '../../src/core/safe-fetch.js';

describe('source_route shared handler', () => {
  it('returns the common envelope and internal execution measurements', async () => {
    const fetcher: SafeFetcher = {
      async fetch(url, onRequest) {
        onRequest(url);
        const spec = url.endsWith('/openapi.json');
        const body = spec ? '{"openapi":"3.1.0","paths":{}}' : '<html><a href="/openapi.json">OpenAPI specification</a></html>';
        return { url, status: 200, headers: { 'content-type': spec ? 'application/json' : 'text/html' }, body };
      },
    };
    const handler = createSourceRouteHandler({ fetcher, validateUrl: async (value) => new URL(value) });
    const response = await handler({ goal: 'Find an API specification', domain: 'statistics.test' }, { requestId: 'request-fixture-1' });
    expect(response).toMatchObject({ success: true, toolId: 'source_route', toolVersion: '0.1.0', requestId: 'request-fixture-1' });
    if (!response.success) throw new Error('Expected successful tool response.');
    expect(response.result.routes[0]?.route_type).toBe('openapi');
    expect(response.execution.metrics).toEqual({ outboundHttpRequests: 2, paidSearchCalls: 0, discoverySource: 'direct' });
  });
});
