import { createMcpHandler as createMcpHandlerSdk, McpServer } from '@modelcontextprotocol/server';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../core/config.js';
import { executeTool } from '../../core/executor.js';
import { mapExecutionError } from '../../core/execution-error.js';
import type { RegisteredToolHandler } from '../../core/handlers.js';
import type { ToolRecord } from '../../core/registry.js';
import { productMetadata } from '../../core/product.js';
import type { X402PaymentIntegration } from '../x402/payment.js';

export function createMcpHandler(config: AppConfig, registry: readonly ToolRecord[], handlers: readonly RegisteredToolHandler[], payment?: X402PaymentIntegration) {
  return createMcpHandlerSdk(() => {
    const server = new McpServer({ name: 'fallback-agent-tools', version: productMetadata.version });
    for (const tool of registry.filter((entry) => entry.availability === 'available')) {
      const description = `${tool.description} Price: $${tool.priceUsd} USD per call${config.paymentMode === 'disabled' ? ' (x402 payment currently disabled).' : ' via x402.'}`;
      const execute = async (input: Record<string, unknown>) => {
        const requestId = randomUUID();
        let response;
        try { response = await executeTool(tool.id, input, requestId, handlers, registry); }
        catch (error) { response = mapExecutionError(tool, error, requestId).response; }
        const structuredContent = response.success
          ? response.result && typeof response.result === 'object' ? response.result as Record<string, unknown> : { result: response.result }
          : { error: response.error };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response) }],
          structuredContent,
          _meta: { fallback: { requestId: response.requestId, execution: response.execution } },
          ...(response.success ? {} : { isError: true }),
        };
      };
      const callback = payment?.wrapMcpTool(tool, execute) ?? execute;
      server.registerTool(tool.mcpName, {
        title: tool.publicName,
        description,
        inputSchema: tool.inputSchema as never,
        outputSchema: tool.outputSchema as never,
      }, callback as never);
    }
    return server;
  }, { legacy: 'stateless', responseMode: 'auto' });
}
