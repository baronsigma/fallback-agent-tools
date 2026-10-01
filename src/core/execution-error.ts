import { ZodError } from 'zod';
import { ToolUnavailableError } from './errors.js';
import type { ToolRecord } from './registry.js';
import type { ToolResponse } from './response.js';
import { SourceRouteInputError } from '../tools/source-route/contract.js';

export function mapExecutionError(tool: ToolRecord, error: unknown, requestId: string): { statusCode: number; response: ToolResponse<never> } {
  const now = new Date().toISOString();
  const execution = { startedAt: now, completedAt: now, durationMs: 0 };
  if (error instanceof ZodError || error instanceof SourceRouteInputError) {
    const message = error instanceof ZodError ? error.issues.map((issue) => issue.message).join('; ') : error.message;
    return { statusCode: 400, response: { success: false, toolId: tool.id, toolVersion: tool.version, requestId, error: { code: 'INVALID_INPUT', message, retryable: false }, execution } };
  }
  if (error instanceof ToolUnavailableError || error instanceof Error && error.message.includes('no registered runtime handler')) {
    const unavailable = error instanceof ToolUnavailableError;
    return { statusCode: unavailable ? 404 : 503, response: { success: false, toolId: tool.id, toolVersion: tool.version, requestId, error: { code: unavailable ? error.code : 'HANDLER_UNAVAILABLE', message: error.message, retryable: false }, execution } };
  }
  return { statusCode: 502, response: { success: false, toolId: tool.id, toolVersion: tool.version, requestId, error: { code: 'DISCOVERY_FAILED', message: error instanceof Error ? error.message : 'Discovery failed.', retryable: true }, execution } };
}
