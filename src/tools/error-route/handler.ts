import type { ToolHandler } from '../../core/tool.js';
import { errorRouteInputSchema, errorRouteOutputSchema } from './contract.js';

// Reserved for the future admitted implementation. It intentionally performs no work.
export const handleErrorRoute: ToolHandler<typeof errorRouteInputSchema, typeof errorRouteOutputSchema> = async () => {
  throw new Error('error_route is planned and unavailable.');
};
