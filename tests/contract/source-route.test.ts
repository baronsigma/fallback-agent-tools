import { describe, expect, it } from 'vitest';
import { parseSourceRouteInput } from '../../src/tools/source-route/contract.js';

describe('source_route contract', () => {
  it('accepts minimal and domain requests with bounded defaults', () => {
    expect(parseSourceRouteInput({ goal: 'Find an official dataset' })).toMatchObject({ max_candidates: 5, require_official: false });
    expect(parseSourceRouteInput({ goal: 'Find a documented API', domain: 'EXAMPLE.org' }).domain).toBe('example.org');
  });

  it.each(['ftp://example.org', 'file:///etc/passwd', 'javascript:alert(1)', 'localhost', '127.0.0.1', 'example.org/path', 'user@example.org'])('rejects unsafe or malformed domain %s', (domain) => {
    expect(() => parseSourceRouteInput({ goal: 'Find a data route', domain })).toThrow();
  });

  it('rejects oversized goals, excessive candidate limits, and unsupported formats', () => {
    expect(() => parseSourceRouteInput({ goal: 'x'.repeat(501) })).toThrow();
    expect(() => parseSourceRouteInput({ goal: 'Find data', max_candidates: 11 })).toThrow();
    expect(() => parseSourceRouteInput({ goal: 'Find data', preferred_formats: ['yaml'] })).toThrow();
  });

  it('defaults max_candidates and caps it at ten', () => {
    expect(parseSourceRouteInput({ goal: 'Find data', max_candidates: 10 }).max_candidates).toBe(10);
    expect(() => parseSourceRouteInput({ goal: 'Find data', max_candidates: 0 })).toThrow();
  });
});
