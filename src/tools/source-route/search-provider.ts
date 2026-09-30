export type SearchHit = { url: string; title: string; description: string };

export interface SearchProvider {
  search(query: string, options: { timeoutMs: number }): Promise<SearchHit[]>;
}

async function readBraveBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('Brave Search response exceeded the size limit.');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

export class BraveSearchProvider implements SearchProvider {
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {
    if (!apiKey.trim()) throw new Error('Brave Search API key is required.');
  }

  async search(query: string, options: { timeoutMs: number }): Promise<SearchHit[]> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', '10');
    const response = await this.fetchImpl(url, {
      headers: { 'X-Subscription-Token': this.apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Brave Search returned HTTP ${response.status}.`);
    const text = await readBraveBody(response, 1_048_576);
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('Brave Search returned malformed JSON.');
    const web = (parsed as { web?: { results?: unknown } }).web;
    if (!Array.isArray(web?.results)) throw new Error('Brave Search response is missing web results.');
    return web.results.flatMap((entry): SearchHit[] => {
      if (!entry || typeof entry !== 'object') return [];
      const hit = entry as Record<string, unknown>;
      if (typeof hit['url'] !== 'string' || typeof hit['title'] !== 'string' || typeof hit['description'] !== 'string') return [];
      return [{ url: hit['url'], title: hit['title'], description: hit['description'] }];
    }).slice(0, 10);
  }
}

export class FakeSearchProvider implements SearchProvider {
  calls: string[] = [];
  constructor(private readonly hits: SearchHit[] = [], private readonly error?: Error) {}
  async search(query: string): Promise<SearchHit[]> {
    this.calls.push(query);
    if (this.error) throw this.error;
    return this.hits;
  }
}

export function configuredSearchProvider(env: NodeJS.ProcessEnv = process.env): SearchProvider | undefined {
  const apiKey = env['BRAVE_SEARCH_API_KEY']?.trim();
  return apiKey ? new BraveSearchProvider(apiKey) : undefined;
}
