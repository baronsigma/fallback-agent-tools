import { isIP } from 'node:net';

export type AppConfig = {
  publicBaseUrl: string;
  port: number;
  environment: 'development' | 'test' | 'production';
  searchProvider: 'tavily' | 'brave' | 'none';
  paymentMode: 'disabled' | 'test' | 'production';
  paymentConfigured: boolean;
  rateLimit: { windowMs: number; maxRequests: number };
  trustProxyHops: number;
  x402: { payTo?: string; network?: string; facilitatorUrl?: string; facilitatorAuthorization?: string };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const environment = env['NODE_ENV'] ?? 'development';
  if (!['development', 'test', 'production'].includes(environment)) throw new Error('NODE_ENV is invalid.');
  const publicBaseUrl = env['PUBLIC_BASE_URL']?.trim() || (environment === 'test' ? 'https://fallback.test' : environment === 'development' ? 'http://localhost:3000' : '');
  if (!publicBaseUrl) throw new Error('PUBLIC_BASE_URL is required in production.');
  let parsedUrl: URL;
  try { parsedUrl = new URL(publicBaseUrl); } catch { throw new Error('PUBLIC_BASE_URL must be an absolute HTTP or HTTPS origin.'); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password || parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) throw new Error('PUBLIC_BASE_URL must be a clean HTTP or HTTPS origin without credentials, path, query, or fragment.');
  if (environment === 'production' && (parsedUrl.protocol !== 'https:' || /(^|\.)(example|test|localhost|invalid)$/i.test(parsedUrl.hostname) || parsedUrl.hostname === 'example.com' || parsedUrl.hostname.startsWith('example.') || isIP(parsedUrl.hostname) || !parsedUrl.hostname.includes('.'))) throw new Error('Production PUBLIC_BASE_URL must be a real HTTPS hostname, not a placeholder.');
  const port = Number(env['PORT'] ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  const searchProvider = env['SEARCH_PROVIDER']?.trim().toLowerCase();
  if (searchProvider && !['tavily', 'brave', 'none'].includes(searchProvider)) throw new Error('SEARCH_PROVIDER must be one of: tavily, brave, none.');
  const configuredSearchProvider = searchProvider ?? (env['TAVILY_API_KEY']?.trim() ? 'tavily' : env['BRAVE_SEARCH_API_KEY']?.trim() ? 'brave' : 'none');
  if (configuredSearchProvider === 'tavily' && !env['TAVILY_API_KEY']?.trim()) throw new Error('SEARCH_PROVIDER=tavily requires TAVILY_API_KEY.');
  if (configuredSearchProvider === 'brave' && !env['BRAVE_SEARCH_API_KEY']?.trim()) throw new Error('SEARCH_PROVIDER=brave requires BRAVE_SEARCH_API_KEY.');
  if (environment === 'production' && !env['PAYMENT_MODE']?.trim()) throw new Error('PAYMENT_MODE must be set explicitly in production.');
  const paymentMode = (env['PAYMENT_MODE']?.trim().toLowerCase() || 'disabled');
  if (!['disabled', 'test', 'production'].includes(paymentMode)) throw new Error('PAYMENT_MODE must be disabled, test, or production.');
  const payTo = env['X402_PAY_TO']?.trim();
  const network = env['X402_NETWORK']?.trim();
  const facilitatorUrl = env['X402_FACILITATOR_URL']?.trim();
  const facilitatorAuthorization = env['X402_FACILITATOR_AUTHORIZATION']?.trim();
  if (paymentMode !== 'disabled') {
    if (!payTo || !/^0x[a-fA-F0-9]{40}$/.test(payTo) || /^0x0{40}$/i.test(payTo)) throw new Error('Paid mode requires X402_PAY_TO to be a non-zero EVM receiving address.');
    if (!network) throw new Error('Paid mode requires X402_NETWORK.');
    const requiredNetwork = paymentMode === 'test' ? 'eip155:84532' : 'eip155:8453';
    if (network !== requiredNetwork) throw new Error(`PAYMENT_MODE=${paymentMode} requires X402_NETWORK=${requiredNetwork}.`);
    if (!facilitatorUrl) throw new Error('Paid mode requires X402_FACILITATOR_URL.');
    let parsedFacilitatorUrl: URL;
    try { parsedFacilitatorUrl = new URL(facilitatorUrl); } catch { throw new Error('X402_FACILITATOR_URL must be an absolute HTTPS URL.'); }
    if (parsedFacilitatorUrl.protocol !== 'https:' || parsedFacilitatorUrl.username || parsedFacilitatorUrl.password) throw new Error('X402_FACILITATOR_URL must use HTTPS and contain no credentials.');
    if (paymentMode === 'production' && environment !== 'production') throw new Error('PAYMENT_MODE=production requires NODE_ENV=production.');
  }
  const windowMs = Number(env['RATE_LIMIT_WINDOW_MS'] ?? '60000');
  const maxRequests = Number(env['RATE_LIMIT_MAX_REQUESTS'] ?? '30');
  const trustProxyHops = Number(env['TRUST_PROXY_HOPS'] ?? '0');
  if (!Number.isInteger(windowMs) || windowMs < 1000 || windowMs > 3600000) throw new Error('RATE_LIMIT_WINDOW_MS must be between 1000 and 3600000.');
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 10000) throw new Error('RATE_LIMIT_MAX_REQUESTS must be between 1 and 10000.');
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 5.');
  return {
    publicBaseUrl: parsedUrl.origin,
    port,
    environment: environment as AppConfig['environment'],
    searchProvider: configuredSearchProvider as AppConfig['searchProvider'],
    paymentMode: paymentMode as AppConfig['paymentMode'],
    paymentConfigured: paymentMode !== 'disabled',
    rateLimit: { windowMs, maxRequests },
    trustProxyHops,
    x402: {
      ...(payTo ? { payTo } : {}),
      ...(network ? { network } : {}),
      ...(facilitatorUrl ? { facilitatorUrl } : {}),
      ...(facilitatorAuthorization ? { facilitatorAuthorization } : {}),
    },
  };
}
