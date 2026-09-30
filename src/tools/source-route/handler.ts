import { randomUUID } from 'node:crypto';
import { successResponse } from '../../core/response.js';
import { getToolById } from '../../core/registry.js';
import type { ToolHandler } from '../../core/tool.js';
import { parseSourceRouteInput, sourceRouteInputSchema, sourceRouteOutputSchema } from './contract.js';
import { discoverSourceRoutes, type SourceRouteDiscoveryOptions } from './discovery.js';
import { configuredSearchProvider, type SearchProvider } from './search-provider.js';

export type SourceRouteDependencies = Pick<SourceRouteDiscoveryOptions, 'fetcher' | 'validateUrl'> & { searchProvider?: SearchProvider };

export function createSourceRouteHandler(dependencies: SourceRouteDependencies = {}): ToolHandler<typeof sourceRouteInputSchema, typeof sourceRouteOutputSchema> {
  return async (rawInput, context) => {
    const startedAt = new Date();
    const input = parseSourceRouteInput(rawInput);
    const searchProvider = dependencies.searchProvider ?? configuredSearchProvider();
    const tool = getToolById('source_route');
    if (!tool) throw new Error('source_route is missing from the canonical registry.');
    const discovery = await discoverSourceRoutes(input, {
      ...(dependencies.fetcher ? { fetcher: dependencies.fetcher } : {}),
      ...(dependencies.validateUrl ? { validateUrl: dependencies.validateUrl } : {}),
      ...(searchProvider ? { searchProvider } : {}),
    });
    const output = sourceRouteOutputSchema.parse({
      status: discovery.routes.length ? 'routes_found' : !input.domain && !searchProvider ? 'insufficient_input' : 'no_suitable_route_found',
      routes: discovery.routes,
      checked: {
        direct_probes: discovery.metrics.requests,
        pages_fetched: discovery.metrics.pagesFetched,
        search_queries: discovery.metrics.searchQueries,
      },
      limitations: discovery.limitations,
    });
    return successResponse({
      toolId: tool.id, toolVersion: tool.version, requestId: context.requestId || randomUUID(), result: output, startedAt,
      executionMetrics: {
        outboundHttpRequests: discovery.metrics.requests.length + discovery.metrics.searchQueries,
        paidSearchCalls: discovery.metrics.searchQueries,
        discoverySource: discovery.metrics.source,
      },
    });
  };
}

export const handleSourceRoute = createSourceRouteHandler();
