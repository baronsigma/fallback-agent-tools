import type { ToolHandler } from '../../core/tool.js';
import { stopSearchInputSchema, stopSearchOutputSchema } from './contract.js';

// Reserved for the future admitted implementation. It intentionally performs no work.
export const handleStopSearch: ToolHandler<typeof stopSearchInputSchema, typeof stopSearchOutputSchema> = async () => {
  throw new Error('stop_search is planned and unavailable.');
};
