import { z } from 'zod';

export const errorRouteInputSchema = z.object({}).strict();
export const errorRouteOutputSchema = z.object({ status: z.string() }).passthrough();
export type ErrorRouteInput = z.infer<typeof errorRouteInputSchema>;
export type ErrorRouteOutput = z.infer<typeof errorRouteOutputSchema>;
