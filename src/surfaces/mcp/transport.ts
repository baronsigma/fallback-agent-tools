import { createMcpHandler as createMcpHandlerSdk, McpServer } from '@modelcontextprotocol/server';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../core/config.js';
import { executeTool } from '../../core/executor.js';
import { mapExecutionError } from '../../core/execution-error.js';
import type { RegisteredToolHandler } from '../../core/handlers.js';
import type { ToolRecord } from '../../core/registry.js';
import { productMetadata } from '../../core/product.js';
import type { X402PaymentIntegration } from '../x402/payment.js';
import { createToolTelemetry, payerFingerprint, resultTelemetry, telemetryPrice, type ToolTelemetry } from '../../core/telemetry.js';

export function createMcpHandler(config: AppConfig, registry: readonly ToolRecord[], handlers: readonly RegisteredToolHandler[], payment?: X402PaymentIntegration, telemetry: ToolTelemetry = createToolTelemetry(config.telemetry.payerHmacKey ? { payerHmacKey: config.telemetry.payerHmacKey } : {})) {
  return createMcpHandlerSdk(() => {
    const server = new McpServer({ name: productMetadata.productId, version: productMetadata.version });
    for (const tool of registry.filter((entry) => entry.availability === 'available')) {
      const description = `${tool.description} Price: $${tool.priceUsd} USD per call${config.paymentMode === 'disabled' ? ' (x402 payment currently disabled).' : config.paymentMode === 'test' ? ' via x402 (Base Sepolia testnet during beta).' : ' via x402.'}`;
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
      const wrappedCallback = payment?.wrapMcpTool(tool, execute) ?? execute;
      const callback = async (input: Record<string, unknown>, context: unknown) => {
        const startedAt = performance.now();
        const result = await wrappedCallback(input, context);
        const output = result && typeof result === 'object' ? result as Record<string, unknown> : {};
        const structured = output['structuredContent'] && typeof output['structuredContent'] === 'object' ? output['structuredContent'] as Record<string, unknown> : {};
        const metadata = output['_meta'] && typeof output['_meta'] === 'object' ? output['_meta'] as Record<string, unknown> : {};
        const paymentResponse = metadata['x402/payment-response'] && typeof metadata['x402/payment-response'] === 'object' ? metadata['x402/payment-response'] as Record<string, unknown> : undefined;
        const challenge = structured['x402Version'] === 2 && Array.isArray(structured['accepts']);
        const state = challenge ? 'challenged'
          : paymentResponse ? paymentResponse['success'] === true ? 'settled' : 'settlement_failed'
            : config.paymentMode === 'disabled' ? 'free' : 'settlement_unconfirmed';
        telemetry.record({
          tool_id: tool.id, channel: 'mcp', payment_mode: config.paymentMode, payment_state: state, price_usd: telemetryPrice(tool),
          latency_ms: performance.now() - startedAt, client_family: 'mcp',
          ...resultTelemetry(tool.id, { success: !output['isError'], result: structured, ...(structured['error'] ? { error: structured['error'] } : {}) }),
          ...(state === 'settled' && config.telemetry.payerHmacKey && paymentResponse && payerFingerprint(paymentResponse, config.telemetry.payerHmacKey) ? { payer_fingerprint: payerFingerprint(paymentResponse, config.telemetry.payerHmacKey)! } : {}),
        });
        return result;
      };
      // x402 MCP challenges use PaymentRequired as structuredContent before execution,
      // while successful calls use the registry's business output schema. The installed
      // x402 packages do not export a runtime PaymentRequired schema we can safely union
      // with the business schema, so do not advertise a misleading single outputSchema
      // for paid MCP tools. Keep input validation and the canonical registry untouched.
      const outputSchema = payment && tool.x402.enabled ? undefined : tool.outputSchema;
      server.registerTool(tool.mcpName, {
        title: tool.publicName,
        description,
        inputSchema: tool.inputSchema as never,
        ...(outputSchema ? { outputSchema: outputSchema as never } : {}),
      }, callback as never);
    }
    return server;
  }, { legacy: 'stateless', responseMode: 'auto' });
}
