import { describe, expect, it } from 'vitest';
import { TavilySearchProvider } from '../../src/tools/source-route/search-provider.js';

describe('Tavily Search provider adapter', () => {
  it('uses the basic Search endpoint and maps normalized result fields', async () => {
    let request: RequestInit | undefined;
    const provider = new TavilySearchProvider('secret-placeholder', async (_input, init) => {
      request = init;
      return new Response(JSON.stringify({ results: [{ url: 'https://data.example/api', title: 'API', content: 'Official API docs', score: 0.91 }] }));
    });
    const results = await provider.search('dataset', { timeoutMs: 1000, preferredDomains: ['data.example'] });
    expect(request?.method).toBe('POST');
    expect(new Headers(request?.headers).get('authorization')).toBe('Bearer secret-placeholder');
    expect(JSON.parse(String(request?.body))).toMatchObject({ search_depth: 'basic', max_results: 10, include_answer: false, include_raw_content: false, include_domains: ['data.example'], include_domains_mode: 'prefer' });
    expect(results).toEqual([{ url: 'https://data.example/api', title: 'API', description: 'Official API docs', providerScore: 0.91 }]);
  });

  it('uses restricted publisher domains when required', async () => {
    let body = '';
    const provider = new TavilySearchProvider('key', async (_input, init) => { body = String(init?.body); return new Response('{"results":[]}'); });
    await provider.search('x', { timeoutMs: 1000, restrictDomains: ['sec.gov'] });
    expect(JSON.parse(body)).toMatchObject({ include_domains: ['sec.gov'], include_domains_mode: 'restrict' });
  });

  it('accepts empty results and ignores malformed entries', async () => {
    const provider = new TavilySearchProvider('key', async () => new Response('{"results":[]}'));
    expect(await provider.search('x', { timeoutMs: 1000 })).toEqual([]);
  });

  it('rejects malformed JSON, missing results, HTTP failures, timeouts and oversized bodies safely', async () => {
    await expect(new TavilySearchProvider('secret', async () => new Response('{')).search('x', { timeoutMs: 1000 })).rejects.toThrow('malformed JSON');
    await expect(new TavilySearchProvider('secret', async () => new Response('{}')).search('x', { timeoutMs: 1000 })).rejects.toThrow('missing results');
    await expect(new TavilySearchProvider('secret', async () => new Response('unauthorized', { status: 401 })).search('x', { timeoutMs: 1000 })).rejects.toThrow('HTTP 401');
    await expect(new TavilySearchProvider('secret', async (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))).search('x', { timeoutMs: 5 })).rejects.toThrow();
    const huge = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1_048_577)); controller.close(); } });
    await expect(new TavilySearchProvider('secret', async () => new Response(huge)).search('x', { timeoutMs: 1000 })).rejects.toThrow('size limit');
  });

  it('caps mapped results at ten', async () => {
    const results = Array.from({ length: 12 }, (_, index) => ({ url: `https://data.example/${index}`, title: `${index}`, content: 'result' }));
    const provider = new TavilySearchProvider('key', async () => new Response(JSON.stringify({ results })));
    expect(await provider.search('x', { timeoutMs: 1000 })).toHaveLength(10);
  });
});
