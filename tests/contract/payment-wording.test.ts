import { describe, expect, it } from 'vitest';
import { getLlmsText, x402PriceSuffix, paymentModeSummary } from '../../src/surfaces/http/app.js';

describe('public payment wording', () => {
  it('labels test mode as Base Sepolia testnet, never as active billing', () => {
    const text = getLlmsText('https://fallback.test', false, { paymentMode: 'test', paymentConfigured: true } as never);
    expect(text).toContain('eip155:84532');
    expect(text).toContain('Base Sepolia testnet');
    expect(text).toContain('(x402 testnet)');
    expect(text).not.toContain('(x402 active)');
    expect(text).toContain('## When to use');
    expect(text).toContain('## Related');
  });
  it('keeps production and disabled wording distinct', () => {
    expect(x402PriceSuffix({ paymentMode: 'production', paymentConfigured: true }, true)).toBe(' (x402 active)');
    expect(x402PriceSuffix({ paymentMode: 'disabled', paymentConfigured: false }, true)).toBe(' (x402 inactive)');
    expect(paymentModeSummary('disabled')).toBe('disabled');
  });
});
