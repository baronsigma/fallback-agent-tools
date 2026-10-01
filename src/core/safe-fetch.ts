import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';

export const NETWORK_LIMITS = {
  maxHttpRequests: 8,
  maxRedirects: 3,
  requestTimeoutMs: 5_000,
  totalTimeoutMs: 12_000,
  maxResponseBytes: 1_048_576,
  maxRoutes: 10,
} as const;

export type SafeFetchResult = {
  url: string;
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
};

export type SafeFetcher = {
  fetch(url: string, onRequest: (url: string) => void, timeoutMs?: number): Promise<SafeFetchResult>;
};
export type ResolvedAddress = { address: string; family: number };
export type SafeFetchRuntime = {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  request?: (url: URL, pinnedAddress: string | undefined, timeoutMs: number) => Promise<SafeFetchResult>;
};

function ipv4Number(value: string): number {
  return value.split('.').reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0);
}

function ipv4Blocked(address: string): boolean {
  const n = ipv4Number(address);
  const ranges: Array<[number, number]> = [
    [ipv4Number('0.0.0.0'), 8], [ipv4Number('10.0.0.0'), 8], [ipv4Number('100.64.0.0'), 10],
    [ipv4Number('127.0.0.0'), 8], [ipv4Number('169.254.0.0'), 16], [ipv4Number('172.16.0.0'), 12],
    [ipv4Number('192.0.0.0'), 24], [ipv4Number('192.0.2.0'), 24], [ipv4Number('192.88.99.0'), 24],
    [ipv4Number('192.168.0.0'), 16], [ipv4Number('198.18.0.0'), 15], [ipv4Number('198.51.100.0'), 24],
    [ipv4Number('203.0.113.0'), 24], [ipv4Number('224.0.0.0'), 4], [ipv4Number('240.0.0.0'), 4],
  ];
  return ranges.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
}

function ipv6Words(address: string): number[] {
  let normalized = address.toLowerCase().split('%')[0] ?? address;
  const embeddedV4 = normalized.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (embeddedV4) {
    const octets = embeddedV4.slice(1).map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) return [];
    const first = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const second = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    normalized = normalized.replace(/\d+\.\d+\.\d+\.\d+$/, `${first.toString(16)}:${second.toString(16)}`);
  }
  const halves = normalized.split('::');
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const words = [...left.map((x) => parseInt(x, 16)), ...Array(Math.max(0, 8 - left.length - right.length)).fill(0), ...right.map((x) => parseInt(x, 16))];
  return words.length === 8 ? words : [];
}

function ipv6Blocked(address: string): boolean {
  const words = ipv6Words(address);
  if (words.length !== 8) return true;
  const [a = 0, b = 0, c = 0] = words;
  const allZero = words.every((word) => word === 0);
  const loopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  const mappedV4 = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (mappedV4) return ipv4Blocked(`${(words[6] ?? 0) >> 8}.${(words[6] ?? 0) & 255}.${(words[7] ?? 0) >> 8}.${(words[7] ?? 0) & 255}`);
  return allZero || loopback || (a & 0xfe00) === 0xfc00 || (a & 0xffc0) === 0xfe80 || (a & 0xff00) === 0xff00
    || (a === 0x2001 && b === 0x0db8) || (a === 0x2001 && b === 0x0000) || (a === 0x2002)
    || (a === 0x0064 && b === 0xff9b && (c === 0 || c === 1)) || (a === 0x2001 && (b & 0xfff0) === 0x0010)
    || (a === 0x2001 && (b & 0xfff0) === 0x0020) || (c === 0 && a === 0x2001 && b === 0x0002)
    || (a & 0xffc0) === 0xfec0 || (words.slice(0, 6).every((word) => word === 0) && ipv4Blocked(`${(words[6] ?? 0) >> 8}.${(words[6] ?? 0) & 255}.${(words[7] ?? 0) >> 8}.${(words[7] ?? 0) & 255}`));
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return ipv4Blocked(address);
  if (family === 6) return ipv6Blocked(address);
  return true;
}

async function validateWithResolver(value: string, resolveHost: (hostname: string) => Promise<ResolvedAddress[]>): Promise<URL> {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Malformed URL.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP and HTTPS URLs are allowed.');
  if (url.username || url.password) throw new Error('URL credentials are not allowed.');
  if ([...url.searchParams.keys()].some((key) => /^(?:api[_-]?key|access[_-]?token|token|secret|signature|sig|auth|password|credential|access[_-]?key|client[_-]?secret|key)$/i.test(key))) throw new Error('Credential-like query parameters are not allowed.');
  if (url.port && !((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443'))) throw new Error('Non-standard ports are not allowed.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Local hostnames are not allowed.');
  }
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new Error('Private or reserved IP addresses are not allowed.');
    return url;
  }
  let records: ResolvedAddress[];
  try { records = await resolveHost(hostname); }
  catch { throw new Error('Hostname did not resolve to a public address.'); }
  if (!records.length || records.some((record) => isBlockedAddress(record.address))) throw new Error('Hostname resolves to a private or reserved address.');
  return url;
}

function timed<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

const systemResolve = async (hostname: string): Promise<ResolvedAddress[]> => lookup(hostname, { all: true, verbatim: true });

export function validatePublicHttpUrl(value: string): Promise<URL> {
  return validateWithResolver(value, systemResolve);
}

function requestOnce(url: URL, pinnedAddress: string | undefined, timeoutMs: number): Promise<SafeFetchResult> {
  return new Promise((resolve, reject) => {
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = requestFn(url, {
      method: 'GET',
      headers: { 'user-agent': 'Fallback-source-route/0.1 (+https://github.com/baronsigma/fallback-agent-tools)', accept: 'text/html,application/json,application/xml,text/plain,*/*;q=0.5' },
      ...(pinnedAddress ? { lookup: (_hostname: string, options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string | ResolvedAddress[], family?: number) => void) => {
        const family = isIP(pinnedAddress);
        const all = typeof options === 'object' && options !== null && 'all' in options && options.all === true;
        if (all) callback(null, [{ address: pinnedAddress, family }]);
        else callback(null, pinnedAddress, family);
      } } : {}),
      ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > NETWORK_LIMITS.maxResponseBytes) {
          request.destroy(new Error('Response exceeded the 1 MB limit.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        clearTimeout(hardTimer);
        resolve({ url: url.toString(), status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') });
      });
      response.on('error', fail);
    });
    const fail = (error: Error) => { clearTimeout(hardTimer); reject(error); };
    const hardTimer = setTimeout(() => request.destroy(new Error('Outbound request timed out.')), timeoutMs);
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Outbound request timed out.')));
    request.on('error', fail);
    request.end();
  });
}

export function createSafeFetcher(runtime: SafeFetchRuntime = {}): SafeFetcher {
  const resolveHost = runtime.resolve ?? systemResolve;
  const request = runtime.request ?? requestOnce;
  return {
  async fetch(input, onRequest, timeoutMs = NETWORK_LIMITS.requestTimeoutMs) {
    const fetchStarted = Date.now();
    const resolveTimed = (hostname: string) => timed(resolveHost(hostname), Math.max(1, Math.min(NETWORK_LIMITS.requestTimeoutMs, timeoutMs - (Date.now() - fetchStarted))), 'DNS resolution');
    let current = input;
    for (let redirect = 0; redirect <= NETWORK_LIMITS.maxRedirects; redirect += 1) {
      const url = await validateWithResolver(current, resolveTimed);
      onRequest(url.toString());
      let pinnedAddress: string | undefined;
      if (!isIP(url.hostname)) {
        const records = await resolveTimed(url.hostname);
        const publicRecord = records.find((record) => !isBlockedAddress(record.address));
        if (!publicRecord || records.some((record) => isBlockedAddress(record.address))) throw new Error('Hostname resolves to a private or reserved address.');
        pinnedAddress = publicRecord.address;
      }
      const remaining = Math.min(timeoutMs - (Date.now() - fetchStarted), NETWORK_LIMITS.requestTimeoutMs);
      if (remaining <= 0) throw new Error('Outbound request timed out.');
      const response = await request(url, pinnedAddress, remaining);
      const location = response.headers.location;
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response;
      if (redirect === NETWORK_LIMITS.maxRedirects) throw new Error('Redirect limit exceeded.');
      current = new URL(location, url).toString();
    }
    throw new Error('Redirect limit exceeded.');
  },
  };
}

export const safeFetcher = createSafeFetcher();
