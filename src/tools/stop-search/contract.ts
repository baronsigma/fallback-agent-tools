import { z } from 'zod';

export const stopSearchInputSchema = z.object({}).strict();
export const stopSearchOutputSchema = z.object({ status: z.string() }).passthrough();
export type StopSearchInput = z.infer<typeof stopSearchInputSchema>;
export type StopSearchOutput = z.infer<typeof stopSearchOutputSchema>;
