import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/core/config.js';
import { configuredSearchProvider, BraveSearchProvider, TavilySearchProvider } from '../../src/tools/source-route/search-provider.js';

describe('search provider selection', () => {
  it('selects explicit providers and deterministic-only mode', () => {
    expect(configuredSearchProvider({ SEARCH_PROVIDER: 'tavily', TAVILY_API_KEY: 't-key' })).toBeInstanceOf(TavilySearchProvider);
    expect(configuredSearchProvider({ SEARCH_PROVIDER: 'brave', BRAVE_SEARCH_API_KEY: 'b-key' })).toBeInstanceOf(BraveSearchProvider);
    expect(configuredSearchProvider({ SEARCH_PROVIDER: 'none', TAVILY_API_KEY: 't-key', BRAVE_SEARCH_API_KEY: 'b-key' })).toBeUndefined();
  });

  it('prefers Tavily automatically, then Brave, then deterministic-only', () => {
    expect(configuredSearchProvider({ TAVILY_API_KEY: 't-key', BRAVE_SEARCH_API_KEY: 'b-key' })).toBeInstanceOf(TavilySearchProvider);
    expect(configuredSearchProvider({ TAVILY_API_KEY: 't-key' })).toBeInstanceOf(TavilySearchProvider);
    expect(configuredSearchProvider({ BRAVE_SEARCH_API_KEY: 'b-key' })).toBeInstanceOf(BraveSearchProvider);
    expect(configuredSearchProvider({})).toBeUndefined();
    expect(loadConfig({ NODE_ENV: 'test' }).searchProvider).toBe('none');
  });

  it('rejects invalid selection and missing explicit credentials clearly', () => {
    expect(() => configuredSearchProvider({ SEARCH_PROVIDER: 'google' })).toThrow('SEARCH_PROVIDER must be one of');
    expect(() => configuredSearchProvider({ SEARCH_PROVIDER: 'tavily' })).toThrow('requires TAVILY_API_KEY');
    expect(() => loadConfig({ SEARCH_PROVIDER: 'brave' })).toThrow('requires BRAVE_SEARCH_API_KEY');
  });
});
