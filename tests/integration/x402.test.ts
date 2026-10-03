import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { x402Client } from '@x402/core/client';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { attachPaymentToMeta, wrapMCPClientWithPayment } from '@x402/mcp';
import { wrapFetchWithPayment } from '@x402/fetch';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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
import { runtimeToolHandlers, type RegisteredToolHandler } from '../../src/core/handlers.js';
import type { ToolResponse } from '../../src/core/response.js';
import { requestRepairOutputSchema } from '../../src/tools/request-repair/contract.js';

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
    let errorRouteHandlerCalls = 0;
    let requestRepairHandlerCalls = 0;
    const sourceRouteHandler: ToolHandler<typeof sourceRouteInputSchema, typeof sourceRouteOutputSchema> = async (rawInput, context) => {
      parseSourceRouteInput(rawInput);
      handlerCalls += 1;
      paidSearchCalls += 1;
      return successResponse({ toolId: 'source_route', toolVersion: '0.1.0-beta.1', requestId: context.requestId, result, startedAt: new Date() });
    };
    const errorRouteHandler = runtimeToolHandlers.find((entry) => entry.id === 'error_route');
    if (!errorRouteHandler) throw new Error('Expected error_route handler.');
    const requestRepairRuntime = runtimeToolHandlers.find((entry) => entry.id === 'request_repair');
    if (!requestRepairRuntime) throw new Error('Expected request_repair handler.');
    const handlers: RegisteredToolHandler[] = [
      { id: 'source_route', handler: async (rawInput, context) => sourceRouteHandler(parseSourceRouteInput(rawInput), context) as Promise<ToolResponse<unknown>> },
      { id: 'error_route', handler: async (input, context) => { errorRouteHandlerCalls += 1; return errorRouteHandler.handler(input, context); } },
      { id: 'request_repair', handler: async (input, context) => { requestRepairHandlerCalls += 1; return requestRepairRuntime.handler(input, context); } },
    ];
    const app = createHttpApp(config, { payment, handlers });
    const appServer = await new Promise<Server>((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
    runningServers.push(appServer);
    const address = appServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected app TCP server.');
    const endpoint = `http://127.0.0.1:${address.port}`;
    const input = { goal: 'Find a relevant API', domain: 'statistics.test' };

    const errorInput = { error: 'ECONNRESET' };
    const unpaidErrorRoute = await fetch(`${endpoint}/v1/tools/error_route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(errorInput) });
    expect(unpaidErrorRoute.status).toBe(402);
    const errorRequirement = decodePaymentRequiredHeader(unpaidErrorRoute.headers.get('payment-required') ?? '');
    expect(errorRequirement.x402Version).toBe(2);
    expect(errorRequirement.accepts[0]).toMatchObject({ scheme: 'exact', network: 'eip155:84532', payTo: config.x402.payTo, amount: '2000' });
    expect(errorRouteHandlerCalls).toBe(0);

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

    const paidErrorRoute = await fetchWithPayment(`${endpoint}/v1/tools/error_route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(errorInput) });
    expect(paidErrorRoute.status).toBe(200);
    const paidErrorBody = await paidErrorRoute.json() as { success: boolean; result: { classification: string }; requestId: string };
    expect(paidErrorBody).toMatchObject({ success: true, result: { classification: 'connection_failure' } });
    expect(paidErrorBody.requestId).toBeTruthy();
    expect(paidErrorRoute.headers.get('payment-response')).toBeTruthy();
    expect(errorRouteHandlerCalls).toBe(1);

    const repairInput = { goal: 'retrieve a company profile', request: { method: 'POST', url: 'https://api.example.com/company', headers: { 'content-type': 'application/json' }, body: { company_domain: 'example.com' } }, response: { status: 400, body: 'company_domain is invalid; use current_company_domains' } };
    expect(toolRegistry.find((tool) => tool.id === 'request_repair')?.priceUsd).toBe('0.005');
    const unpaidRepairHttp = await fetch(`${endpoint}/v1/tools/request_repair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(repairInput) });
    expect(unpaidRepairHttp.status).toBe(402);
    expect(requestRepairHandlerCalls).toBe(0);
    const paidRepairHttp = await fetchWithPayment(`${endpoint}/v1/tools/request_repair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(repairInput) });
    expect(paidRepairHttp.status).toBe(200);
    expect(paidRepairHttp.headers.get('payment-response')).toBeTruthy();
    const paidRepairBody = await paidRepairHttp.json() as { success: boolean; result: unknown };
    expect(paidRepairBody.success).toBe(true);
    expect(requestRepairOutputSchema.safeParse(paidRepairBody.result).success).toBe(true);
    expect(requestRepairHandlerCalls).toBe(1);

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

    const unpaidErrorMcp = await fetch(`${endpoint}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'error_route', arguments: errorInput } }) });
    const unpaidErrorMcpResponse = await parseMcpResponse(unpaidErrorMcp) as unknown as { result: { isError: boolean; structuredContent: import('@x402/core/types').PaymentRequired } };
    expect(unpaidErrorMcpResponse.result.isError).toBe(true);
    expect(unpaidErrorMcpResponse.result.structuredContent.x402Version).toBe(2);
    expect(errorRouteHandlerCalls).toBe(1);
    const paidErrorMcpPayload = await client.createPaymentPayload(unpaidErrorMcpResponse.result.structuredContent);
    const paidErrorMcpParams = attachPaymentToMeta({ name: 'error_route', arguments: errorInput }, paidErrorMcpPayload);
    const paidErrorMcp = await fetch(`${endpoint}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: paidErrorMcpParams }) });
    const paidErrorMcpResponse = await parseMcpResponse(paidErrorMcp) as unknown as { result: { structuredContent: { classification: string }; _meta: Record<string, unknown> } };
    expect(paidErrorMcpResponse.result.structuredContent.classification).toBe('connection_failure');
    expect(paidErrorMcpResponse.result._meta['x402/payment-response']).toBeDefined();
    expect(errorRouteHandlerCalls).toBe(2);

    const mcpSdk = new Client({ name: 'fallback-x402-schema-test', version: '1.0.0' });
    await mcpSdk.connect(new StreamableHTTPClientTransport(new URL(`${endpoint}/mcp`)) as never);
    const listedTools = await mcpSdk.listTools();
    const listedSource = listedTools.tools.find((tool) => tool.name === 'source_route');
    const listedError = listedTools.tools.find((tool) => tool.name === 'error_route');
    expect(listedSource?.inputSchema).toBeDefined();
    expect(listedError?.inputSchema).toBeDefined();
    expect(listedSource).not.toHaveProperty('outputSchema');
    expect(listedError).not.toHaveProperty('outputSchema');
    const listedRepair = listedTools.tools.find((tool) => tool.name === 'request_repair');
    expect(listedRepair?.inputSchema).toBeDefined();
    expect(listedRepair).not.toHaveProperty('outputSchema');

    const handlerCountsBeforeRawCalls = { source: handlerCalls, error: errorRouteHandlerCalls };
    const rawUnpaidSource = await mcpSdk.callTool({ name: 'source_route', arguments: input });
    const rawSourceChallenge = rawUnpaidSource.structuredContent as unknown as import('@x402/core/types').PaymentRequired;
    expect(rawUnpaidSource.isError).toBe(true);
    expect(rawSourceChallenge.x402Version).toBe(2);
    expect(JSON.parse(((rawUnpaidSource.content as Array<{ text: string }>)[0] as { text: string }).text)).toMatchObject({ x402Version: 2 });
    expect(handlerCalls).toBe(handlerCountsBeforeRawCalls.source);

    const rawUnpaidError = await mcpSdk.callTool({ name: 'error_route', arguments: { response: { status: 429, headers: { 'retry-after': '60' }, body: 'Too Many Requests' }, attempt: 1 } });
    const rawErrorChallenge = rawUnpaidError.structuredContent as unknown as import('@x402/core/types').PaymentRequired;
    expect(rawUnpaidError.isError).toBe(true);
    expect(rawErrorChallenge.x402Version).toBe(2);
    expect(rawErrorChallenge.accepts[0]).toMatchObject({ scheme: 'exact', network: 'eip155:84532', amount: '2000' });
    expect(JSON.parse(((rawUnpaidError.content as Array<{ text: string }>)[0] as { text: string }).text)).toMatchObject({ x402Version: 2 });
    expect(errorRouteHandlerCalls).toBe(handlerCountsBeforeRawCalls.error);

    const rawUnpaidRepair = await mcpSdk.callTool({ name: 'request_repair', arguments: repairInput });
    const repairChallenge = rawUnpaidRepair.structuredContent as unknown as import('@x402/core/types').PaymentRequired;
    expect(rawUnpaidRepair.isError).toBe(true);
    expect(repairChallenge.x402Version).toBe(2);
    expect(repairChallenge.accepts[0]).toMatchObject({ scheme: 'exact', network: 'eip155:84532', amount: '5000' });
    expect(requestRepairHandlerCalls).toBe(1);

    const malformedMcpInput = await mcpSdk.callTool({ name: 'error_route', arguments: { response: { status: 99 } } });
    expect(malformedMcpInput.isError).toBe(true);
    const malformedStructured = malformedMcpInput.structuredContent as Record<string, unknown> | undefined;
    expect(malformedStructured?.['x402Version']).toBeUndefined();
    expect(((malformedMcpInput.content as Array<{ text: string }>)[0] as { text: string }).text).toMatch(/status|invalid|validation/i);
    expect(errorRouteHandlerCalls).toBe(handlerCountsBeforeRawCalls.error);

    const officialMcp = wrapMCPClientWithPayment(mcpSdk, client, { autoPayment: true, onPaymentRequested: async () => true });
    const wrappedSource = await officialMcp.callTool('source_route', input);
    expect(wrappedSource.paymentMade).toBe(true);
    expect(wrappedSource.paymentResponse?.success).toBe(true);
    const wrappedSourceBody = JSON.parse((((wrappedSource.content as unknown) as Array<{ text: string }>)[0] as { text: string }).text) as { result: SourceRouteOutput; requestId: string };
    expect(sourceRouteOutputSchema.safeParse(wrappedSourceBody.result).success).toBe(true);
    expect(wrappedSourceBody.requestId).toBeTruthy();
    expect(handlerCalls).toBe(handlerCountsBeforeRawCalls.source + 1);

    const wrappedError = await officialMcp.callTool('error_route', { response: { status: 429, headers: { 'retry-after': '60' }, body: 'Too Many Requests' }, attempt: 1 });
    expect(wrappedError.paymentMade).toBe(true);
    expect(wrappedError.paymentResponse?.success).toBe(true);
    const wrappedErrorBody = JSON.parse((((wrappedError.content as unknown) as Array<{ text: string }>)[0] as { text: string }).text) as { result: Record<string, unknown>; requestId: string };
    expect(wrappedErrorBody.result).toMatchObject({ classification: 'rate_limited', retry: 'after_delay' });
    expect(toolRegistry.find((tool) => tool.id === 'error_route')?.outputSchema.safeParse(wrappedErrorBody.result).success).toBe(true);
    expect(wrappedErrorBody.requestId).toBeTruthy();
    expect(errorRouteHandlerCalls).toBe(handlerCountsBeforeRawCalls.error + 1);

    const wrappedRepair = await officialMcp.callTool('request_repair', repairInput);
    expect(wrappedRepair.paymentMade).toBe(true);
    expect(wrappedRepair.paymentResponse?.success).toBe(true);
    const wrappedRepairBody = JSON.parse((((wrappedRepair.content as unknown) as Array<{ text: string }>)[0] as { text: string }).text) as { result: unknown; requestId: string };
    expect(requestRepairOutputSchema.safeParse(wrappedRepairBody.result).success).toBe(true);
    expect(wrappedRepairBody.requestId).toBeTruthy();
    expect(requestRepairHandlerCalls).toBe(2);
    await mcpSdk.close();

    const freeErrorTool = toolRegistry.find((tool) => tool.id === 'error_route');
    if (!freeErrorTool) throw new Error('Expected canonical error_route tool.');
    const freeRegistry = [{ ...freeErrorTool, x402: { ...freeErrorTool.x402, enabled: false } }];
    const freeConfig: AppConfig = { ...config, paymentMode: 'disabled', paymentConfigured: false, x402: {} };
    const freeApp = createHttpApp(freeConfig, { registry: freeRegistry, handlers });
    const freeServer = createServer(freeApp);
    const freePort = await listen(freeServer);
    const freeClient = new Client({ name: 'fallback-free-mcp-schema-test', version: '1.0.0' });
    await freeClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${freePort}/mcp`)) as never);
    const freeListed = await freeClient.listTools();
    expect(freeListed.tools.find((tool) => tool.name === 'error_route')?.outputSchema).toBeDefined();
    const freeCall = await freeClient.callTool({ name: 'error_route', arguments: { response: { status: 429, headers: { 'retry-after': '60' }, body: 'Too Many Requests' }, attempt: 1 } });
    expect(freeCall.isError).not.toBe(true);
    expect(freeErrorTool.outputSchema.safeParse(freeCall.structuredContent).success).toBe(true);
    await freeClient.close();

    const planned = await fetch(`${endpoint}/v1/tools/stop_search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(planned.status).toBe(404);
    expect(handlerCalls).toBe(3);
    const ready = await (await fetch(`${endpoint}/readyz`)).json() as { payment: Record<string, unknown> };
    expect(JSON.stringify(ready)).not.toContain('facilitator');
    expect(JSON.stringify(ready)).not.toContain(config.x402.payTo);
    expect(JSON.stringify(ready)).not.toContain('Bearer');
    expect(JSON.stringify(ready)).not.toContain('test-secret-not-for-readiness');
  });
});
