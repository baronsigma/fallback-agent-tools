import { describe, expect, it } from 'vitest';
import { toolRegistry, validateRegistry } from '../../src/core/registry.js';
import { isValidPrice } from '../../src/core/pricing.js';

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
    expect(toolRegistry.find((tool) => tool.id === 'stop_search')?.priceUsd).toBe('0.02');
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
});
