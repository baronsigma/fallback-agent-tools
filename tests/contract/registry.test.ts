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
  });

  it('has schemas that validate JSON and JSON Schema conversion', () => {
    for (const tool of toolRegistry) {
      expect(tool.inputSchema.parse({})).toEqual({});
      expect(tool.outputSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
      expect(tool.inputSchema.toJSONSchema()).toMatchObject({ type: 'object' });
      expect(tool.outputSchema.toJSONSchema()).toMatchObject({ type: 'object' });
    }
  });
});
