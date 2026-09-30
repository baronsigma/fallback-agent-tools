import { describe, expect, it } from 'vitest';
import { executeTool } from '../../src/core/executor.js';
import { ToolUnavailableError } from '../../src/core/errors.js';

describe('availability enforcement', () => {
  it('prevents planned tools from executing', async () => {
    const handler = async () => { throw new Error('must not execute'); };
    await expect(executeTool('source_route', handler)).rejects.toBeInstanceOf(ToolUnavailableError);
  });
});
