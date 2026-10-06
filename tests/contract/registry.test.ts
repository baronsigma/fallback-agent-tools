import { describe, expect, it } from 'vitest';
import { toolRegistry, validateRegistry } from '../../src/core/registry.js';
import { isValidPrice } from '../../src/core/pricing.js';
import { getRequestRepairDiscoveryInputSchema } from '../../src/tools/request-repair/contract.js';

function propertiesMissingDescriptions(schema: unknown, path = '$'): string[] {
  if (!schema || typeof schema !== 'object') return [];
  if (Array.isArray(schema)) return schema.flatMap((entry, index) => propertiesMissingDescriptions(entry, `${path}[${index}]`));
  const node = schema as Record<string, unknown>;
  const missing: string[] = [];
  const properties = node['properties'];
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [key, value] of Object.entries(properties)) {
      const description = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)['description'] : undefined;
      if (typeof description !== 'string' || description.trim().length === 0) missing.push(`${path}.${key}`);
      missing.push(...propertiesMissingDescriptions(value, `${path}.${key}`));
    }
  }
  for (const key of ['items', 'additionalProperties', 'unevaluatedProperties'] as const) {
    const child = node[key];
    if (child && typeof child === 'object') missing.push(...propertiesMissingDescriptions(child, `${path}.${key}`));
  }
  for (const key of ['oneOf', 'anyOf', 'allOf', 'prefixItems'] as const) {
    if (Array.isArray(node[key])) missing.push(...propertiesMissingDescriptions(node[key], `${path}.${key}`));
  }
  const defs = node['$defs'];
  if (defs && typeof defs === 'object' && !Array.isArray(defs)) {
    for (const [key, value] of Object.entries(defs)) missing.push(...propertiesMissingDescriptions(value, `${path}.$defs.${key}`));
  }
  return missing;
}

describe('canonical registry', () => {
  it('has unique IDs and transport identifiers', () => {
    expect(() => validateRegistry()).not.toThrow();
    expect(new Set(toolRegistry.map((tool) => tool.id)).size).toBe(toolRegistry.length);
    expect(new Set(toolRegistry.map((tool) => tool.httpRoute)).size).toBe(toolRegistry.length);
    expect(new Set(toolRegistry.map((tool) => tool.mcpName)).size).toBe(toolRegistry.length);
    for (const tool of toolRegistry) expect(tool.mcpName).toBe(tool.publicName);
  });

  it('stores valid prices centrally', () => {
    for (const tool of toolRegistry) expect(isValidPrice(tool.priceUsd)).toBe(true);
    expect(isValidPrice('0')).toBe(false);
    expect(isValidPrice('0.0000001')).toBe(false);
    expect(isValidPrice('-1')).toBe(false);
    expect(toolRegistry.find((tool) => tool.id === 'source_route')?.priceUsd).toBe('0.02');
    expect(toolRegistry.find((tool) => tool.id === 'stop_search')?.priceUsd).toBe('0.003');
    expect(toolRegistry.find((tool) => tool.id === 'error_route')?.priceUsd).toBe('0.002');
  });

  it('has schemas that validate JSON and JSON Schema conversion', () => {
    for (const tool of toolRegistry) {
      expect(tool.inputSchema.parse(tool.examples[0]?.input ?? {})).toBeDefined();
      expect(() => tool.outputSchema.toJSONSchema()).not.toThrow();
      expect(tool.inputSchema.toJSONSchema()).toMatchObject({ type: 'object' });
      expect(tool.inputSchema.toJSONSchema({ io: 'input' })).toMatchObject({ type: 'object' });
      expect(tool.outputSchema.toJSONSchema()).toMatchObject({ type: 'object' });
    }
    const sourceInput = toolRegistry.find((tool) => tool.id === 'source_route')?.inputSchema.toJSONSchema({ io: 'input' });
    expect(sourceInput).toMatchObject({ required: ['goal'] });
  });

  it('describes every input property without renaming tools', () => {
    expect(toolRegistry.map((tool) => tool.id)).toEqual(['source_route', 'error_route', 'request_repair', 'stop_search']);
    expect(toolRegistry.map((tool) => tool.mcpName)).toEqual(['source_route', 'error_route', 'request_repair', 'stop_search']);
    expect(toolRegistry.map((tool) => tool.publicName)).toEqual(['source_route', 'error_route', 'request_repair', 'stop_search']);
    for (const tool of toolRegistry) {
      expect(propertiesMissingDescriptions(tool.inputSchema.toJSONSchema({ io: 'input' })), tool.id).toEqual([]);
    }
    const discovery = getRequestRepairDiscoveryInputSchema();
    expect(propertiesMissingDescriptions(discovery), 'request_repair discovery').toEqual([]);
    const schemaProperty = (discovery['properties'] as Record<string, Record<string, unknown>>)['schema'];
    expect(typeof schemaProperty?.['description']).toBe('string');
    expect(schemaProperty).not.toHaveProperty('$ref');
  });

  it('advertises read-only MCP annotations that match each tool', () => {
    for (const tool of toolRegistry) {
      expect(tool.mcpAnnotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    }
    expect(toolRegistry.find((tool) => tool.id === 'source_route')?.mcpAnnotations.openWorldHint).toBe(true);
    for (const id of ['error_route', 'request_repair', 'stop_search']) {
      expect(toolRegistry.find((tool) => tool.id === id)?.mcpAnnotations.openWorldHint).toBe(false);
    }
  });
});
