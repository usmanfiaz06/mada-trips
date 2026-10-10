import { describe, expect, it } from 'vitest';
import { ROUTES, addDays, todayIn } from '@mada/shared';
import type { Wire } from '../../src/lib/api';
import { mockTransport } from '../../src/lib/mock-api';

/* Mock mode: a flight booked through the booking mock shows up in Trips (and so on Today) once the desk confirms it. */

type J = Record<string, any>;

describe('mock booking → trips', () => {
  it('a confirmed booking becomes a trip with its charges', async () => {
    const call = async (w: Wire) => (await mockTransport(w)).json as J;
    await call({ method: 'POST', path: ROUTES.otpStart, body: { phone: '0500004127' } });
    const signed = await call({ method: 'POST', path: ROUTES.otpVerify, body: { phone: '0500004127', code: '123456' } });
    const token = signed.tokens.accessToken as string;
    const as = (method: Wire['method'], path: string, body?: unknown) => call({ method, path, body, token });

    const before = (await as('GET', '/trips')).upcoming as J[];
    const people = (await as('GET', ROUTES.people)).people as J[];
    const self = people.find((p) => p.isSelf)!;
    const depart = addDays(todayIn(), 40);
    const search = await as('POST', '/search/flights', { from: 'RUH', destination: 'dubai', depart, return: addDays(depart, 4), travellerIds: [self.id] });
    expect(search.options.length).toBeGreaterThan(0);
    const draft = { kind: 'trip', flightOfferId: search.options[0].id, travellerIds: [self.id] };
    const preview = (await as('POST', '/orders/preview', { draft, useCredit: false })).preview;
    const cards = (await as('GET', '/cards')).cards as J[];
    const created = await as('POST', '/orders', { draft, useCredit: false, payment: { method: 'card', cardId: cards[cards.length - 1]!.id }, plan: 'full', expectedTotal: preview.total.amount, idempotencyKey: `test-${Date.now()}` });
    expect(created.outcome).toBe('created');

    let order = created.order as J;
    for (let i = 0; i < 40 && order.status !== 'confirmed'; i++) {
      await new Promise((r) => setTimeout(r, 300));
      order = (await as('GET', `/orders/${order.id}`)).order;
    }
    expect(order.status).toBe('confirmed');
    expect(order.tripId).toBeTruthy();

    const list = await as('GET', '/trips');
    const after = list.upcoming as J[];
    expect(after.length).toBe(before.length + 1);
    // The soonest trip is the one Today is about.
    expect(list.currentId).toBe(order.tripId);
    const card = after.find((t) => t.id === order.tripId)!;
    expect(card.city).toBe('Dubai');
    const trip = (await as('GET', `/trips/${order.tripId}`)).trip as J;
    expect(trip.bookingRef).toBe(order.ref);
    expect(trip.segments.map((s: J) => s.direction)).toEqual(['out', 'back']);
    const pays = (await as('GET', `/trips/${order.tripId}/payments`)).payments as J[];
    expect(pays.reduce((a, p) => a + p.amount.amount, 0)).toBe(order.total.amount + order.creditUsed.amount);
  }, 30_000);
});
