import { ToolUnavailableError } from './errors.js';
import { getToolById, toolRegistry, type ToolRecord } from './registry.js';
import { runtimeToolHandlers, type RegisteredToolHandler } from './handlers.js';
import type { ToolResponse } from './response.js';

export async function executeTool<T>(
  toolId: string,
  input: unknown = {},
  requestId = 'request',
  handlers: readonly RegisteredToolHandler[] = runtimeToolHandlers,
  registry: readonly ToolRecord[] = toolRegistry,
): Promise<ToolResponse<T>> {
  const tool = registry === toolRegistry ? getToolById(toolId) : registry.find((entry) => entry.id === toolId);
  if (!tool) throw new Error(`Unknown tool '${toolId}'.`);
  if (tool.availability !== 'available') throw new ToolUnavailableError(toolId);
  const entry = handlers.find((registered) => registered.id === toolId);
  if (!entry) throw new Error(`Available tool '${toolId}' has no registered runtime handler.`);
  return await entry.handler(input, { requestId }) as ToolResponse<T>;
}
