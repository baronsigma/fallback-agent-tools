import { createHttpApp } from './surfaces/http/app.js';
import { loadConfig } from './core/config.js';
import { validateRegistry } from './core/registry.js';

const config = loadConfig();
validateRegistry();
createHttpApp(config).listen(config.port, () => {
  process.stdout.write(`Fallback scaffold listening on ${config.port}\n`);
});
