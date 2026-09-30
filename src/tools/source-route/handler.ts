import type { ToolHandler } from '../../core/tool.js';
import { sourceRouteInputSchema, sourceRouteOutputSchema } from './contract.js';

// Reserved for the future admitted implementation. It intentionally performs no work.
export const handleSourceRoute: ToolHandler<typeof sourceRouteInputSchema, typeof sourceRouteOutputSchema> = async () => {
  throw new Error('source_route is planned and unavailable.');
};
