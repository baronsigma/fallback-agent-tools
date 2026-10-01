import { HTTPFacilitatorClient, x402ResourceServer, type RoutesConfig } from '@x402/core/server';
import type { Network } from '@x402/core/types';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { paymentMiddleware } from '@x402/express';
import { createPaymentWrapper } from '@x402/mcp';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import type { RequestHandler } from 'express';
import type { AppConfig } from '../../core/config.js';
import type { ToolRecord } from '../../core/registry.js';

export type McpToolCallback = (args: Record<string, unknown>, context: unknown) => Promise<unknown> | unknown;

type McpSdkContext = { mcpReq?: { _meta?: Record<string, unknown> } };

export type X402PaymentIntegration = {
  httpMiddleware: RequestHandler;
  wrapMcpTool: (tool: ToolRecord, handler: McpToolCallback) => McpToolCallback;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Canonical input schema must be an object for x402 Bazaar discovery.');
  return value as Record<string, unknown>;
}

function discoverySchema(tool: ToolRecord): Record<string, unknown> {
  const schema = structuredClone(asObject(tool.inputSchema.toJSONSchema({ io: 'input' })));
  const stripUnknownFormat = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(stripUnknownFormat); return; }
    delete (value as Record<string, unknown>)['format'];
    Object.values(value).forEach(stripUnknownFormat);
  };
  stripUnknownFormat(schema);
  return schema;
}

export async function createX402PaymentIntegration(config: AppConfig, registry: readonly ToolRecord[]): Promise<X402PaymentIntegration | undefined> {
  if (config.paymentMode === 'disabled') return undefined;
  const payTo = config.x402.payTo;
  const network = config.x402.network;
  const facilitatorUrl = config.x402.facilitatorUrl;
  if (!payTo || !network || !facilitatorUrl) throw new Error('Paid configuration was not validated.');
  const authorization = config.x402.facilitatorAuthorization;
  const facilitator = new HTTPFacilitatorClient({
    url: facilitatorUrl,
    ...(authorization ? { createAuthHeaders: async () => ({ verify: { Authorization: authorization }, settle: { Authorization: authorization }, supported: { Authorization: authorization }, bazaar: { Authorization: authorization } }) } : {}),
  });
  const networkId = network as Network;
  const resourceServer = new x402ResourceServer(facilitator).register(networkId, new ExactEvmScheme());
  await resourceServer.initialize();

  const paidTools = registry.filter((tool) => tool.availability === 'available' && tool.x402.enabled);
  const httpRoutes = Object.fromEntries(paidTools.filter((tool) => tool.x402.resourceType === 'http').map((tool) => {
    const input = tool.examples[0]?.input ?? {};
    const extension = declareDiscoveryExtension({
      bodyType: 'json',
      description: tool.description,
      input,
      inputSchema: discoverySchema(tool),
    });
    return [`POST ${tool.httpRoute}`, {
      accepts: [{ scheme: 'exact', network: networkId, payTo, price: `$${tool.priceUsd}` }],
      description: tool.description,
      mimeType: 'application/json',
      extensions: extension,
    }];
  })) as RoutesConfig;
  const httpMiddleware = paymentMiddleware(httpRoutes, resourceServer, undefined, undefined, false);
  const mcpWrappers = new Map<string, (handler: (args: Record<string, unknown>, context: never) => unknown) => McpToolCallback>();
  for (const tool of paidTools.filter((candidate) => candidate.availability === 'available')) {
    const accepts = await resourceServer.buildPaymentRequirements({ scheme: 'exact', network: networkId, payTo, price: `$${tool.priceUsd}` });
    const extensions = declareDiscoveryExtension({
      toolName: tool.mcpName,
      description: tool.description,
      transport: 'streamable-http',
      inputSchema: discoverySchema(tool),
      example: tool.examples[0]?.input ?? {},
    });
    const paid = createPaymentWrapper(resourceServer, {
      accepts,
      resource: { url: `mcp://tool/${tool.mcpName}`, description: tool.description },
      extensions,
    });
    mcpWrappers.set(tool.id, (handler) => paid(handler as never));
  }
  return {
    httpMiddleware,
    wrapMcpTool: (tool, handler) => {
      const wrap = mcpWrappers.get(tool.id);
      if (!wrap) return handler;
      const wrapped = wrap(handler as never);
      return (args, context) => {
        const metadata = (context as McpSdkContext | undefined)?.mcpReq?._meta;
        return wrapped(args, { ...(metadata ? { _meta: metadata } : {}) });
      };
    },
  };
}
