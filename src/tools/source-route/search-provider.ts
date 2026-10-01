export type SearchHit = { url: string; title: string; description: string; providerScore?: number };
export type SearchOptions = { timeoutMs: number; preferredDomains?: string[]; restrictDomains?: string[] };

export interface SearchProvider {
  readonly id: 'tavily' | 'brave' | 'fake';
  search(query: string, options: SearchOptions): Promise<SearchHit[]>;
}

async function readBoundedBody(response: Response, maxBytes: number, provider: string): Promise<string> {
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
      throw new Error(`${provider} Search response exceeded the size limit.`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

function mappedHits(value: unknown, provider: string, resultField: string, descriptionField: string): SearchHit[] {
  if (!value || typeof value !== 'object') throw new Error(`${provider} Search returned malformed JSON.`);
  const rows = (value as Record<string, unknown>)[resultField];
    if (!Array.isArray(rows)) throw new Error(`${provider} Search response is missing ${provider === 'Brave' ? 'web ' : ''}results.`);
  return rows.flatMap((entry): SearchHit[] => {
    if (!entry || typeof entry !== 'object') return [];
    const hit = entry as Record<string, unknown>;
    if (typeof hit['url'] !== 'string' || typeof hit['title'] !== 'string' || typeof hit[descriptionField] !== 'string') return [];
    try {
      const url = new URL(hit['url']);
      if (!['http:', 'https:'].includes(url.protocol)) return [];
    } catch { return []; }
    const score = typeof hit['score'] === 'number' && Number.isFinite(hit['score']) ? Math.max(0, Math.min(1, hit['score'])) : undefined;
    return [{ url: hit['url'], title: hit['title'].slice(0, 500), description: (hit[descriptionField] as string).slice(0, 2000), ...(score !== undefined && provider === 'Tavily' ? { providerScore: score } : {}) }];
  }).slice(0, 10);
}

export class TavilySearchProvider implements SearchProvider {
  readonly id = 'tavily' as const;
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {
    if (!apiKey.trim()) throw new Error('Tavily API key is required.');
  }

  async search(query: string, options: SearchOptions): Promise<SearchHit[]> {
    const domainHints = options.restrictDomains?.length
      ? { include_domains: options.restrictDomains, include_domains_mode: 'restrict' }
      : options.preferredDomains?.length ? { include_domains: options.preferredDomains, include_domains_mode: 'prefer' } : {};
    const response = await this.fetchImpl('https://api.tavily.com/search', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, search_depth: 'basic', topic: 'general', max_results: 10, include_answer: false, include_raw_content: false, include_images: false, ...domainHints }),
      signal: AbortSignal.timeout(options.timeoutMs), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Tavily Search returned HTTP ${response.status}.`);
    const text = await readBoundedBody(response, 1_048_576, 'Tavily');
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error('Tavily Search returned malformed JSON.'); }
    return mappedHits(parsed, 'Tavily', 'results', 'content');
  }
}

export class BraveSearchProvider implements SearchProvider {
  readonly id = 'brave' as const;
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {
    if (!apiKey.trim()) throw new Error('Brave Search API key is required.');
  }

  async search(query: string, options: SearchOptions): Promise<SearchHit[]> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', '10');
    const response = await this.fetchImpl(url, {
      headers: { 'X-Subscription-Token': this.apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Brave Search returned HTTP ${response.status}.`);
    const text = await readBoundedBody(response, 1_048_576, 'Brave');
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error('Brave Search returned malformed JSON.'); }
    if (!parsed || typeof parsed !== 'object') throw new Error('Brave Search returned malformed JSON.');
    return mappedHits({ results: (parsed as { web?: { results?: unknown } }).web?.results }, 'Brave', 'results', 'description');
  }
}

export class FakeSearchProvider implements SearchProvider {
  readonly id = 'fake' as const;
  calls: string[] = [];
  constructor(private readonly hits: SearchHit[] = [], private readonly error?: Error) {}
  async search(query: string): Promise<SearchHit[]> {
    this.calls.push(query);
    if (this.error) throw this.error;
    return this.hits;
  }
}

export function configuredSearchProvider(env: NodeJS.ProcessEnv = process.env): SearchProvider | undefined {
  const selection = env['SEARCH_PROVIDER']?.trim().toLowerCase();
  if (selection && !['tavily', 'brave', 'none'].includes(selection)) throw new Error('SEARCH_PROVIDER must be one of: tavily, brave, none.');
  if (selection === 'none') return undefined;
  const tavilyKey = env['TAVILY_API_KEY']?.trim();
  const braveKey = env['BRAVE_SEARCH_API_KEY']?.trim();
  if (selection === 'tavily') {
    if (!tavilyKey) throw new Error('SEARCH_PROVIDER=tavily requires TAVILY_API_KEY.');
    return new TavilySearchProvider(tavilyKey);
  }
  if (selection === 'brave') {
    if (!braveKey) throw new Error('SEARCH_PROVIDER=brave requires BRAVE_SEARCH_API_KEY.');
    return new BraveSearchProvider(braveKey);
  }
  if (tavilyKey) return new TavilySearchProvider(tavilyKey);
  if (braveKey) return new BraveSearchProvider(braveKey);
  return undefined;
}
