import type { AnyToolHandler, ToolHandler } from './tool.js';
import type { ToolResponse } from './response.js';
import { toolRegistry } from './registry.js';
import { createSourceRouteHandler } from '../tools/source-route/handler.js';
import { parseSourceRouteInput, sourceRouteInputSchema, sourceRouteOutputSchema } from '../tools/source-route/contract.js';
import { handleErrorRoute } from '../tools/error-route/handler.js';
import { errorRouteInputSchema } from '../tools/error-route/contract.js';

export type RegisteredToolHandler = { id: string; handler: AnyToolHandler };

const sourceRoute = createSourceRouteHandler() as ToolHandler<typeof sourceRouteInputSchema, typeof sourceRouteOutputSchema>;

export const runtimeToolHandlers: readonly RegisteredToolHandler[] = [
  { id: 'source_route', handler: async (input, context): Promise<ToolResponse<unknown>> => sourceRoute(parseSourceRouteInput(input), context) },
  { id: 'error_route', handler: async (input, context): Promise<ToolResponse<unknown>> => handleErrorRoute(errorRouteInputSchema.parse(input), context) },
];

export function validateRuntimeHandlers(
  handlers: readonly RegisteredToolHandler[] = runtimeToolHandlers,
  registry = toolRegistry,
): void {
  const ids = new Set<string>();
  for (const entry of handlers) {
    if (ids.has(entry.id)) throw new Error(`Duplicate runtime handler ID: ${entry.id}`);
    ids.add(entry.id);
    if (!registry.some((tool) => tool.id === entry.id)) throw new Error(`Runtime handler '${entry.id}' is not a canonical tool.`);
  }
  if (handlers === runtimeToolHandlers) for (const tool of registry) {
    if (tool.availability === 'available' && !ids.has(tool.id)) throw new Error(`Available tool '${tool.id}' has no registered runtime handler.`);
  }
}

validateRuntimeHandlers();
