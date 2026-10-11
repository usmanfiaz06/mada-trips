import { describe, expect, it } from 'vitest';
import { RideThingResponse, ROUTES, directionsLinks, googleMapsUrl, offeredLinks, openUrlOf, travelEstimate, type GoTarget } from '@mada/shared';
import type { Wire } from '../../src/lib/api';
import { appsFor, openDirections } from '../../src/lib/directions';
import { mockTransport } from '../../src/lib/mock-api';

/* Directions from Things to do: the deep links per app and platform, which apps are offered (installed or with a web
   page to fall back on), opening with the fallback, the straight-line "about" times, and Get there with Mada (mock). */

const MUSEUM: GoTarget = { name: 'National Museum', lat: 24.64755, lon: 46.71038, address: 'King Saud Rd, Riyadh' };
const VENUE: GoTarget = { name: 'Boulevard World', lat: null, lon: null, address: 'Boulevard World, Riyadh' };

describe('deep links', () => {
  it('iOS: Apple Maps first, then Google Maps, Waze, Uber and Careem by scheme', () => {
    const l = directionsLinks(MUSEUM, 'ios', 'drive');
    expect(l.map((x) => x.app)).toEqual(['apple', 'google', 'waze', 'uber', 'careem']);
    const [apple, google, waze, uber, careem] = l;
    expect(apple).toMatchObject({ url: 'maps://?daddr=24.64755,46.71038&q=National%20Museum&dirflg=d', probe: null });
    expect(apple!.web).toBe('https://maps.apple.com/?daddr=24.64755,46.71038&q=National%20Museum&dirflg=d');
    expect(google).toMatchObject({ url: 'comgooglemaps://?daddr=24.64755,46.71038&directionsmode=driving', probe: 'comgooglemaps://' });
    expect(google!.web).toBe('https://www.google.com/maps/dir/?api=1&destination=24.64755,46.71038&travelmode=driving');
    expect(waze).toMatchObject({ url: 'waze://?ll=24.64755,46.71038&navigate=yes', probe: 'waze://', web: 'https://waze.com/ul?ll=24.64755,46.71038&navigate=yes' });
    expect(uber!.url).toBe('uber://?action=setPickup&pickup=my_location&dropoff[latitude]=24.64755&dropoff[longitude]=46.71038&dropoff[nickname]=National%20Museum');
    expect(uber!.web).toBeNull();
    expect(careem).toMatchObject({ url: 'careem://ride?dropoff_latitude=24.64755&dropoff_longitude=46.71038&dropoff_name=National%20Museum', probe: 'careem://', web: null });
  });

  it('iOS on foot: Apple and Google walk', () => {
    const [apple, google] = directionsLinks(MUSEUM, 'ios', 'walk');
    expect(apple!.url).toContain('dirflg=w');
    expect(google!.url).toContain('directionsmode=walking');
  });

  it('Android: Google Maps by its universal link (the app opens it), then Waze, Uber, Careem', () => {
    const l = directionsLinks(MUSEUM, 'android', 'drive');
    expect(l.map((x) => x.app)).toEqual(['google', 'waze', 'uber', 'careem']);
    expect(l[0]).toMatchObject({ url: 'https://www.google.com/maps/dir/?api=1&destination=24.64755,46.71038&travelmode=driving', probe: null });
  });

  it('web: Google Maps on the web only', () => {
    expect(directionsLinks(MUSEUM, 'web', 'walk')).toEqual([{ app: 'google', url: 'https://www.google.com/maps/dir/?api=1&destination=24.64755,46.71038&travelmode=walking', probe: null, web: null }]);
  });

  it('a venue with no point goes by its address', () => {
    expect(googleMapsUrl(VENUE)).toBe('https://www.google.com/maps/dir/?api=1&destination=Boulevard%20World%2C%20Riyadh%2C%20Boulevard%20World&travelmode=driving');
    const [apple, , waze, uber] = directionsLinks(VENUE, 'ios');
    expect(apple!.url).toMatch(/^maps:\/\/\?daddr=Boulevard%20World/);
    expect(waze!.url).toMatch(/^waze:\/\/\?q=Boulevard%20World/);
    expect(uber!.url).toContain('dropoff[formatted_address]=Boulevard%20World');
  });
});

describe('which apps, and opening them', () => {
  it('offers maps apps always (web fallback) and ride apps only when installed', async () => {
    const none = await appsFor(MUSEUM, 'drive', 'ios', async () => false);
    expect(none.map((x) => [x.app, x.installed])).toEqual([['apple', true], ['google', false], ['waze', false]]);
    expect(openUrlOf(none[1]!)).toMatch(/^https:\/\/www\.google\.com\/maps\/dir/);
    const all = await appsFor(MUSEUM, 'drive', 'ios', async () => true);
    expect(all.map((x) => x.app)).toEqual(['apple', 'google', 'waze', 'uber', 'careem']);
    expect(openUrlOf(all[1]!)).toMatch(/^comgooglemaps:/);
    const careemOnly = await appsFor(MUSEUM, 'drive', 'android', async (u) => u === 'careem://');
    expect(careemOnly.map((x) => x.app)).toEqual(['google', 'waze', 'careem']);
    const broken = await appsFor(MUSEUM, 'drive', 'android', async () => { throw new Error('no'); });
    expect(broken.map((x) => x.app)).toEqual(['google', 'waze']);
    expect(offeredLinks(directionsLinks(MUSEUM, 'web'), () => false).map((x) => x.app)).toEqual(['google']);
  });

  it('falls back to the web page when the app refuses', async () => {
    const [, waze] = await appsFor(MUSEUM, 'drive', 'android', async () => true);
    const opened: string[] = [];
    const url = await openDirections(waze!, async (u) => { opened.push(u); if (u.startsWith('waze:')) throw new Error('no app'); });
    expect(opened).toEqual(['waze://?ll=24.64755,46.71038&navigate=yes', 'https://waze.com/ul?ll=24.64755,46.71038&navigate=yes']);
    expect(url).toMatch(/^https:\/\/waze\.com/);
  });
});

describe('about how long from the hotel', () => {
  it('walks short hops and drives the rest', () => {
    const galata = { lat: 41.0262, lon: 28.9727 };
    const tower = travelEstimate(galata, { lat: 41.02562, lon: 28.97418 });
    expect(tower.mode).toBe('walk');
    expect(tower.min).toBeLessThanOrEqual(5);
    const aquarium = travelEstimate(galata, { lat: 40.96285, lon: 28.79876 });
    expect(aquarium.mode).toBe('drive');
    expect(aquarium.km).toBeGreaterThan(15);
    expect(aquarium.driveMin).toBeGreaterThan(25);
    expect(aquarium.driveMin).toBeLessThan(60);
  });
});

describe('Get there with Mada (mock)', () => {
  it('makes a car request with its first message, and needs a pickup place outside a trip', async () => {
    const call = async (w: Wire) => mockTransport(w);
    await call({ method: 'POST', path: ROUTES.otpStart, body: { phone: '0500004127' } });
    const token = ((await call({ method: 'POST', path: ROUTES.otpVerify, body: { phone: '0500004127', code: '123456' } })).json as { tokens: { accessToken: string } }).tokens.accessToken;
    const body = { ref: { kind: 'activity', id: 'osm:w140528417' }, placeId: '108410', day: '2026-10-20', time: '16:30', pickup: 'other', pickupText: 'Kingdom Centre', travellers: 2, clientId: 'ride-unit-0001' };
    const r = await call({ method: 'POST', path: '/things/ride', body, token });
    expect(r.status).toBe(201);
    const v = RideThingResponse.parse(r.json);
    expect(v.request.title).toBe('A car to National Museum of Saudi Arabia');
    expect(v.message).toContain('Kingdom Centre');
    expect(v.message).toContain('16:30');
    expect((await call({ method: 'POST', path: '/things/ride', body: { ...body, pickup: 'hotel', pickupText: undefined, clientId: 'ride-unit-0002' }, token })).status).toBe(400);
    expect((await call({ method: 'POST', path: '/things/ride', body: { ...body, ref: { kind: 'activity', id: 'osm:n1' }, clientId: 'ride-unit-0003' }, token })).status).toBe(404);
    expect((await call({ method: 'POST', path: '/things/ride', body })).status).toBe(401);
  });
});
