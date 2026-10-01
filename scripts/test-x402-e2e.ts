import { x402Client } from '@x402/core/client';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { toolRegistry } from '../src/core/registry.js';

const baseUrl = process.env['X402_E2E_BASE_URL']?.trim();
const privateKey = process.env['X402_E2E_PRIVATE_KEY']?.trim();
const network = process.env['X402_E2E_NETWORK']?.trim();
if (!baseUrl || !privateKey || !network) throw new Error('Set X402_E2E_BASE_URL, X402_E2E_PRIVATE_KEY, and X402_E2E_NETWORK for the manual test payment run.');
if (network !== 'eip155:84532') throw new Error('The E2E payment script only accepts Base Sepolia (eip155:84532).');
const parsedBase = new URL(baseUrl);
if (parsedBase.protocol !== 'https:' || parsedBase.username || parsedBase.password || parsedBase.pathname !== '/' || parsedBase.search || parsedBase.hash) throw new Error('X402_E2E_BASE_URL must be an HTTPS origin without credentials, path, query, or fragment.');
const sourceRoute = toolRegistry.find((tool) => tool.id === 'source_route' && tool.availability === 'available');
if (!sourceRoute) throw new Error('source_route is not available in the canonical registry.');
const endpoint = `${parsedBase.origin}${sourceRoute.httpRoute}`;
const body = JSON.stringify({ goal: 'Find the World Bank indicators API and population data', domain: 'data.worldbank.org', max_candidates: 3 });

const unpaid = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body,
  signal: AbortSignal.timeout(20000),
});
if (unpaid.status !== 402) throw new Error(`Expected an x402 402 response, received HTTP ${unpaid.status}.`);
const challengeHeader = unpaid.headers.get('payment-required');
if (!challengeHeader) throw new Error('The 402 response did not include the x402 PAYMENT-REQUIRED header.');
const challenge = decodePaymentRequiredHeader(challengeHeader);
if (challenge.x402Version !== 2 || !challenge.accepts.some((accept) => accept.network === network)) throw new Error('The endpoint returned no compatible x402 V2 Base Sepolia requirement.');

const account = privateKeyToAccount(privateKey as Hex);
const paymentClient = new x402Client().register(network, new ExactEvmScheme(account));
const fetchWithPayment = wrapFetchWithPayment(fetch, paymentClient);
const paid = await fetchWithPayment(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body,
  signal: AbortSignal.timeout(45000),
});
if (!paid.ok) throw new Error(`Paid source_route request returned HTTP ${paid.status}.`);
const response = await paid.json() as { success?: boolean; toolId?: string; requestId?: string };
if (!response.success || response.toolId !== 'source_route' || !response.requestId) throw new Error('Paid response was not a successful source_route execution envelope.');
const paymentResponseHeader = paid.headers.get('payment-response');
if (!paymentResponseHeader) throw new Error('Paid response did not include the x402 PAYMENT-RESPONSE header.');
const settlement = decodePaymentResponseHeader(paymentResponseHeader);
if (!settlement.success || settlement.network !== network || !settlement.transaction) throw new Error('The x402 payment settlement response was incomplete.');
process.stdout.write(`${JSON.stringify({ status: 'paid_call_succeeded', toolId: response.toolId, requestId: response.requestId, network: settlement.network, transaction: settlement.transaction, payer: settlement.payer ?? account.address })}\n`);
