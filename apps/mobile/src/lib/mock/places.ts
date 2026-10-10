import { CityGuide, PlaceId, PlanPlaceRequest, ERROR_CODES, normPlace, planMessage, t, type ErrorCode, type PlaceHit } from '@mada/shared';
import type { WireResponse } from '../api';
import type { AreaMock } from '../mock-api';
import { bookingMock } from './booking';
import CITIES from './places-cities.json';
import GUIDES from './places-guides.json';

/*
 * EXPO_PUBLIC_API_MODE=mock for Places: the same search rules as the server (prefix, words inside names, typos, airport
 * codes, bigger and served cities first) over a bundled list of about 2,000 cities (GeoNames, CC BY 4.0; OurAirports,
 * public domain; built by platform/scripts/places/export-bundles.ts), real Wikivoyage/Wikipedia extracts for two cities
 * (CC BY-SA, attributed) so the guide can be seen without a network, and "Plan it with Mada" through the booking mock's
 * requests, so the request and its chat behave exactly as they do there.
 */

type Row = [number, string, string, string, number, number, string, string];
const DATA = CITIES as unknown as { countries: Record<string, string>; tz: string[]; cities: Row[]; near: Record<string, string>; airports: Record<string, string> };
const SERVED = new Set([745044, 292223, 108841, 2643743, 587084, 360630, 110690, 105343]);
const BOOKING_KEY: Record<number, string> = { 745044: 'istanbul', 292223: 'dubai', 108841: 'alula', 2643743: 'london', 611717: 'tbilisi', 587084: 'baku', 360630: 'cairo', 110690: 'abha', 105343: 'jeddah', 1282027: 'maldives' };
const CURRENCY: Record<string, { code: string; name: string }> = { GE: { code: 'GEL', name: 'Lari' }, IT: { code: 'EUR', name: 'Euro' }, TR: { code: 'TRY', name: 'Lira' }, GB: { code: 'GBP', name: 'Pound' }, AE: { code: 'AED', name: 'Dirham' }, SA: { code: 'SAR', name: 'Rial' }, JP: { code: 'JPY', name: 'Yen' }, FR: { code: 'EUR', name: 'Euro' }, AZ: { code: 'AZN', name: 'Manat' }, EG: { code: 'EGP', name: 'Pound' } };

type City = { hit: PlaceHit; names: string[]; codes: string[]; tz: string };
const ALL: City[] = DATA.cities.map(([id, name, cc, iata, tz, popK, photo, alts]) => {
  const other = alts ? alts.split('|') : [];
  return {
    hit: {
      id: String(id), name, nameAr: null, region: null, country: DATA.countries[cc] ?? cc, countryCode: cc, population: popK * 1000, served: SERVED.has(id),
      curation: photo ? 'curated' : 'basic', photo: photo || null, iata: iata || null, matched: null, timezone: DATA.tz[tz] ?? 'UTC',
    },
    names: [normPlace(name), ...other.filter((a) => !/^[A-Z]{3}$/.test(a)).map(normPlace)],
    codes: [iata, ...other.filter((a) => /^[A-Z]{3}$/.test(a))].filter(Boolean),
    tz: DATA.tz[tz] ?? 'UTC',
  };
});
const byId = new Map(ALL.map((c) => [c.hit.id, c]));

const grams = (s: string) => { const x = `  ${s} `; const g = new Set<string>(); for (let i = 0; i < x.length - 2; i++) g.add(x.slice(i, i + 3)); return g; };
const similarity = (a: string, b: string) => { const A = grams(a); const B = grams(b); let n = 0; A.forEach((x) => { if (B.has(x)) n++; }); return n / (A.size + B.size - n); };
const rank = (c: City) => 0.06 * Math.log10(Math.max(c.hit.population, 1000)) + (c.hit.served ? 0.12 : 0) + (c.hit.curation === 'curated' ? 0.08 : 0);

export function mockSearch(input: string, limit = 8): { results: PlaceHit[]; suggestions: PlaceHit[] } {
  const q = normPlace(input);
  if (!q) return { results: [], suggestions: [] };
  const code = /^[a-z]{3}$/.test(q) ? q.toUpperCase() : null;
  const scored: { c: City; s: number; via: string | null }[] = [];
  for (const c of ALL) {
    let s = 0;
    let via: string | null = null;
    if (code && c.codes.includes(code)) { s = 1.2; via = code; }
    c.names.forEach((n, i) => {
      let m = 0;
      if (n === q) m = 1;
      else if (n.startsWith(q)) m = 0.9 - Math.min(0.15, (n.length - q.length) * 0.005);
      else if (q.length >= 3 && n.includes(` ${q}`)) m = 0.72;
      else if (q.length >= 4) { const sim = similarity(n, q); if (sim >= 0.3) m = sim * 0.85; }
      if (i > 0) m *= 0.92;
      if (m > s) { s = m; via = i > 0 ? n : null; }
    });
    if (s > 0) scored.push({ c, s: s + rank(c), via });
  }
  scored.sort((a, b) => b.s - a.s || b.c.hit.population - a.c.hit.population);
  if (scored.length) {
    return {
      results: scored.slice(0, limit).map(({ c, via }) => ({
        ...c.hit, matched: via && /^[A-Z]{3}$/.test(via) ? { kind: 'code' as const, label: via } : null,
      })),
      suggestions: [],
    };
  }
  const letters = q.replace(/\s+/g, '');
  const inOrder = (n: string) => { let i = 0; for (const ch of n) { if (ch === letters[i]) i++; if (i === letters.length) return true; } return false; };
  const near = ALL.filter((c) => c.hit.population >= 500_000 || c.hit.curation === 'curated')
    .map((c) => { const n = c.names[0]!; const s = Math.max(similarity(n, q), n[0] === letters[0] && inOrder(n) ? 0.3 : 0); return { c, s: s > 0.15 ? s + rank(c) : 0 }; })
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return { results: [], suggestions: near.slice(0, 3).map((x) => x.c.hit) };
}

function find(idOrSlug: string): City | null {
  if (/^\d+$/.test(idOrSlug)) return byId.get(idOrSlug) ?? null;
  const n = normPlace(idOrSlug);
  return ALL.filter((c) => c.names.includes(n)).sort((a, b) => b.hit.population - a.hit.population)[0] ?? null;
}

function guideOf(c: City): CityGuide {
  const open = (GUIDES as Record<string, Partial<CityGuide>>)[c.hit.id];
  const id = Number(c.hit.id);
  return CityGuide.parse({
    id: c.hit.id, name: c.hit.name, nameAr: c.hit.nameAr, region: c.hit.region, country: c.hit.country, countryCode: c.hit.countryCode, lat: 0, lon: 0, timezone: c.tz,
    population: c.hit.population, served: c.hit.served, curation: open?.sections?.length && c.hit.curation === 'basic' ? 'guide' : c.hit.curation, photo: c.hit.photo,
    bookingKey: BOOKING_KEY[id] ?? null, image: open?.image ?? null, summary: open?.summary ?? null, sections: open?.sections ?? [],
    airports: (DATA.near[c.hit.id] ?? '').split('|').filter(Boolean).map((x) => { const [iata, km, size] = x.split(':'); return { iata: iata!, name: DATA.airports[iata!] ?? iata!, km: Number(km), size: size === 'm' ? 'medium' as const : 'large' as const }; }),
    currency: CURRENCY[c.hit.countryCode] ?? null,
    attributions: [...(open?.attributions ?? []),
      { source: 'geonames', text: 'Places from GeoNames, CC BY 4.0', url: 'https://www.geonames.org/', licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' },
      { source: 'ourairports', text: 'Airports from OurAirports, public domain', url: 'https://ourairports.com/data/', licence: 'Public domain', licenceUrl: null }],
    fetchedAt: open ? '2026-10-10T10:00:00.000Z' : null,
  });
}

const ok = (json: unknown, status = 200): WireResponse => ({ status, json });
const err = (code: ErrorCode, fields?: Record<string, string>): WireResponse => ({ status: ERROR_CODES[code].status, json: { error: { code, message: t(ERROR_CODES[code].copy), ...(fields ? { fields } : null) } } });

export const placesMock: AreaMock = async (w, ctx) => {
  const [path = '', query = ''] = w.path.split('?');
  if (!path.startsWith('/places/')) return null;
  if (!ctx.user) return err('UNAUTHORIZED');
  const params = new URLSearchParams(query);
  if (w.method === 'GET' && path === '/places/search') {
    const q = (params.get('q') ?? '').trim();
    if (!q) return err('VALIDATION', { q: 'Type a city or an airport code' });
    return ok({ query: q, ...mockSearch(q) });
  }
  if (w.method === 'GET' && path === '/places/popular') {
    const from = params.get('from') ?? 'RUH';
    const order = [745044, 292223, 108841, 2643743, 611717, 587084, 360630, 110690, 105343, 104515, 109223, 1282027, 108410];
    return ok({ from, places: order.map((id) => byId.get(String(id))?.hit).filter((h): h is PlaceHit => !!h && h.iata !== from) });
  }
  const m = /^\/places\/([^/]+)(\/plan)?$/.exec(path);
  if (!m) return null;
  const id = PlaceId.safeParse(decodeURIComponent(m[1]!));
  const c = id.success ? find(id.data) : null;
  if (!c) return err('NOT_FOUND');
  if (!m[2] && w.method === 'GET') return ok({ place: guideOf(c) });
  if (m[2] && w.method === 'POST') {
    const b = PlanPlaceRequest.safeParse(w.body ?? {});
    if (!b.success) return err('VALIDATION', Object.fromEntries(b.error.issues.map((i) => [i.path.join('.') || '_', i.message])));
    const message = b.data.message ?? planMessage({ city: c.hit.name, travellers: b.data.travellers ?? (b.data.travellerIds.length || null), depart: b.data.depart ?? null, ret: b.data.return ?? null, month: b.data.month ?? null });
    // The booking mock owns requests and their threads; a plan is one of them.
    const made = await bookingMock({ method: 'POST', path: '/requests', token: w.token, body: { kind: 'general', query: message, answers: {}, needs: {}, note: '', travellerIds: b.data.travellerIds, clientId: b.data.clientId } }, ctx);
    if (!made || made.status >= 400) return made ?? err('INTERNAL');
    const view = (made.json as { request: { id: string; title: string; detail: string; summary: string } }).request;
    view.title = t('places.request.title', { city: c.hit.name });
    view.detail = `${t('places.request.detail', { city: c.hit.name, country: c.hit.country })} · ${message}`;
    view.summary = message;
    await bookingMock({ method: 'POST', path: `/requests/${view.id}/messages`, token: w.token, body: { text: message } }, ctx);
    return ok({ request: view, message }, 201);
  }
  return null;
};
