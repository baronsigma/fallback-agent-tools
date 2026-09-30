import { z } from 'zod';

export const sourceRouteInputSchema = z.object({}).strict();
export const sourceRouteOutputSchema = z.object({ status: z.string() }).passthrough();
export type SourceRouteInput = z.infer<typeof sourceRouteInputSchema>;
export type SourceRouteOutput = z.infer<typeof sourceRouteOutputSchema>;
