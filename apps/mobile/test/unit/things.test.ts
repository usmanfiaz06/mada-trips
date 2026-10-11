import { beforeAll, describe, expect, it } from 'vitest';
import { BookThingResponse, ItineraryResponse, ROUTES, ThingsResponse, TripIdeasResponse } from '@mada/shared';
import type { Wire } from '../../src/lib/api';
import { mockTransport } from '../../src/lib/mock-api';

/* Things to do in mock mode: the same contract as the Core API (schemas parse), filters, a trip's hotel and days,
   Book with Mada as a request with its first message, and Add to my plan landing on the itinerary. */

type J = Record<string, any>;

async function signedIn() {
  const call = async (w: Wire) => mockTransport(w);
  await call({ method: 'POST', path: ROUTES.otpStart, body: { phone: '0500004127' } });
  const signed = (await call({ method: 'POST', path: ROUTES.otpVerify, body: { phone: '0500004127', code: '123456' } })).json as J;
  const token = signed.tokens.accessToken as string;
  return (method: Wire['method'], path: string, body?: unknown) => call({ method, path, body, token });
}

let as: Awaited<ReturnType<typeof signedIn>>;
beforeAll(async () => { as = await signedIn(); });

describe('things to do (mock)', () => {
  it('a city: places with hours, weather turning a hot day indoors, experiences, what\'s on', async () => {
    const r = await as('GET', '/places/108410/things');
    expect(r.status).toBe(200);
    const t = ThingsResponse.parse(r.json);
    expect(t.place.name).toBe('Riyadh');
    expect(t.activities.length).toBeGreaterThan(3);
    expect(t.weather?.mood).toBe('hot');
    expect(t.today?.why).toBe('hot');
    expect(t.today?.ids.every((id) => t.activities.find((a) => a.id === id)?.indoor !== false)).toBe(true);
    expect(t.experiences.map((e) => e.supplier)).toContain('hotelbeds');
    expect(t.events.some((e) => e.source === 'desk')).toBe(true);
    expect(t.attributions.map((a) => a.source)).toContain('openstreetmap');
    const fam = ThingsResponse.parse((await as('GET', '/places/108410/things?family=1')).json);
    expect(fam.activities.every((a) => a.family)).toBe(true);
    expect((await as('GET', '/places/108410/things?day=nope')).status).toBe(400);
    expect((await as('GET', '/places/611717/things')).json.status).toBe('none');
    expect((await mockTransport({ method: 'GET', path: '/places/108410/things' })).status).toBe(401);
  });

  it('a trip: from the hotel, its days, Book with Mada, Add to my plan on the itinerary', async () => {
    const trips = (await as('GET', '/trips')).json as J;
    const trip = (trips.upcoming as J[]).find((x) => x.city === 'Istanbul') ?? (trips.upcoming as J[])[0];
    expect(trip).toBeTruthy();
    const detail = (await as('GET', `/trips/${trip.id}`)).json.trip as J;
    const t = ThingsResponse.parse((await as('GET', `/trips/${trip.id}/things`)).json);
    expect(t.near?.label).toBe('hotel');
    expect(t.activities[0]!.distanceKm).not.toBeNull();
    expect((await as('GET', `/trips/${trip.id}/things?day=2001-01-01`)).status).toBe(400);

    const e = t.experiences[0]!;
    const b = await as('POST', '/things/book', { ref: { kind: 'experience', id: e.id }, placeId: t.place.id, day: detail.startDate, travellers: 2, clientId: `unit-${Date.now()}` });
    expect(b.status).toBe(201);
    const booked = BookThingResponse.parse(b.json);
    expect(booked.request.title).toBe(`Book ${e.title}`);
    const thread = (await as('GET', `/requests/${booked.request.id}/messages`)).json as J;
    expect((thread.messages as J[]).some((m) => m.text === booked.message)).toBe(true);

    const day = detail.endDate > detail.startDate ? detail.startDate.slice(0, 8) + String(Number(detail.startDate.slice(8)) + 1).padStart(2, '0') : detail.startDate;
    const add = await as('POST', `/trips/${trip.id}/ideas`, { ref: { kind: 'activity', id: 'osm:r1374029' }, placeId: '745044', day });
    expect(add.status).toBe(201);
    const ideas = TripIdeasResponse.parse((await as('GET', `/trips/${trip.id}/ideas`)).json);
    expect(ideas.ideas.map((i) => i.title)).toContain('Hagia Sophia');
    const itin = ItineraryResponse.parse((await as('GET', `/trips/${trip.id}/itinerary`)).json);
    expect(itin.days.find((d) => d.date === day)?.items.some((i) => i.title === 'Hagia Sophia' && i.kind === 'idea')).toBe(true);
    expect((await as('DELETE', `/trips/${trip.id}/ideas/${add.json.idea.id}`)).status).toBe(200);
    expect((await as('POST', `/trips/${trip.id}/ideas`, { ref: { kind: 'activity', id: 'osm:n404' }, placeId: '745044', day: null })).status).toBe(404);
  });
});
