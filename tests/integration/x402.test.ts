import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { x402Client } from '@x402/core/client';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { attachPaymentToMeta } from '@x402/mcp';
import { wrapFetchWithPayment } from '@x402/fetch';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { loadConfig } from '../../src/core/config.js';
import { createHttpApp } from '../../src/surfaces/http/app.js';
import { createX402PaymentIntegration } from '../../src/surfaces/x402/payment.js';
import { parseSourceRouteInput, sourceRouteInputSchema, sourceRouteOutputSchema } from '../../src/tools/source-route/contract.js';
import { successResponse } from '../../src/core/response.js';
import type { ToolHandler } from '../../src/core/tool.js';
import type { SourceRouteOutput } from '../../src/tools/source-route/contract.js';
import type { AppConfig } from '../../src/core/config.js';
import { toolRegistry } from '../../src/core/registry.js';

const runningServers: Server[] = [];
afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a local TCP server.');
  runningServers.push(server);
  return address.port;
}

async function parseMcpResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return JSON.parse(body) as Record<string, unknown>;
  const data = body.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).at(-1);
  if (!data) throw new Error(`MCP stream has no data event: ${body}`);
  return JSON.parse(data) as Record<string, unknown>;
}

const result: SourceRouteOutput = { status: 'no_suitable_route_found', routes: [], checked: { direct_probes: [], pages_fetched: 0, search_queries: 0 }, limitations: ['Test fixture.'] };

describe('x402 V2 execution boundaries', () => {
  it('returns protocol 402 responses, runs one shared handler only after valid mock settlement, and protects MCP calls', async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const facilitator = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown : {};
      res.setHeader('content-type', 'application/json');
      if (req.url?.endsWith('/supported')) res.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532', extra: {} }], extensions: ['bazaar'], signers: {} }));
      else if (req.url?.endsWith('/verify')) res.end(JSON.stringify({ isValid: true, payer: signer.address }));
      else if (req.url?.endsWith('/settle')) res.end(JSON.stringify({ success: true, payer: signer.address, transaction: `0x${'ab'.repeat(32)}`, network: 'eip155:84532' }));
      else { res.statusCode = 404; res.end(JSON.stringify({ error: 'not found', received: Boolean(body) })); }
    });
    const facilitatorPort = await listen(facilitator);
    const baseConfig = loadConfig({ NODE_ENV: 'test', RATE_LIMIT_MAX_REQUESTS: '40' });
    const config: AppConfig = {
      ...baseConfig,
      paymentMode: 'test',
      paymentConfigured: true,
      x402: { payTo: `0x${'34'.repeat(20)}`, network: 'eip155:84532', facilitatorUrl: `http://127.0.0.1:${facilitatorPort}`, facilitatorAuthorization: 'Bearer test-secret-not-for-readiness' },
    };
    const payment = await createX402PaymentIntegration(config, toolRegistry);
    if (!payment) throw new Error('Expected payment integration.');
    let handlerCalls = 0;
    let paidSearchCalls = 0;
    const sourceRouteHandler: ToolHandler<typeof sourceRouteInputSchema, typeof sourceRouteOutputSchema> = async (rawInput, context) => {
      parseSourceRouteInput(rawInput);
      handlerCalls += 1;
      paidSearchCalls += 1;
      return successResponse({ toolId: 'source_route', toolVersion: '0.1.0-beta.1', requestId: context.requestId, result, startedAt: new Date() });
    };
    const app = createHttpApp(config, { payment, sourceRouteHandler });
    const appServer = await new Promise<Server>((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
    runningServers.push(appServer);
    const address = appServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected app TCP server.');
    const endpoint = `http://127.0.0.1:${address.port}`;
    const input = { goal: 'Find a relevant API', domain: 'statistics.test' };

    const unpaid = await fetch(`${endpoint}/v1/tools/source_route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    expect(unpaid.status).toBe(402);
    expect(unpaid.headers.get('payment-required')).toBeTruthy();
    const httpRequired = decodePaymentRequiredHeader(unpaid.headers.get('payment-required') ?? '');
    expect(httpRequired.x402Version).toBe(2);
    expect(httpRequired.accepts[0]).toMatchObject({ scheme: 'exact', network: 'eip155:84532', payTo: config.x402.payTo });
    expect(httpRequired.extensions).toHaveProperty('bazaar');
    expect(httpRequired.accepts[0]?.amount).toBe('20000');
    expect(toolRegistry.find((tool) => tool.id === 'source_route')?.priceUsd).toBe('0.02');
    expect(handlerCalls).toBe(0);
    expect(paidSearchCalls).toBe(0);
    const unpaidInvalidJson = await fetch(`${endpoint}/v1/tools/source_route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    expect(unpaidInvalidJson.status).toBe(402);
    expect(handlerCalls).toBe(0);
    for (const alias of ['/v1/tools/source_route/', '/V1/TOOLS/source_route', '/v1/tools/%73ource_route']) {
      const aliasResponse = await fetch(`${endpoint}${alias}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      expect(aliasResponse.status).not.toBe(200);
    }
    expect(handlerCalls).toBe(0);

    const malformed = await fetch(`${endpoint}/v1/tools/source_route`, { method: 'POST', headers: { 'content-type': 'application/json', 'payment-signature': 'e30=' }, body: JSON.stringify(input) });
    expect(malformed.status).toBe(402);
    expect(handlerCalls).toBe(0);

    const client = new x402Client().register('eip155:84532', new ExactEvmScheme(signer));
    const fetchWithPayment = wrapFetchWithPayment(fetch, client);
    const paidHttp = await fetchWithPayment(`${endpoint}/v1/tools/source_route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    expect(paidHttp.status).toBe(200);
    const paidBody = await paidHttp.json() as { success: boolean; requestId: string };
    expect(paidBody.success).toBe(true);
    expect(paidBody.requestId).toBeTruthy();
    expect(paidHttp.headers.get('payment-response')).toBeTruthy();
    expect(handlerCalls).toBe(1);
    expect(paidSearchCalls).toBe(1);

    const unpaidMcp = await fetch(`${endpoint}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'source_route', arguments: input } }) });
    const unpaidMcpResponse = await parseMcpResponse(unpaidMcp) as unknown as { result: { isError: boolean; structuredContent: { x402Version: number; accepts: unknown[] } } };
    expect(unpaidMcpResponse.result.isError).toBe(true);
    expect(unpaidMcpResponse.result.structuredContent.x402Version).toBe(2);
    expect(unpaidMcpResponse.result.structuredContent.accepts.length).toBeGreaterThan(0);
    expect(unpaidMcpResponse.result.structuredContent).toHaveProperty('extensions.bazaar');
    expect(handlerCalls).toBe(1);

    const mcpRequired = unpaidMcpResponse.result.structuredContent as unknown as import('@x402/core/types').PaymentRequired;
    const mcpPayload = await client.createPaymentPayload(mcpRequired);
    const paidParams = attachPaymentToMeta({ name: 'source_route', arguments: input }, mcpPayload);
    const paidMcp = await fetch(`${endpoint}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: paidParams }) });
    const paidMcpResponse = await parseMcpResponse(paidMcp) as unknown as { result: { structuredContent: { status: string }; _meta: { fallback: { requestId: string }; 'x402/payment-response': unknown } } };
    expect(paidMcpResponse.result.structuredContent.status).toBe('no_suitable_route_found');
    expect(paidMcpResponse.result._meta.fallback.requestId).toBeTruthy();
    expect(paidMcpResponse.result._meta['x402/payment-response']).toBeDefined();
    expect(handlerCalls).toBe(2);
    expect(paidSearchCalls).toBe(2);

    const planned = await fetch(`${endpoint}/v1/tools/stop_search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(planned.status).toBe(404);
    expect(handlerCalls).toBe(2);
    const ready = await (await fetch(`${endpoint}/readyz`)).json() as { payment: Record<string, unknown> };
    expect(JSON.stringify(ready)).not.toContain('facilitator');
    expect(JSON.stringify(ready)).not.toContain(config.x402.payTo);
    expect(JSON.stringify(ready)).not.toContain('Bearer');
    expect(JSON.stringify(ready)).not.toContain('test-secret-not-for-readiness');
  });
});
