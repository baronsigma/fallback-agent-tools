import { createHttpApp } from './surfaces/http/app.js';
import { loadConfig } from './core/config.js';
import { toolRegistry, validateRegistry } from './core/registry.js';
import { createX402PaymentIntegration } from './surfaces/x402/payment.js';

const config = loadConfig();
validateRegistry();
const payment = await createX402PaymentIntegration(config, toolRegistry);
const app = createHttpApp(config, payment ? { payment } : {});
// Keep the service private to the host. Public traffic is admitted only through
// an explicitly configured reverse proxy or tunnel route.
const server = app.listen(config.port, '127.0.0.1', () => process.stdout.write(`Fallback listening on 127.0.0.1:${config.port}\n`));

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  process.stdout.write(`Fallback shutting down (${signal}).\n`);
  const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
  const closeMcp = app.locals['mcpClose'];
  if (typeof closeMcp === 'function') await closeMcp();
  await serverClosed;
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
