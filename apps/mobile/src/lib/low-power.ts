import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { liveStay, type PickupDetail, type Ride, type SegmentDetail, type StayDetail, type TripDetail } from '@mada/shared';

/*
 * The low-battery screen (app/battery.tsx): only what gets someone onto the plane, into the car and to the hotel.
 * Battery comes from the Battery Status API on the web build where the browser has it (Chrome, Edge, Android);
 * Safari and the native apps report nothing yet, so the screen is still one tap away on Today.
 */

export type Battery = { level: number; charging: boolean };
/** At or under this, not charging, Today suggests the low-battery screen. */
export const LOW_AT = 0.15;
export const isLow = (b: Battery | null | undefined) => !!b && !b.charging && b.level <= LOW_AT;

type BatteryManager = { level: number; charging: boolean; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void };

/** The battery, kept current, or null where the platform doesn't say. */
export function useBattery(): Battery | null {
  const [b, setB] = useState<Battery | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const nav = globalThis.navigator as (Navigator & { getBattery?: () => Promise<BatteryManager> }) | undefined;
    if (!nav?.getBattery) return;
    let mgr: BatteryManager | null = null;
    let live = true;
    const read = () => { if (live && mgr) setB({ level: mgr.level, charging: mgr.charging }); };
    nav.getBattery().then((m) => {
      mgr = m;
      read();
      m.addEventListener('levelchange', read);
      m.addEventListener('chargingchange', read);
    }).catch(() => {});
    return () => {
      live = false;
      mgr?.removeEventListener('levelchange', read);
      mgr?.removeEventListener('chargingchange', read);
    };
  }, []);
  return b;
}

export type Driver = { name: string | null; phone: string | null; car: string | null; at: string | null; place: string | null };
export type Essentials = { flight: SegmentDetail | null; driver: Driver | null; stay: StayDetail | null };

const DONE: ReadonlySet<string> = new Set(['departed', 'in_air', 'landed', 'cancelled', 'diverted']);
const HOUR = 3_600_000;

/** The car booked or on its way: a ride asked for now (assigned) first, then the trip's pickup in the next 24 hours. */
function driverOf(trip: TripDetail | null | undefined, rides: Ride[], now: number): Driver | null {
  const ride = rides.find((r) => r.status === 'assigned' && r.driver);
  if (ride?.driver) return { name: ride.driver.name, phone: ride.driver.phone, car: [ride.driver.car, ride.driver.plate].filter(Boolean).join(' · '), at: ride.pickupAt, place: ride.meetingPoint };
  const next = (trip?.pickups ?? [])
    .filter((p: PickupDetail) => p.status === 'booked' && Date.parse(p.at) >= now - 2 * HOUR && Date.parse(p.at) <= now + 24 * HOUR)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  if (!next) return null;
  return { name: next.driverName, phone: next.phone, car: [next.car, next.plate].filter(Boolean).join(' · ') || null, at: next.at, place: next.meetingPoint };
}

/** What the screen shows for this trip at `now` (the trip clock's instant). */
export function essentials(trip: TripDetail | null | undefined, now: number, rides: Ride[] = []): Essentials {
  const over = !trip || trip.clock.phase === 'home' || trip.clock.phase === 'none';
  return {
    flight: over ? null : trip.segments.find((s) => !DONE.has(s.status)) ?? null,
    driver: driverOf(over ? null : trip, rides, now),
    stay: over ? null : liveStay(trip),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14:05" today, "Tue 14 Oct, 14:05" on another day: when what's on screen was saved. */
export function savedAt(at: number, now = Date.now()): string {
  const d = new Date(at);
  const n = new Date(now);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? time : `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}, ${time}`;
}

