import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES, addDays, normalizeContactPhone, todayIn } from '@mada/shared';
import { setTransport, type Wire } from '../../src/lib/api';
import { mockTransport } from '../../src/lib/mock-api';
import { setMockBeta } from '../../src/lib/mock/beta';
import { localDates } from '../../src/lib/mock/circles';
import { fileSize, fileUrl } from '../../src/lib/beta';
import { finishSignIn } from '../../src/lib/auth';
import { MOCK_CODE, mockAuth, resetMockAuth } from '../../src/lib/auth/mock';
import { useSession } from '../../src/lib/session';
import { setLocaleResolver } from '@mada/shared';

/*
 * The beta in mock mode, the way the app meets it: flights by request (the form's answers → fares from the desk →
 * pay → tickets → the trip), booking with a contact number when phone codes aren't live, the desk's Circles pause,
 * files from the desk, and dates worded in the reader's language.
 */

type J = Record<string, any>;
const call = async (w: Wire) => (await mockTransport(w)).json as J;
const callR = (w: Wire) => mockTransport(w);

async function demo() {
  await call({ method: 'POST', path: ROUTES.otpStart, body: { phone: '0500004127' } });
  const signed = await call({ method: 'POST', path: ROUTES.otpVerify, body: { phone: '0500004127', code: '123456' } });
  const token = signed.tokens.accessToken as string;
  return (method: Wire['method'], path: string, body?: unknown) => call({ method, path, body, token });
}

beforeEach(() => { setMockBeta({ flightsByRequest: true, bookingNeedsPhone: true, limited: false }); });
afterEach(() => { vi.useRealTimers(); setMockBeta({ flightsByRequest: false, bookingNeedsPhone: true, limited: false }); });

describe('flights by request (mock mode)', () => {
  it('GET /config carries the switches', async () => {
    let c = await call({ method: 'GET', path: '/config' });
    expect(c.features).toMatchObject({ flightsByRequest: true, bookingNeedsPhone: true });
    setMockBeta({ flightsByRequest: false, bookingNeedsPhone: false });
    c = await call({ method: 'GET', path: '/config' });
    expect(c.features).toMatchObject({ flightsByRequest: false, bookingNeedsPhone: false });
  });

  it('the form → fares → pay the second → tickets → a trip with every ticket number', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
    const as = await demo();
    const people = (await as('GET', ROUTES.people)).people as J[];
    const ids = people.filter((p) => p.relation !== 'helper').slice(0, 3).map((p) => p.id);
    const depart = addDays(todayIn(), 40);
    const sent = await as('POST', '/requests', { kind: 'flight', query: 'Istanbul', travellerIds: ids, search: { destination: 'istanbul', destinationName: null, from: 'RUH', depart, return: addDays(depart, 5), cabin: 'economy', carrier: null, flexDays: 1, bags: 'two', prefs: ['direct'] } });
    expect(sent.request.title).toMatch(/^Flights to Istanbul · /);
    expect(sent.request.summary).toBe(`Riyadh to Istanbul · ${ids.length} travellers · Economy · ±1 days · Two checked bags · Direct only`);
    vi.setSystemTime(Date.now() + 10_000);
    const r = (await as('GET', `/requests/${sent.request.id}`)).request as J;
    expect(r.status).toBe('quoted');
    expect(r.quote.flight.options).toHaveLength(2);
    const second = r.quote.flight.options[1];
    expect(second.prices).toHaveLength(ids.length);

    const draft = { kind: 'quote', requestId: r.id, optionId: second.id };
    const preview = (await as('POST', '/orders/preview', { draft, useCredit: false })).preview as J;
    expect(preview).toMatchObject({ kind: 'trip', agent: true });
    expect(preview.total.amount).toBe(second.prices.reduce((a: number, p: J) => a + p.amount.amount, 0));
    const cards = (await as('GET', '/cards')).cards as J[];
    const created = await as('POST', '/orders', { draft, useCredit: false, payment: { method: 'card', cardId: cards[0]!.id }, plan: 'full', expectedTotal: preview.total.amount, idempotencyKey: `beta-${Date.now()}` });
    expect(created.outcome).toBe('created');
    expect(created.order.seats).toEqual([]);
    expect((await as('GET', `/requests/${r.id}`)).request.status).toBe('paid');

    let order = created.order as J;
    for (let i = 0; i < 10 && order.status !== 'confirmed'; i++) { vi.setSystemTime(Date.now() + 2_000); order = (await as('GET', `/orders/${order.id}`)).order; }
    expect(order.status).toBe('confirmed');
    const trip = (await as('GET', `/trips/${order.tripId}`)).trip as J;
    expect(trip.bookingRef).toBe(order.ref);
    expect(trip.segments.map((s: J) => [s.direction, s.flightNumber, s.seats.length])).toEqual([['out', second.legs[0].flightNumber, 0], ['back', second.legs[1].flightNumber, 0]]);
    expect(trip.travellers.every((p: J) => /^065\d{10}$/.test(p.ticketNumber))).toBe(true);
    // The e-tickets arrive in the request's thread as a file that opens.
    const thread = await as('GET', `/requests/${r.id}/messages`);
    const file = (thread.messages as J[]).find((m) => m.attachment)?.attachment;
    expect(file).toMatchObject({ mime: 'application/pdf' });
    expect(fileUrl(file.url)).toMatch(/^data:application\/pdf;base64,/);
  }, 30_000);
});

describe('booking without a verified phone (mock mode)', () => {
  beforeEach(async () => {
    resetMockAuth();
    await useSession.getState().clear();
    (globalThis as { __madaDeviceId?: string }).__madaDeviceId = Math.random().toString(36).slice(2, 10);
    setTransport((w) => mockTransport(w));
  });

  it('asks for a contact number instead, Saudi or international', async () => {
    const e = `${Math.random().toString(36).slice(2)}@example.com`;
    await mockAuth.sendEmailCode(e);
    await finishSignIn(await mockAuth.verifyEmailCode(e, MOCK_CODE), 'email');
    const token = useSession.getState().tokens!.accessToken;
    const as = (method: Wire['method'], path: string, body?: unknown) => callR({ method, path, body, token });
    const people = (await (await as('GET', ROUTES.people)).json as J).people as J[];
    const search = (await as('POST', '/search/flights', { from: 'RUH', destination: 'dubai', depart: addDays(todayIn(), 30), return: null, travellerIds: [people[0]!.id] })).json as J;
    const draft = { kind: 'trip', flightOfferId: search.options[0].id, travellerIds: [people[0]!.id] };
    const preview = ((await as('POST', '/orders/preview', { draft, useCredit: false })).json as J).preview;
    const body = (extra: J = {}) => ({ draft, useCredit: false, payment: { method: 'applepay', token: 'applepay_mock_123456' }, plan: 'full', expectedTotal: preview.total.amount, idempotencyKey: `p-${Math.random()}`, ...extra });
    const refused = await as('POST', '/orders', body());
    expect([refused.status, (refused.json as J).error.code]).toEqual([403, 'PHONE_REQUIRED']);
    setMockBeta({ bookingNeedsPhone: false });
    const missing = await as('POST', '/orders', body());
    expect((missing.json as J).error).toMatchObject({ code: 'VALIDATION', message: 'Add a number to reach you first.' });
    const ok = await as('POST', '/orders', body({ contactPhone: '+44 7700 900123' }));
    expect((ok.json as J).outcome).toBe('created');
  });

  it('reads the numbers people type', () => {
    expect(normalizeContactPhone('0500004127')).toBe('+966500004127');
    expect(normalizeContactPhone('+1 (415) 555-0100')).toBe('+14155550100');
    expect(normalizeContactPhone('0123')).toBeNull();
  });
});

describe('the desk pauses Circles (mock mode)', () => {
  it('says so in GET /circles and refuses posting and messages, and lifts with it', async () => {
    await call({ method: 'POST', path: ROUTES.otpStart, body: { phone: '0500004127' } });
    const token = (await call({ method: 'POST', path: ROUTES.otpVerify, body: { phone: '0500004127', code: '123456' } })).tokens.accessToken as string;
    setMockBeta({ limited: true });
    expect((await call({ method: 'GET', path: '/circles', token })).limited).toBe(true);
    const r = await callR({ method: 'POST', path: '/circles', body: { name: 'Eid' }, token });
    expect(r.status).toBe(403);
    expect((r.json as J).error).toMatchObject({ code: 'ACCOUNT_LIMITED', message: 'Posting and messages in Circles are paused on your account. Talk to Mada if this looks wrong.' });
    setMockBeta({ limited: false });
    expect((await call({ method: 'GET', path: '/circles', token })).limited).toBe(false);
    expect((await callR({ method: 'POST', path: '/circles', body: { name: 'Eid' }, token })).status).toBe(201);
  });
});

describe('files and dates', () => {
  it('joins a signed file link to the Core API, and passes data: and https: links through', () => {
    expect(fileUrl('/files/desk/abc?exp=1&sig=x')).toMatch(/\/api\/app\/v1\/files\/desk\/abc\?exp=1&sig=x$/);
    expect(fileUrl('https://example.com/a.pdf')).toBe('https://example.com/a.pdf');
    expect(fileUrl(null)).toBeNull();
    expect(fileSize(1_234_567)).toBe('1.2 MB');
    expect(fileSize(340_000)).toBe('340 KB');
  });

  it('words the demo world\'s dates in the reader\'s language', () => {
    expect(localDates('Istanbul · 10–14 Mar')).toBe('Istanbul · 10–14 Mar');
    setLocaleResolver(() => 'ar');
    try {
      const ar = localDates('Istanbul · 10–14 Mar');
      expect(ar).not.toMatch(/Mar/);
      expect(ar).toMatch(/مارس/);
    } finally { setLocaleResolver(null); }
  });
});
