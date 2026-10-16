import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROUTES } from '@mada/shared';
import type { Wire } from '../../src/lib/api';
import { mockTransport } from '../../src/lib/mock-api';

/* Mock mode: every request ends in an outcome (refused, partial, cancelled) and says what Mada is doing until then. */

type J = Record<string, any>;
const call = async (w: Wire) => (await mockTransport(w)).json as J;

async function signIn() {
  await call({ method: 'POST', path: ROUTES.otpStart, body: { phone: '0500004127' } });
  const signed = await call({ method: 'POST', path: ROUTES.otpVerify, body: { phone: '0500004127', code: '123456' } });
  const token = signed.tokens.accessToken as string;
  return (method: Wire['method'], path: string, body?: unknown) => call({ method, path, body, token });
}

afterEach(() => { vi.useRealTimers(); });

describe('outcomes in mock mode', () => {
  it('a bike the airline won’t carry ends refused; connecting rooms end partial, naming the hotel', async () => {
    const as = await signIn();
    const list = await as('GET', '/trips');
    const tripId = (list.currentId ?? list.upcoming[0].id) as string;
    const trip = (await as('GET', `/trips/${tripId}`)).trip as J;
    const hotel = trip.stays[0].name as string;
    vi.useFakeTimers({ toFake: ['Date'] });
    const ask = async (b: J) => (await as('POST', `/trips/${tripId}/requests`, { ...b, clientKey: `k-${Math.random().toString(36).slice(2, 12)}` })).request as J;
    const bassinet = await ask({ area: 'special', kind: 'sports', option: 'bike' });
    const rooms = await ask({ area: 'hotel', kind: 'connecting' });
    // While open: what, by when, and the cost.
    expect(rooms.progress).toMatchObject({ step: 'asking_hotel', with: hotel, promised: false, cost: { kind: 'later' } });
    expect(rooms.result).toBeNull();
    vi.setSystemTime(Date.now() + 13_000);
    const all = (await as('GET', `/trips/${tripId}/requests`)).requests as J[];
    const b = all.find((r) => r.id === bassinet.id)!;
    const r = all.find((x) => x.id === rooms.id)!;
    expect(b.result).toMatchObject({ kind: 'refused', money: { kind: 'none' } });
    expect(b.progress).toBeNull();
    expect(r.result).toMatchObject({ kind: 'partial', reason: 'part', with: hotel, money: { kind: 'none' } });
    expect(r.result.note).toMatch(/next to each other/);
    // And the inbox says so.
    const inbox = (await as('GET', '/notifications')).items as J[];
    expect(inbox.map((n) => n.title)).toEqual(expect.arrayContaining(['Mada couldn’t get this one', 'Some of it is done']));
  }, 20_000);
});
