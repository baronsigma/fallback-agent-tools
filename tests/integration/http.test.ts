import { describe, expect, it } from 'vitest';
import { createHttpApp } from '../../src/surfaces/http/app.js';
import { loadConfig } from '../../src/core/config.js';
import type { SafeFetcher } from '../../src/core/safe-fetch.js';
import { createSourceRouteHandler } from '../../src/tools/source-route/handler.js';
import { toolRegistry } from '../../src/core/registry.js';

async function parseMcpResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = body.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).at(-1);
    if (!data) throw new Error(`MCP response had no event data: ${body}`);
    return JSON.parse(data) as Record<string, unknown>;
  }
  return JSON.parse(body) as Record<string, unknown>;
}

describe('public HTTP scaffold', () => {
  it('provides health and discovery endpoints and denies planned execution', async () => {
    let publisherFetches = 0;
    const fetcher: SafeFetcher = {
      async fetch(url, onRequest) {
        publisherFetches += 1;
        onRequest(url);
        const spec = url.endsWith('/openapi.json');
        return { url, status: 200, headers: { 'content-type': spec ? 'application/json' : 'text/html' }, body: spec ? '{"openapi":"3.1.0","paths":{}}' : '<a href="/openapi.json">OpenAPI specification</a>' };
      },
    };
    const app = createHttpApp(loadConfig({ PUBLIC_BASE_URL: 'https://fallback.test', PORT: '3000', NODE_ENV: 'test' }), { sourceRouteHandler: createSourceRouteHandler({ fetcher, validateUrl: async (value) => new URL(value) }) });
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
      const beforeMcp = publisherFetches;
      const invalidInput = await fetch(`${base}/v1/tools/source_route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'Find records', domain: '127.0.0.1' }) });
      expect(invalidInput.status).toBe(400);
      const stopSearch = await fetch(`${base}/v1/tools/stop_search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(stopSearch.status).toBe(200);
      expect((await stopSearch.json()).result.decision).toBe('insufficient_evidence');
      const list = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
      expect(list.status).toBe(200);
      const toolsList = await parseMcpResponse(list) as unknown as { result: { tools: Array<{ name: string; title?: string; inputSchema: unknown; outputSchema?: unknown; annotations?: Record<string, unknown> }> } };
      expect(toolsList.result.tools.map((tool) => tool.name)).toEqual(['source_route', 'error_route', 'request_repair', 'stop_search']);
      for (const listed of toolsList.result.tools) {
        const tool = toolRegistry.find((entry) => entry.mcpName === listed.name);
        expect(tool, listed.name).toBeDefined();
        expect(listed.title).toBe(tool?.publicName);
        expect(listed.annotations).toEqual(tool?.mcpAnnotations);
      }
      expect(toolsList.result.tools[0]?.inputSchema).toMatchObject(toolRegistry[0]!.inputSchema.toJSONSchema({ io: 'input' }));
      expect(toolsList.result.tools[0]?.outputSchema).toMatchObject(toolRegistry[0]!.outputSchema.toJSONSchema());
      expect(toolsList.result.tools[1]?.inputSchema).toMatchObject(toolRegistry.find((tool) => tool.id === 'error_route')!.inputSchema.toJSONSchema({ io: 'input' }));
      expect(toolsList.result.tools[2]?.inputSchema).toMatchObject(toolRegistry.find((tool) => tool.id === 'request_repair')!.inputSchema.toJSONSchema({ io: 'input' }));
      expect(toolsList.result.tools[3]?.inputSchema).toMatchObject(toolRegistry.find((tool) => tool.id === 'stop_search')!.inputSchema.toJSONSchema({ io: 'input' }));
      expect(toolsList.result.tools[3]?.outputSchema).toMatchObject(toolRegistry.find((tool) => tool.id === 'stop_search')!.outputSchema.toJSONSchema());
      const mcpExecution = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'source_route', arguments: { goal: 'Find schema', domain: 'statistics.test' } } }) });
      expect(mcpExecution.status).toBe(200);
      const mcpResult = await parseMcpResponse(mcpExecution) as unknown as { result: { structuredContent: { status: string }; _meta: { fallback: { requestId: string; execution: unknown } } } };
      expect(mcpResult.result.structuredContent.status).toBe('routes_found');
      expect(mcpResult.result._meta.fallback.requestId).toBeTruthy();
      expect(mcpResult.result._meta.fallback.execution).toBeDefined();
      const errorRoute = await fetch(`${base}/v1/tools/error_route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'ECONNRESET' }) });
      expect(errorRoute.status).toBe(200);
      expect((await errorRoute.json()).result.classification).toBe('connection_failure');
      const skill = await fetch(`${base}/skill.md`);
      expect(skill.status).toBe(200);
      expect(skill.headers.get('content-type')).toContain('text/markdown');
      const skillText = await skill.text();
      expect(skillText).toContain('## Use `error_route` when');
      expect(skillText).toContain('## Use `request_repair` when');
      expect(skillText).toContain('## WHEN TO USE `stop_search`');
      expect(skillText).toContain('## WHEN NOT TO USE `stop_search`');
      expect(publisherFetches).toBeGreaterThan(beforeMcp);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
