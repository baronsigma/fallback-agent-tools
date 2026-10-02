import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { toolRegistry, type ToolRecord } from '../../core/registry.js';
import { productMetadata } from '../../core/product.js';
import { ToolUnavailableError } from '../../core/errors.js';
import type { AppConfig } from '../../core/config.js';
import { makeOpenApi } from './openapi.js';
import { makeServerCard } from '../mcp/card.js';
import { makeX402Discovery } from '../x402/discovery.js';
import { runtimeToolHandlers, type RegisteredToolHandler } from '../../core/handlers.js';
import type { ToolHandler } from '../../core/tool.js';
import { sourceRouteInputSchema, sourceRouteOutputSchema } from '../../tools/source-route/contract.js';
import { executeTool } from '../../core/executor.js';
import { mapExecutionError } from '../../core/execution-error.js';
import { createMcpHandler } from '../mcp/transport.js';
import type { X402PaymentIntegration } from '../x402/payment.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type RateEntry = { startedAt: number; count: number };

function makeRateLimiter(config: AppConfig) {
  const entries = new Map<string, RateEntry>();
  return (req: Request, res: Response, next: NextFunction) => {
    const limitedPath = req.path === '/mcp' || req.path.startsWith('/v1/tools/');
    if (!limitedPath) return next();
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let entry = entries.get(key);
    if (!entry || now - entry.startedAt >= config.rateLimit.windowMs) {
      if (entries.size >= 10000 && !entry) {
        for (const [candidate, value] of entries) if (now - value.startedAt >= config.rateLimit.windowMs) entries.delete(candidate);
      }
      if (entries.size >= 10000 && !entry) {
        res.setHeader('Retry-After', Math.ceil(config.rateLimit.windowMs / 1000));
        res.status(429).json({ error: 'Rate limit exceeded.' });
        return;
      }
      entry = { startedAt: now, count: 0 };
      entries.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > config.rateLimit.maxRequests) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((config.rateLimit.windowMs - (now - entry.startedAt)) / 1000)));
      res.status(429).json({ error: 'Rate limit exceeded.' });
      return;
    }
    next();
  };
}

type PublicPaymentState = Pick<AppConfig, 'paymentMode' | 'paymentConfigured'>;

function catalog(baseUrl: string, config: PublicPaymentState, registry: readonly ToolRecord[]) {
  return {
    productId: productMetadata.productId,
    name: productMetadata.productName,
    description: productMetadata.shortDescription,
    tagline: productMetadata.tagline,
    version: productMetadata.version,
    transports: { http: 'active', mcp: 'active', payment: config.paymentMode === 'disabled' ? 'disabled' : 'active' },
    payment: { mode: config.paymentMode, x402: config.paymentConfigured },
    endpoints: Object.fromEntries(Object.entries(productMetadata.endpoints).map(([key, path]) => [key, `${baseUrl}${path}`])),
    tools: registry.map((tool) => ({
      id: tool.id, version: tool.version, name: tool.publicName, description: tool.description, category: tool.category,
      inputSchema: tool.inputSchema.toJSONSchema({ io: 'input' }), outputSchema: tool.outputSchema.toJSONSchema(), price: { amount: tool.priceUsd, currency: 'USD', model: 'pay-per-call' },
      availability: tool.availability, httpRoute: tool.httpRoute, mcpName: tool.mcpName, examples: tool.examples,
      latencyTargetMs: tool.latencyTargetMs, x402: { ...tool.x402, active: config.paymentConfigured && tool.availability === 'available' && tool.x402.enabled }, distribution: tool.distribution,
    })),
  };
}

function llmsText(baseUrl: string, config: PublicPaymentState, registry: readonly ToolRecord[], full = false): string {
  const lines = [`# ${productMetadata.productName}`, '', productMetadata.tagline, '', productMetadata.shortDescription, '', `Catalog: ${baseUrl}/catalog.json`, `MCP endpoint: ${baseUrl}/mcp (active Streamable HTTP)`, `Agent skill: ${baseUrl}/skill.md`, `HTTP execution: active`, `x402 payments: ${config.paymentMode} mode`, '', '## Tools'];
  for (const tool of registry) {
    lines.push('', `### ${tool.publicName}`, tool.description, `Status: ${tool.availability}`, `Price: $${tool.priceUsd} USD per call${config.paymentConfigured && tool.x402.enabled ? ' (x402 active)' : ' (x402 inactive)'}`, `HTTP: ${baseUrl}${tool.httpRoute}`, `MCP: ${tool.availability === 'available' ? tool.mcpName : `not callable (planned: ${tool.mcpName})`}`);
    if (full) lines.push(`Category: ${tool.category}`, `Latency target: ${tool.latencyTargetMs} ms`, `Input schema: ${JSON.stringify(tool.inputSchema.toJSONSchema({ io: 'input' }))}`, `Output schema: ${JSON.stringify(tool.outputSchema.toJSONSchema())}`, `Example: ${JSON.stringify(tool.examples[0]?.input ?? {})}`);
  }
  return `${lines.join('\n')}\n`;
}

export function createHttpApp(config: AppConfig, options: {
  handlers?: readonly RegisteredToolHandler[];
  sourceRouteHandler?: ToolHandler<typeof sourceRouteInputSchema, typeof sourceRouteOutputSchema>;
  registry?: readonly ToolRecord[];
  payment?: X402PaymentIntegration;
} = {}): Express {
  if (config.paymentMode !== 'disabled' && !options.payment) throw new Error('Paid mode requires initialized x402 payment middleware.');
  const app = express();
  const registry = options.registry ?? toolRegistry;
  let handlers = options.handlers ?? runtimeToolHandlers;
  if (!options.handlers && options.sourceRouteHandler) {
    const injectedHandler = options.sourceRouteHandler;
    handlers = runtimeToolHandlers.map((entry) => entry.id === 'source_route'
      ? { ...entry, handler: (input: unknown, context: { requestId: string }) => injectedHandler(input as Parameters<typeof injectedHandler>[0], context) as Promise<import('../../core/response.js').ToolResponse<unknown>> }
      : entry);
  }
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);
  app.set('case sensitive routing', true);
  app.set('strict routing', true);
  app.use(makeRateLimiter(config));
  if (options.payment) for (const tool of registry.filter((candidate) => candidate.availability === 'available' && candidate.x402.enabled && candidate.x402.resourceType === 'http')) {
    app.post(tool.httpRoute, options.payment.httpMiddleware);
  }
  app.use(express.json({ limit: '64kb' }));
  const mcp = createMcpHandler(config, registry, handlers, options.payment);
  app.locals['mcpClose'] = mcp.close;
  app.get('/', (_req, res) => res.json({ productId: productMetadata.productId, name: productMetadata.productName, description: productMetadata.shortDescription, tagline: productMetadata.tagline, catalog: `${config.publicBaseUrl}/catalog.json`, mcp: `${config.publicBaseUrl}/mcp`, transports: { http: 'active', mcp: 'active' }, payment: { mode: config.paymentMode, priceModel: 'per-call' } }));
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', (_req, res) => res.json({
    status: 'ready',
    mcp: 'active',
    payment: { mode: config.paymentMode, configured: config.paymentConfigured, ...(config.paymentMode !== 'disabled' ? { network: config.x402.network } : {}) },
    search: { provider: config.searchProvider },
    availableTools: registry.filter((tool) => tool.availability === 'available').length,
  }));
  app.get('/catalog.json', (_req, res) => res.json(catalog(config.publicBaseUrl, config, registry)));
  app.get('/openapi.json', (_req, res) => res.json(makeOpenApi(config.publicBaseUrl, config.paymentConfigured)));
  app.get('/llms.txt', (_req, res) => res.type('text/plain').send(llmsText(config.publicBaseUrl, config, registry)));
  app.get('/llms-full.txt', (_req, res) => res.type('text/plain').send(llmsText(config.publicBaseUrl, config, registry, true)));
  app.get('/skill.md', async (_req, res, next) => {
    try { res.type('text/markdown').send(await readFile(resolve(process.cwd(), 'skill.md'), 'utf8')); }
    catch (error) { next(error); }
  });
  app.get('/.well-known/x402.json', (_req, res) => res.json(makeX402Discovery(config.publicBaseUrl, config, registry)));
  app.get('/.well-known/mcp/server-card.json', (_req, res) => res.json(makeServerCard(config.publicBaseUrl)));
  app.post('/v1/tools/:toolId', async (req, res) => {
    const tool = registry.find((registered) => registered.id === (req.params.toolId ?? ''));
    const requestId = randomUUID();
    if (!tool || tool.availability !== 'available') {
      const error = new ToolUnavailableError(req.params.toolId ?? '');
      res.status(404).json({ success: false, toolId: tool?.id ?? req.params.toolId, toolVersion: tool?.version ?? 'unknown', requestId, error: { code: error.code, message: error.message, retryable: false }, execution: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 0 } });
      return;
    }
    if (config.paymentMode !== 'disabled' && tool.id === 'source_route' && req.path !== tool.httpRoute) {
      res.status(404).json({ success: false, toolId: tool.id, toolVersion: tool.version, requestId, error: { code: 'NOT_FOUND', message: 'The paid tool route must use its canonical path.', retryable: false }, execution: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 0 } });
      return;
    }
    try {
      const response = await executeTool(tool.id, req.body, requestId, handlers, registry);
      res.json(response);
    } catch (error) {
      const mapped = mapExecutionError(tool, error, requestId);
      res.status(mapped.statusCode).json(mapped.response);
    }
  });
  app.all('/mcp', async (req, res) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    const requestInit: RequestInit = {
      method: req.method,
      headers,
      ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: JSON.stringify(req.body ?? {}) }),
    };
    try {
      const webRequest = new Request(new URL(req.originalUrl, config.publicBaseUrl), requestInit);
      const webResponse = await mcp.fetch(webRequest, { parsedBody: req.body });
      res.status(webResponse.status);
      webResponse.headers.forEach((value, key) => res.setHeader(key, value));
      if (!webResponse.body) { res.end(); return; }
      Readable.fromWeb(webResponse.body as import('node:stream/web').ReadableStream).pipe(res);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed.' });
      else res.end();
    }
  });
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    void next;
    if (!res.headersSent) res.status(400).json({ error: error instanceof SyntaxError ? 'Malformed JSON request.' : 'Request could not be processed.' });
  });
  return app;
}

export function getCatalog(baseUrl: string, config: PublicPaymentState = { paymentMode: 'disabled', paymentConfigured: false }): unknown {
  return catalog(baseUrl, config, toolRegistry);
}
export function getLlmsText(baseUrl: string, full = false, config?: AppConfig): string {
  const effective: PublicPaymentState = config ?? { paymentMode: 'disabled', paymentConfigured: false };
  return llmsText(baseUrl, effective, toolRegistry, full);
}
