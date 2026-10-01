import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/core/config.js';

const validPaidTest = {
  NODE_ENV: 'test',
  PAYMENT_MODE: 'test',
  X402_PAY_TO: `0x${'12'.repeat(20)}`,
  X402_NETWORK: 'eip155:84532',
  X402_FACILITATOR_URL: 'https://facilitator.test.example/v2',
  X402_FACILITATOR_AUTHORIZATION: 'Bearer not-a-real-token',
};

describe('runtime configuration', () => {
  it('allows disabled mode without payment settings and provides a test-only URL', () => {
    const config = loadConfig({ NODE_ENV: 'test' });
    expect(config.paymentMode).toBe('disabled');
    expect(config.paymentConfigured).toBe(false);
    expect(config.publicBaseUrl).toBe('https://fallback.test');
  });

  it('fails closed when paid-mode settings are incomplete or use the wrong CAIP network', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', PAYMENT_MODE: 'test' })).toThrow(/X402_PAY_TO/);
    expect(() => loadConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://fallback.org', PAYMENT_MODE: 'production' })).toThrow(/X402_PAY_TO/);
    expect(() => loadConfig({ ...validPaidTest, X402_NETWORK: 'eip155:8453' })).toThrow(/requires X402_NETWORK=eip155:84532/);
    expect(() => loadConfig({ ...validPaidTest, X402_FACILITATOR_URL: 'http://facilitator.test/v2' })).toThrow(/HTTPS/);
  });

  it('rejects production placeholders and missing public base URLs', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', PAYMENT_MODE: 'disabled' })).toThrow(/PUBLIC_BASE_URL is required/);
    expect(() => loadConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://fallback.org' })).toThrow(/PAYMENT_MODE must be set explicitly/);
    expect(() => loadConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://fallback.example', PAYMENT_MODE: 'disabled' })).toThrow(/real HTTPS hostname/);
    expect(() => loadConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://fallback.org', PAYMENT_MODE: 'disabled' })).toThrow(/real HTTPS hostname/);
  });

  it('keeps payment secrets out of public configuration properties', () => {
    const config = loadConfig(validPaidTest);
    expect(config.x402.facilitatorAuthorization).toBe(validPaidTest.X402_FACILITATOR_AUTHORIZATION);
    expect(JSON.stringify({ mode: config.paymentMode, configured: config.paymentConfigured, network: config.x402.network })).not.toContain('not-a-real-token');
  });
});
