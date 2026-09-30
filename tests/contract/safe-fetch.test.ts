import { describe, expect, it } from 'vitest';
import { createSafeFetcher, isBlockedAddress, validatePublicHttpUrl, type SafeFetchResult } from '../../src/core/safe-fetch.js';

describe('SSRF protections', () => {
  it.each(['127.0.0.1', '10.2.3.4', '172.16.1.2', '192.168.1.2', '169.254.10.20', '100.64.1.2', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1'])('blocks private or reserved address %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['localhost', '127.0.0.1', '10.0.0.1', '172.20.0.1', '192.168.1.1', '169.254.169.254', '[::1]', '[fc00::1]'])('rejects unsafe outbound destination %s', async (host) => {
    await expect(validatePublicHttpUrl(`https://${host}/`)).rejects.toThrow();
  });

  it('rejects unsupported protocols and credentials', async () => {
    await expect(validatePublicHttpUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(validatePublicHttpUrl('javascript:alert(1)')).rejects.toThrow();
    await expect(validatePublicHttpUrl('https://user:pass@example.com')).rejects.toThrow();
    await expect(validatePublicHttpUrl('https://example.com/?api_key=secret')).rejects.toThrow();
  });

  it('blocks redirects to loopback and rechecks DNS before connecting', async () => {
    let calls = 0;
    const fetcher = createSafeFetcher({
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      request: async (url) => ({ url: url.toString(), status: 302, headers: { location: 'http://127.0.0.1/admin' }, body: '' } satisfies SafeFetchResult),
    });
    await expect(fetcher.fetch('https://public.example/', () => { calls += 1; })).rejects.toThrow(/Private|Local/);
    expect(calls).toBe(1);

    let resolutions = 0;
    const rebinding = createSafeFetcher({
      resolve: async () => ++resolutions === 1 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '10.0.0.5', family: 4 }],
      request: async () => { throw new Error('must not connect'); },
    });
    await expect(rebinding.fetch('https://public.example/', () => undefined)).rejects.toThrow(/private or reserved/);
  });

  it('rejects a hostname if any DNS answer is private, even when another answer is public', async () => {
    const fetcher = createSafeFetcher({
      resolve: async () => [{ address: '93.184.216.34', family: 4 }, { address: '192.168.1.10', family: 4 }],
      request: async () => { throw new Error('must not connect'); },
    });
    await expect(fetcher.fetch('https://mixed.example/', () => undefined)).rejects.toThrow(/private or reserved/);
  });

  it('caps redirect chains to three hops', async () => {
    let requests = 0;
    const fetcher = createSafeFetcher({
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      request: async (url) => {
        requests += 1;
        return { url: url.toString(), status: 302, headers: { location: `/hop-${requests}` }, body: '' } satisfies SafeFetchResult;
      },
    });
    await expect(fetcher.fetch('https://public.example/start', () => undefined)).rejects.toThrow(/Redirect limit/);
    expect(requests).toBe(4);
  });
});
