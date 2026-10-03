import { describe, expect, it } from 'vitest';
import { executeTool } from '../../src/core/executor.js';
import { ToolUnavailableError } from '../../src/core/errors.js';
import { validateRuntimeHandlers } from '../../src/core/handlers.js';
import { toolRegistry } from '../../src/core/registry.js';

describe('availability enforcement', () => {
  it('prevents planned tools from executing', async () => {
    const plannedRegistry = [{ ...toolRegistry.find((tool) => tool.id === 'source_route')!, availability: 'planned' as const }];
    const handler = async () => { throw new Error('must not execute'); };
    await expect(executeTool('source_route', {}, 'test', [{ id: 'source_route', handler }], plannedRegistry)).rejects.toBeInstanceOf(ToolUnavailableError);
  });

  it('fails closed for an available canonical tool without a handler', async () => {
    await expect(executeTool('source_route', {}, 'test', [])).rejects.toThrow('no registered runtime handler');
  });

  it('does not execute a registered handler for a planned tool', async () => {
    const plannedRegistry = [{ ...toolRegistry.find((tool) => tool.id === 'source_route')!, availability: 'planned' as const }];
    let called = false;
    await expect(executeTool('source_route', {}, 'test', [{ id: 'source_route', handler: async () => { called = true; return {} as never; } }], plannedRegistry)).rejects.toBeInstanceOf(ToolUnavailableError);
    expect(called).toBe(false);
  });

  it('rejects handler IDs absent from the canonical registry and checks availability drift', () => {
    expect(() => validateRuntimeHandlers([{ id: 'unknown_tool', handler: async () => ({}) as never }])).toThrow('not a canonical tool');
    const available = toolRegistry.filter((tool) => tool.availability === 'available');
    expect(() => validateRuntimeHandlers([{ id: 'stop_search', handler: async () => ({}) as never }], available.filter((tool) => tool.id !== 'stop_search'))).toThrow('not a canonical tool');
    expect(() => validateRuntimeHandlers([{ id: 'source_route', handler: async () => ({}) as never }], available)).not.toThrow();
  });
});
