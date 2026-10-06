import { describe, expect, it, vi } from 'vitest';
import { declareDiscoveryExtension, validateBazaarRouteExtensions, validateDiscoveryExtension } from '@x402/extensions/bazaar';
import { toolRegistry } from '../../src/core/registry.js';
import { getBazaarDiscoveryInputSchema } from '../../src/surfaces/x402/payment.js';
import { makeX402Discovery } from '../../src/surfaces/x402/discovery.js';
import { requestRepairInputSchema } from '../../src/tools/request-repair/contract.js';
import { makeOpenApi } from '../../src/surfaces/http/openapi.js';

function hasLocalRefs(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasLocalRefs);
  if (!value || typeof value !== 'object') return false;
  const object = value as Record<string, unknown>;
  if (typeof object['$ref'] === 'string' && object['$ref'].startsWith('#/')) return true;
  return Object.values(object).some(hasLocalRefs);
}

describe('Bazaar discovery schemas', () => {
  it('reproduces the installed extension validator failure for the canonical recursive request_repair schema', () => {
    const tool = toolRegistry.find((entry) => entry.id === 'request_repair')!;
    expect(tool.inputSchema).toBe(requestRepairInputSchema);
    const canonical = tool.inputSchema.toJSONSchema({ io: 'input' }) as Record<string, unknown>;
    expect(JSON.stringify(canonical)).toContain('#/$defs/__schema0');
    const extension = declareDiscoveryExtension({
      bodyType: 'json', input: tool.examples[0]!.input, description: tool.description, inputSchema: canonical,
    });
    const warnings: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(args.join(' ')));
    try {
      validateBazaarRouteExtensions({
        [ `POST ${tool.httpRoute}` ]: { accepts: [], extensions: extension },
      } as never);
    } finally { warn.mockRestore(); }
    expect(warnings.some((message) => message.includes("can't resolve reference #/$defs/__schema0"))).toBe(true);
  });

  it('validates HTTP and MCP discovery schemas for every available tool with no unresolved refs', () => {
    const tools = toolRegistry.filter((tool) => tool.availability === 'available');
    const routes: Record<string, unknown> = {};
    for (const tool of tools) {
      const schema = getBazaarDiscoveryInputSchema(tool);
      expect(hasLocalRefs(schema), `${tool.id} contains a local reference`).toBe(false);
      expect(schema).not.toHaveProperty('$defs');
      expect(tool.inputSchema.safeParse(tool.examples[0]?.input ?? {}).success).toBe(true);

      const httpExtension = declareDiscoveryExtension({ bodyType: 'json', input: tool.examples[0]!.input, description: tool.description, inputSchema: schema });
      const httpBazaar = httpExtension['bazaar'] as { info: { input: Record<string, unknown> } };
      httpBazaar.info.input['method'] = 'POST'; // Matches the installed HTTP startup validator's synthetic method.
      expect(validateDiscoveryExtension(httpBazaar as never), `${tool.id} HTTP extension`).toMatchObject({ valid: true });
      routes[`POST ${tool.httpRoute}`] = { accepts: [], extensions: httpExtension };

      const mcpExtension = declareDiscoveryExtension({ toolName: tool.mcpName, description: tool.description, transport: 'streamable-http', inputSchema: schema, example: tool.examples[0]!.input });
      expect(validateDiscoveryExtension(mcpExtension['bazaar'] as never), `${tool.id} MCP extension`).toMatchObject({ valid: true });
    }
    const warnings: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(args.join(' ')));
    try { validateBazaarRouteExtensions(routes as never); }
    finally { warn.mockRestore(); }
    expect(warnings).toEqual([]);
  });

  it('keeps request_repair runtime validation canonical and strict', () => {
    const tool = toolRegistry.find((entry) => entry.id === 'request_repair')!;
    expect(tool.inputSchema.safeParse(tool.examples[0]!.input).success).toBe(true);
    expect(tool.inputSchema.safeParse({ request: { body: 'x'.repeat(20_000) }, response: { status: 400 } }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ request: {}, response: { status: 400 }, unrecognized: true }).success).toBe(false);
    expect(tool.discoveryInputSchema).toBeDefined();
    const projected = makeX402Discovery('https://fallback.test')['resources'] as Array<{ id: string; inputSchema: Record<string, unknown> }>;
    const repairResource = projected.find((resource) => resource.id === 'request_repair');
    expect(repairResource).toBeDefined();
    expect(hasLocalRefs(repairResource?.inputSchema)).toBe(false);
    const repairProperties = repairResource?.inputSchema['properties'] as Record<string, Record<string, unknown>>;
    expect(repairProperties['request']).toBeDefined();
    expect(typeof repairProperties['schema']?.['description']).toBe('string');
    expect(repairProperties['schema']).not.toHaveProperty('$ref');
    expect(tool.inputSchema.toJSONSchema({ io: 'input' })).toMatchObject({ $defs: expect.any(Object) });
    const openapi = makeOpenApi('https://fallback.test', true) as { paths: Record<string, { post: { requestBody: { content: { 'application/json': { schema: unknown } } } } }> };
    expect(openapi.paths['/v1/tools/request_repair']?.post.requestBody.content['application/json'].schema)
      .toEqual(tool.inputSchema.toJSONSchema({ io: 'input' }));
  });
});
