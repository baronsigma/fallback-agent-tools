import { z } from 'zod';
import { isValidPrice } from './pricing.js';

const emptyInput = z.object({}).strict();
const genericOutput = z.object({ status: z.string() }).passthrough();

export const toolStatuses = ['planned', 'available', 'disabled'] as const;
export type ToolStatus = typeof toolStatuses[number];
export type ToolCategory = 'source-discovery' | 'search-quality' | 'tool-recovery';

export type ToolRecord = {
  id: string;
  version: string;
  publicName: string;
  description: string;
  category: ToolCategory;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  priceUsd: string;
  availability: ToolStatus;
  httpRoute: string;
  mcpName: string;
  examples: Array<{ title: string; input: Record<string, unknown>; expected?: string }>;
  latencyTargetMs: number;
  x402: { resourceType: 'http' | 'mcp'; enabled: boolean; discoveryExtension: 'bazaar' };
  distribution: { apifyActorId: string; smitheryServerId: string; glamaServerId: string };
};

export const toolRegistry: readonly ToolRecord[] = [
  {
    id: 'source_route', version: '0.1.0', publicName: 'source_route',
    description: 'Identify a suitable authoritative or machine-readable access path for a requested information source. Planned and unavailable.',
    category: 'source-discovery', inputSchema: emptyInput, outputSchema: genericOutput,
    priceUsd: '0.01', availability: 'planned', httpRoute: '/v1/tools/source_route', mcpName: 'source_route',
    examples: [{ title: 'Planned schema placeholder', input: {} }],
    latencyTargetMs: 1500, x402: { resourceType: 'http', enabled: false, discoveryExtension: 'bazaar' },
    distribution: { apifyActorId: 'fallback/source-route', smitheryServerId: 'source_route', glamaServerId: 'source_route' },
  },
  {
    id: 'stop_search', version: '0.1.0', publicName: 'stop_search',
    description: 'Determine whether a bounded search has gathered enough negative evidence to reasonably stop. Planned and unavailable.',
    category: 'search-quality', inputSchema: emptyInput, outputSchema: genericOutput,
    priceUsd: '0.02', availability: 'planned', httpRoute: '/v1/tools/stop_search', mcpName: 'stop_search',
    examples: [{ title: 'Planned schema placeholder', input: {} }],
    latencyTargetMs: 1000, x402: { resourceType: 'http', enabled: false, discoveryExtension: 'bazaar' },
    distribution: { apifyActorId: 'fallback/stop-search', smitheryServerId: 'stop_search', glamaServerId: 'stop_search' },
  },
  {
    id: 'error_route', version: '0.1.0', publicName: 'error_route',
    description: 'Classify an API or tool failure and recommend a bounded next action. Planned and unavailable.',
    category: 'tool-recovery', inputSchema: emptyInput, outputSchema: genericOutput,
    priceUsd: '0.002', availability: 'planned', httpRoute: '/v1/tools/error_route', mcpName: 'error_route',
    examples: [{ title: 'Planned schema placeholder', input: {} }],
    latencyTargetMs: 500, x402: { resourceType: 'http', enabled: false, discoveryExtension: 'bazaar' },
    distribution: { apifyActorId: 'fallback/error-route', smitheryServerId: 'error_route', glamaServerId: 'error_route' },
  },
];

export function validateRegistry(registry: readonly ToolRecord[] = toolRegistry): void {
  const ids = new Set<string>();
  const publicNames = new Set<string>();
  const routes = new Set<string>();
  const mcpNames = new Set<string>();
  for (const tool of registry) {
    if (ids.has(tool.id)) throw new Error(`Duplicate tool ID: ${tool.id}`);
    if (publicNames.has(tool.publicName)) throw new Error(`Duplicate public name: ${tool.publicName}`);
    if (routes.has(tool.httpRoute)) throw new Error(`Duplicate HTTP route: ${tool.httpRoute}`);
    if (mcpNames.has(tool.mcpName)) throw new Error(`Duplicate MCP name: ${tool.mcpName}`);
    ids.add(tool.id); publicNames.add(tool.publicName); routes.add(tool.httpRoute); mcpNames.add(tool.mcpName);
    if (!isValidPrice(tool.priceUsd)) throw new Error(`Invalid USD price for ${tool.id}: ${tool.priceUsd}`);
    tool.inputSchema.parse({});
    tool.outputSchema.parse({ status: 'schema-check' });
  }
}

export function getToolById(id: string): ToolRecord | undefined {
  return toolRegistry.find((tool) => tool.id === id);
}
