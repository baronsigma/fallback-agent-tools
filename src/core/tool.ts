import type { z } from 'zod';
import type { ToolResponse } from './response.js';

export type ToolHandler<I extends z.ZodType, O extends z.ZodType> = (
  input: z.input<I>, context: { requestId: string },
) => Promise<ToolResponse<z.output<O>>>;

export type AnyToolHandler = (input: unknown, context: { requestId: string }) => Promise<ToolResponse<unknown>>;
