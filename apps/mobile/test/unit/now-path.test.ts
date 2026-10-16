import { beforeAll, describe, expect, it } from 'vitest';
import { RIDE_MATCH_MS, ROUTES, RideResponse, SendSupportMessageResponse, SupportThreadResponse } from '@mada/shared';
import type { Wire } from '../../src/lib/api';
import { mockTransport } from '../../src/lib/mock-api';

/* Mock mode, the now path: a car right now (driver, plate, meeting point, price, cancel; none where no car is free) and urgent help. */

type J = Record<string, any>;

async function signedIn() {
  const call = async (w: Wire) => (await mockTransport(w)).json as J;
  await call({ method: 'POST', path: ROUTES.otpStart, body: { phone: '0500004127' } });
  const signed = await call({ method: 'POST', path: ROUTES.otpVerify, body: { phone: '0500004127', code: '123456' } });
  const token = signed.tokens.accessToken as string;
  return (method: Wire['method'], path: string, body?: unknown) => mockTransport({ method, path, body, token });
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// One sign-in for the file (a second code inside 30 seconds would wait).
let as: Awaited<ReturnType<typeof signedIn>>;
beforeAll(async () => { as = await signedIn(); });

describe('mock: a car right now', () => {
  it('requests, assigns a driver with everything the traveller needs, and cancels', async () => {
    const made = await as('POST', '/rides', { when: 'now', city: 'Riyadh', meetingPoint: 'At Rosewood lobby', tripId: null, clientKey: 'test-ride-0001' });
    expect(made.status).toBe(201);
    const { ride } = RideResponse.parse(made.json);
    expect(ride.status).toBe('requesting');
    // The same client key is the same car.
    expect(RideResponse.parse((await as('POST', '/rides', { when: 'now', city: 'Riyadh', meetingPoint: 'At Rosewood lobby', clientKey: 'test-ride-0001' })).json).ride.id).toBe(ride.id);
    await wait(RIDE_MATCH_MS + 100);
    const got = RideResponse.parse((await as('GET', `/rides/${ride.id}`)).json).ride;
    expect(got.status).toBe('assigned');
    expect(got.driver?.plate).toBeTruthy();
    expect(got.meetingPoint).toBe('At Rosewood lobby');
    expect(got.price?.amount).toBeGreaterThan(0);
    const off = RideResponse.parse((await as('POST', `/rides/${ride.id}/cancel`, {})).json).ride;
    expect(off.status).toBe('cancelled');
  }, 15_000);

  it('says no car is free where there is none', async () => {
    const { ride } = RideResponse.parse((await as('POST', '/rides', { when: 'in15', city: 'Abha', meetingPoint: 'Abha airport', clientKey: 'test-ride-0002' })).json);
    await wait(RIDE_MATCH_MS + 100);
    expect(RideResponse.parse((await as('GET', `/rides/${ride.id}`)).json).ride).toMatchObject({ status: 'none', driver: null });
  }, 15_000);
});

describe('mock: urgent help', () => {
  it('promises a call-back, and keeps 997 for someone hurt', async () => {
    const { thread } = SupportThreadResponse.parse((await as('POST', '/support/threads', {})).json);
    const urgent = SendSupportMessageResponse.parse((await as('POST', `/support/threads/${thread.id}/messages`, { body: '', topic: 'urgent' })).json).messages;
    const reply = urgent[urgent.length - 1]!;
    expect(reply.body).not.toMatch(/997/);
    expect(reply.card?.callback?.by ?? reply.card?.disruption).toBeTruthy();
    const hurt = SendSupportMessageResponse.parse((await as('POST', `/support/threads/${thread.id}/messages`, { body: 'Help, my son is hurt' })).json).messages;
    expect(hurt[0]!.card?.intent).toBe('emergency');
    expect(hurt[hurt.length - 1]!.body).toMatch(/997/);
  });
});
