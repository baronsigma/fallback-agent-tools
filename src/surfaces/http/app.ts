import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { toolRegistry, getToolById } from '../../core/registry.js';
import { productMetadata } from '../../core/product.js';
import { ToolUnavailableError } from '../../core/errors.js';
import type { AppConfig } from '../../core/config.js';
import { makeOpenApi } from './openapi.js';
import { makeServerCard } from '../mcp/card.js';
import { makeX402Discovery } from '../x402/discovery.js';

function catalog(baseUrl: string) {
  return {
    name: productMetadata.name,
    description: productMetadata.description,
    version: productMetadata.version,
    endpoints: Object.fromEntries(Object.entries(productMetadata.endpoints).map(([key, path]) => [key, `${baseUrl}${path}`])),
    tools: toolRegistry.map((tool) => ({
      id: tool.id, version: tool.version, name: tool.publicName, description: tool.description, category: tool.category,
      inputSchema: tool.inputSchema.toJSONSchema(), outputSchema: tool.outputSchema.toJSONSchema(), price: { amount: tool.priceUsd, currency: 'USD', model: 'pay-per-call' },
      availability: tool.availability, httpRoute: tool.httpRoute, mcpName: tool.mcpName, examples: tool.examples,
      latencyTargetMs: tool.latencyTargetMs, x402: tool.x402, distribution: tool.distribution,
    })),
  };
}

function llmsText(baseUrl: string, full = false): string {
  const lines = [`# ${productMetadata.name}`, '', productMetadata.description, '', `Catalog: ${baseUrl}/catalog.json`, `MCP endpoint: ${baseUrl}/mcp`, '', '## Tools'];
  for (const tool of toolRegistry) {
    lines.push('', `### ${tool.publicName}`, tool.description, `Status: ${tool.availability}`, `Price: $${tool.priceUsd} USD per call`, `HTTP: ${baseUrl}${tool.httpRoute}`, `MCP: ${tool.mcpName}`);
    if (full) lines.push(`Category: ${tool.category}`, `Latency target: ${tool.latencyTargetMs} ms`, `Input schema: ${JSON.stringify(tool.inputSchema.toJSONSchema())}`, `Output schema: ${JSON.stringify(tool.outputSchema.toJSONSchema())}`, `Example: ${JSON.stringify(tool.examples[0]?.input ?? {})}`);
  }
  return `${lines.join('\n')}\n`;
}

export function createHttpApp(config: AppConfig): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.get('/', (_req, res) => res.json({ name: productMetadata.name, description: productMetadata.description, catalog: '/catalog.json', mcp: '/mcp' }));
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', (_req, res) => res.json({ status: 'ready', paymentConfigured: Boolean(config.x402.payTo), implementedTools: toolRegistry.filter((tool) => tool.availability === 'available').length }));
  app.get('/catalog.json', (_req, res) => res.json(catalog(config.publicBaseUrl)));
  app.get('/openapi.json', (_req, res) => res.json(makeOpenApi(config.publicBaseUrl)));
  app.get('/llms.txt', (_req, res) => res.type('text/plain').send(llmsText(config.publicBaseUrl)));
  app.get('/llms-full.txt', (_req, res) => res.type('text/plain').send(llmsText(config.publicBaseUrl, true)));
  app.get('/.well-known/x402.json', (_req, res) => res.json(makeX402Discovery(config.publicBaseUrl)));
  app.get('/.well-known/mcp/server-card.json', (_req, res) => res.json(makeServerCard(config.publicBaseUrl)));
  app.post('/v1/tools/:toolId', (req, res) => {
    const tool = getToolById(req.params.toolId ?? '');
    if (!tool || tool.availability !== 'available') {
      const error = new ToolUnavailableError(req.params.toolId ?? '');
      res.status(404).json({ success: false, toolId: tool?.id ?? req.params.toolId, toolVersion: tool?.version ?? 'unknown', requestId: randomUUID(), error: { code: error.code, message: error.message, retryable: false }, execution: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 0 } });
      return;
    }
    // Payment middleware and the shared handler are attached when a tool is admitted.
    res.status(501).json({ success: false, toolId: tool.id, toolVersion: tool.version, requestId: randomUUID(), error: { code: 'NOT_CONFIGURED', message: 'Execution is not configured.', retryable: false }, execution: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 0 } });
  });
  app.all('/mcp', (_req, res) => res.status(501).json({ error: 'MCP transport is not enabled until at least one tool is available.' }));
  return app;
}

export function getCatalog(baseUrl: string) { return catalog(baseUrl); }
export function getLlmsText(baseUrl: string, full = false) { return llmsText(baseUrl, full); }
