import { ToolUnavailableError } from './errors.js';
import { getToolById } from './registry.js';
import type { ToolResponse } from './response.js';

export async function executeTool<T>(
  toolId: string,
  handler: () => Promise<ToolResponse<T>>,
): Promise<ToolResponse<T>> {
  const tool = getToolById(toolId);
  if (!tool) throw new Error(`Unknown tool '${toolId}'.`);
  if (tool.availability !== 'available') throw new ToolUnavailableError(toolId);
  return handler();
}
