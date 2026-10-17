import {
  AddTripIdeaRequest, BookThingRequest, RideThingRequest, ERROR_CODES, MOCK_ACTIVITIES, MOCK_EXPERIENCES, THINGS_ATTRIBUTIONS, ThingsQuery, dayLabel, filterActivities, kmBetween, liveStay, localClock,
  mockEvents, moodOf, nextPrayer, openState, t, todayIdeas, utcOffsetMin, type Activity, type ErrorCode, type ThingsResponse, type TodayWeather, type TripDetail, type TripIdea,
} from '@mada/shared';
import type { WireResponse } from '../api';
import type { AreaMock } from '../mock-api';
import { bookingMock, retitleRequest } from './booking';
import { mockPlaceHit, mockSearch } from './places';
import { tripsMock } from './trips';
import { plannedIdeas } from './things-store';

/*
 * EXPO_PUBLIC_API_MODE=mock for Things to do: the same answers as GET /places/:id/things, /trips/:id/things,
 * POST /things/book and /trips/:id/ideas, over the shared hand-made sample (activities-data.ts) for the prototype's
 * cities. Hours are read against the city's clock, the weather is the mock's (hot in the Gulf), and "Book with Mada"
 * becomes a request through the booking mock, so its chat behaves like the real one.
 */

const ok = (json: unknown, status = 200): WireResponse => ({ status, json });
const err = (code: ErrorCode, fields?: Record<string, string>): WireResponse => ({ status: ERROR_CODES[code].status, json: { error: { code, message: t(ERROR_CODES[code].copy), ...(fields ? { fields } : null) } } });

const AR: Record<string, string> = { 745044: 'إسطنبول', 108410: 'الرياض', 108841: 'العلا', 292223: 'دبي', 2643743: 'لندن' };
/** The prototype's hotels, where the mock trips stay. */
const HOTELS: Record<string, { lat: number; lon: number }> = { 'Bereketzade Hotel': { lat: 41.0262, lon: 28.9727 } };

function placeOf(idOrName: string) {
  const hit = /^\d+$/.test(idOrName) ? mockPlaceHit(idOrName) : mockSearch(idOrName).results[0] ?? null;
  if (!hit) return null;
  const id = hit.id;
  const acts = MOCK_ACTIVITIES[id] ?? [];
  const lat = acts.length ? acts.reduce((n, a) => n + a.lat, 0) / acts.length : 0;
  const lon = acts.length ? acts.reduce((n, a) => n + a.lon, 0) / acts.length : 0;
  return { id, name: hit.name, nameAr: AR[id] ?? null, lat, lon, timezone: hit.timezone, countryCode: hit.countryCode };
}

function weatherFor(p: { lat: number; countryCode: string }): TodayWeather {
  const gulf = ['SA', 'AE', 'QA', 'KW', 'BH', 'OM'].includes(p.countryCode);
  const maxC = gulf ? 41 : p.lat > 45 ? 14 : 24;
  const rain = p.lat > 50 ? 70 : 5;
  const code = p.lat > 50 ? 61 : 1;
  const mood = moodOf({ tempC: maxC - 3, maxC, rainChance: rain, code });
  return { tempC: maxC - 3, maxC, minC: maxC - 10, rainChance: rain, code, mood, indoorFirst: mood !== 'fine', at: new Date().toISOString() };
}

const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function mockThings(idOrName: string, raw: Record<string, string>, ctx: { near?: { lat: number; lon: number; label: 'hotel' | 'you' | 'centre' } | null; ages?: number[]; trip?: TripDetail | null } = {}): ThingsResponse | WireResponse {
  const parsed = ThingsQuery.safeParse(raw);
  if (!parsed.success) return err('VALIDATION', Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || '_', i.message])));
  const q = parsed.data;
  const p = placeOf(idOrName);
  if (!p) return err('NOT_FOUND');
  const clock = localClock(p.timezone);
  const day = q.day ?? (ctx.trip && clock.day < ctx.trip.startDate ? ctx.trip.startDate : clock.day);
  const isToday = day === clock.day;
  const ages = q.ages ? q.ages.split(',').map(Number) : ctx.ages ?? [];
  const near = q.near ? { lat: Number(q.near.split(',')[0]), lon: Number(q.near.split(',')[1]), label: 'you' as const } : ctx.near ?? null;
  let acts: Activity[] = (MOCK_ACTIVITIES[p.id] ?? []).map((a) => {
    const st = isToday ? openState(a.hours, clock) : { open: null, closesAt: null };
    return { ...a, openNow: st.open, closesAt: st.closesAt, distanceKm: near ? Math.round(kmBetween(near.lat, near.lon, a.lat, a.lon) * 10) / 10 : null };
  });
  if (near) acts = [...acts].sort((a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99) || b.popularity - a.popularity);
  const weather = isToday ? weatherFor(p) : null;
  const to = q.day ? day : addDays(day, 14);
  const events = mockEvents(p.id, clock.day).filter((e) => e.endsOn >= day && e.startsOn <= to);
  const youngest = ages.length ? Math.min(...ages) : null;
  const experiences = (MOCK_EXPERIENCES[p.id] ?? []).filter((e) => youngest === null || e.minAge === null || youngest >= e.minAge);
  const family = q.family ?? false;
  const shown = filterActivities(acts, { open: isToday && q.open, family, ages, kind: q.kind }).slice(0, q.limit);
  const prayer = acts.length ? nextPrayer(day, isToday ? clock.minutes : 0, p.lat, p.lon, utcOffsetMin(p.timezone)) : null;
  const today = isToday ? todayIdeas(acts, { day, minutes: clock.minutes, weather, family: family || ages.some((a) => a < 12), prayer }) : null;
  const attributions = [
    ...(acts.length ? [THINGS_ATTRIBUTIONS.osm, THINGS_ATTRIBUTIONS.wikidata] : []),
    ...(events.some((e) => e.source === 'ticketmaster') ? [THINGS_ATTRIBUTIONS.ticketmaster] : []),
    { source: 'geonames' as const, text: 'Places from GeoNames, CC BY 4.0', url: 'https://www.geonames.org/', licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  ];
  return {
    place: p, status: acts.length ? 'ready' : 'none', day, localTime: clock.hhmm, weather, today, activities: shown, experiences, events,
    near: near ? { lat: near.lat, lon: near.lon, label: near.label } : null, ages, attributions, fetchedAt: '2026-10-10T10:00:00.000Z',
  };
}

const isWire = (x: unknown): x is WireResponse => !!x && typeof x === 'object' && 'status' in x && 'json' in x;

function findThing(placeId: string, ref: { kind: string; id: string }) {
  const p = placeOf(placeId);
  if (!p) return null;
  if (ref.kind === 'activity') { const a = (MOCK_ACTIVITIES[p.id] ?? []).find((x) => x.id === ref.id); return a ? { p, title: a.name, sub: a.summary } : null; }
  if (ref.kind === 'experience') { const e = (MOCK_EXPERIENCES[p.id] ?? []).find((x) => x.id === ref.id); return e ? { p, title: e.title, sub: e.summary } : null; }
  const w = mockEvents(p.id, localClock(p.timezone).day).find((x) => x.id === ref.id);
  return w ? { p, title: w.title, sub: w.venue } : null;
}

export const thingsMock: AreaMock = async (w, ctx) => {
  const [path = '', query = ''] = w.path.split('?');
  const place = /^\/places\/([^/]+)\/things$/.exec(path);
  const trip = /^\/trips\/([^/]+)\/(things|ideas)(?:\/([^/]+))?$/.exec(path);
  const book = path === '/things/book';
  const ride = path === '/things/ride';
  if (!place && !trip && !book && !ride) return null;
  // A city's things are open to anyone; a trip's ideas, booking and rides need an account.
  if (!ctx.user && !(place && w.method === 'GET')) return err('UNAUTHORIZED');
  const raw = Object.fromEntries(new URLSearchParams(query).entries());

  if (place && w.method === 'GET') {
    const r = mockThings(decodeURIComponent(place[1]!), raw);
    return isWire(r) ? r : ok(r);
  }

  if (trip) {
    const got = await tripsMock({ method: 'GET', path: `/trips/${trip[1]}`, token: w.token }, ctx);
    if (!got || got.status !== 200) return got ?? err('NOT_FOUND');
    const detail = (got.json as { trip: TripDetail }).trip;
    if (trip[2] === 'things' && w.method === 'GET') {
      if (raw.day && (raw.day < detail.startDate || (detail.endDate && raw.day > detail.endDate))) return err('VALIDATION', { day: 'That day isn’t part of this trip' });
      const st = liveStay(detail);
      const year = Number(detail.startDate.slice(0, 4));
      const ages = detail.travellers.map((x) => (x.birthYear !== null ? year - x.birthYear : null)).filter((a): a is number => a !== null && a < 18);
      const r = mockThings(detail.city, raw, { near: st && HOTELS[st.name] ? { ...HOTELS[st.name]!, label: 'hotel' } : null, ages, trip: detail });
      return isWire(r) ? r : ok(r);
    }
    const list = plannedIdeas.get(detail.id) ?? [];
    if (trip[2] === 'ideas' && !trip[3] && w.method === 'GET') return ok({ ideas: list });
    if (trip[2] === 'ideas' && !trip[3] && w.method === 'POST') {
      const b = AddTripIdeaRequest.safeParse(w.body ?? {});
      if (!b.success) return err('VALIDATION');
      if (b.data.day && (b.data.day < detail.startDate || (detail.endDate && b.data.day > detail.endDate))) return err('VALIDATION', { day: 'That day isn’t part of this trip' });
      const had = list.find((i) => i.ref.id === b.data.ref.id);
      if (had) { had.day = b.data.day; return ok({ idea: had }); }
      const th = findThing(b.data.placeId, b.data.ref);
      if (!th) return err('NOT_FOUND');
      const idea: TripIdea = { id: crypto.randomUUID(), tripId: detail.id, ref: b.data.ref, day: b.data.day, title: th.title, sub: th.sub, createdAt: new Date().toISOString() };
      plannedIdeas.set(detail.id, [...list, idea]);
      return ok({ idea }, 201);
    }
    if (trip[2] === 'ideas' && trip[3] && w.method === 'DELETE') {
      if (!list.some((i) => i.id === trip[3])) return err('NOT_FOUND');
      plannedIdeas.set(detail.id, list.filter((i) => i.id !== trip[3]));
      return ok({ ok: true });
    }
    return null;
  }

  if (book && w.method === 'POST') {
    const b = BookThingRequest.safeParse(w.body ?? {});
    if (!b.success) return err('VALIDATION', Object.fromEntries(b.error.issues.map((i) => [i.path.join('.') || '_', i.message])));
    const th = findThing(b.data.placeId, b.data.ref);
    if (!th) return err('NOT_FOUND');
    const count = b.data.travellers ?? Math.max(1, b.data.travellerIds.length);
    const kids = b.data.ages.length;
    const adults = Math.max(1, count - kids);
    const who = kids ? t('things.request.whoKids', { adults, ages: b.data.ages.join(', ') }) : t(adults === 1 ? 'things.request.whoOne' : 'things.request.who', { n: adults });
    const when = b.data.day ? dayLabel(b.data.day, { today: b.data.day }) : t('things.request.dayOpen');
    const message = b.data.message ?? t('things.request.message', { name: th.title, city: th.p.name, who, when });
    const made = await bookingMock({ method: 'POST', path: '/requests', token: w.token, body: { kind: 'todo', query: message, answers: {}, needs: {}, note: '', travellerIds: b.data.travellerIds, clientId: b.data.clientId } }, ctx);
    if (!made || made.status >= 400) return made ?? err('INTERNAL');
    const view = (made.json as { request: { id: string; title: string; detail: string; summary: string } }).request;
    retitleRequest(view.id, Object.assign(view, { title: t('things.request.title', { name: th.title }), detail: `${th.p.name} · ${who} · ${when}`, summary: `${who} · ${when}` }));
    await bookingMock({ method: 'POST', path: `/requests/${view.id}/messages`, token: w.token, body: { text: message } }, ctx);
    return ok({ request: view, message }, 201);
  }
  if (ride && w.method === 'POST') {
    const b = RideThingRequest.safeParse(w.body ?? {});
    if (!b.success) return err('VALIDATION', Object.fromEntries(b.error.issues.map((i) => [i.path.join('.') || '_', i.message])));
    let detail: TripDetail | null = null;
    if (b.data.tripId) {
      const got = await tripsMock({ method: 'GET', path: `/trips/${b.data.tripId}`, token: w.token }, ctx);
      if (!got || got.status !== 200) return got ?? err('NOT_FOUND');
      detail = (got.json as { trip: TripDetail }).trip;
    }
    const stay = detail ? liveStay(detail) : null;
    if (b.data.pickup === 'hotel' && !stay) return err('VALIDATION', { pickupText: t('things.ride.whereNeeded') });
    if (detail && (b.data.day < detail.startDate || (detail.endDate && b.data.day > detail.endDate))) return err('VALIDATION', { day: 'That day isn’t part of this trip' });
    const th = findThing(b.data.placeId, b.data.ref);
    if (!th) return err('NOT_FOUND');
    const from = b.data.pickup === 'hotel' ? stay!.name : b.data.pickupText!.trim();
    const n = b.data.travellers ?? Math.max(1, detail?.travellers.length ?? 1);
    const who = n === 1 ? t('things.request.whoOne') : t('things.request.who', { n });
    const day = dayLabel(b.data.day, { today: b.data.day });
    const message = b.data.message ?? t('things.ride.message', { name: th.title, day, time: b.data.time, from, who });
    const made = await bookingMock({ method: 'POST', path: '/requests', token: w.token, body: { kind: 'car', query: message, answers: {}, needs: {}, note: '', travellerIds: [], clientId: b.data.clientId } }, ctx);
    if (!made || made.status >= 400) return made ?? err('INTERNAL');
    const view = (made.json as { request: { id: string; title: string; detail: string; summary: string } }).request;
    const rideDetail = [`${from} → ${th.title}`, `${day} ${b.data.time}`, who].join(' · ');
    retitleRequest(view.id, Object.assign(view, { title: t('things.ride.requestTitle', { name: th.title }), detail: rideDetail, summary: rideDetail }));
    await bookingMock({ method: 'POST', path: `/requests/${view.id}/messages`, token: w.token, body: { text: message } }, ctx);
    return ok({ request: view, message }, 201);
  }
  return null;
};
