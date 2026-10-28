import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROUTES } from '@mada/shared';
import type { Wire } from '../../src/lib/api';

/*
 * Mock mode follows the server's refund rules (APP-FINANCE.md): a clear refund within SAR 500 is approved at once (the
 * Mada Wallet credited now, with its line; the card straight to approved, then sent with the bank's reference), and
 * nothing moves the wallet to a card.
 */

type J = Record<string, any>;

/** The demo account (the Istanbul trip), on a fresh mock each time. */
async function account(phone = '0500004127') {
  vi.resetModules();
  const { mockTransport } = await import('../../src/lib/mock-api');
  const call = async (w: Wire) => (await mockTransport(w)).json as J;
  await call({ method: 'POST', path: ROUTES.otpStart, body: { phone } });
  const signed = await call({ method: 'POST', path: ROUTES.otpVerify, body: { phone, code: '123456' } });
  const token = signed.tokens.accessToken as string;
  const as = (method: Wire['method'], path: string, body?: unknown) => mockTransport({ method, path, body, token });
  const list = (await (await as('GET', '/trips')).json) as J;
  const tripId = (list.currentId ?? list.upcoming?.[0]?.id) as string;
  const pays = ((await as('GET', `/trips/${tripId}/payments`)).json as J).payments as J[];
  return { as, tripId, pays };
}
const key = () => `k-${Math.random().toString(36).slice(2, 12)}`;

afterEach(() => { vi.useRealTimers(); });

describe('mock refunds: Mada Wallet and the card', () => {
  it('credits a clear pickup refund to the Mada Wallet at once, with its line, and offers no way to move it to a card', async () => {
    const a = await account();
    const pickup = a.pays.find((p) => p.item === 'pickup')!;
    const quote = (await a.as('GET', `/trips/${a.tripId}/refunds/quote`)).json as J;
    expect(quote.autoMax.amount).toBe(500_00);
    const r = ((await a.as('POST', `/trips/${a.tripId}/refunds`, { paymentIds: [pickup.id], reason: 'plans', destination: 'credit', clientKey: key() })).json as J).refund;
    expect(r).toMatchObject({ stage: 'sent', destination: 'credit', auto: true });
    const credit = ((await a.as('GET', '/credit')).json as J).credit;
    expect(credit.entries[0]).toMatchObject({ amount: pickup.amount.amount, kind: 'refund', note: `${pickup.title}, Istanbul` });
    const move = await a.as('POST', '/credit/move', { cardId: 'x' });
    expect(move.status).toBe(404);
    const inbox = ((await a.as('GET', '/notifications')).json as J).notifications as J[];
    expect(inbox.filter((n) => n.title === 'In your Mada Wallet')).toHaveLength(1);
  });

  it('sends a clear card refund straight to approved, then to sent with the bank reference, one inbox line per step', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const a = await account();
    const pickup = a.pays.find((p) => p.item === 'pickup')!;
    const r = ((await a.as('POST', `/trips/${a.tripId}/refunds`, { paymentIds: [pickup.id], reason: 'plans', destination: 'original', clientKey: key() })).json as J).refund;
    expect(r).toMatchObject({ stage: 'approved', auto: true, reference: null });
    vi.setSystemTime(Date.now() + 7000);
    const sent = ((await a.as('GET', `/refunds/${r.id}`)).json as J).refund;
    expect(sent.stage).toBe('sent');
    expect(sent.reference).toMatch(/^7438\d{19}$/);
    const inbox = ((await a.as('GET', '/notifications')).json as J).notifications as J[];
    expect(inbox.filter((n) => n.title === 'Refund approved')).toHaveLength(1);
    expect(inbox.filter((n) => n.title === 'Refund sent' && n.body.includes(sent.reference))).toHaveLength(1);
  });
});
