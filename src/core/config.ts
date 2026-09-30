export type AppConfig = {
  publicBaseUrl: string;
  port: number;
  environment: 'development' | 'test' | 'production';
  x402: { payTo?: string; network: string; facilitatorUrl: string };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const publicBaseUrl = env['PUBLIC_BASE_URL'] ?? 'http://localhost:3000';
  const parsedUrl = new URL(publicBaseUrl);
  const port = Number(env['PORT'] ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  const environment = env['NODE_ENV'] ?? 'development';
  if (!['development', 'test', 'production'].includes(environment)) throw new Error('NODE_ENV is invalid.');
  const payTo = env['X402_PAY_TO']?.trim();
  return {
    publicBaseUrl: parsedUrl.origin,
    port,
    environment: environment as AppConfig['environment'],
    x402: {
      ...(payTo ? { payTo } : {}),
      network: env['X402_NETWORK'] ?? 'eip155:8453',
      facilitatorUrl: env['X402_FACILITATOR_URL'] ?? 'https://x402.org/facilitator',
    },
  };
}
