/*
 * The wake-up alarm on the day before a flight: when it rings, and how this phone can ring it. Pure (no React
 * Native), so the unit tests can cover it. The screen is components/today/WakeRow.tsx; the phone side is lib/wake.ts.
 */
import { addDays, addMinutes, zonedToInstant } from '@mada/shared';

/** How this phone rings the alarm (docs: modules/mada-alarm/README.md). */
export type WakeMethod =
  /** Android: a real alarm in the Clock app (AlarmClock.ACTION_SET_ALARM). The person confirms it there. */
  | 'android-clock'
  /** iOS 26+: a real alarm through AlarmKit. Rings through silent mode and Focus, once the person allows it. */
  | 'ios-alarmkit'
  /** Older iOS, or AlarmKit refused: a time-sensitive notification, and a pointer to the Clock app. */
  | 'ios-notify'
  /** The web preview: the switch works, nothing rings. */
  | 'web';

export type WakePlatform = { os: string; version: string | number | undefined; alarmKit: boolean; alarmKitDenied?: boolean };

/** iOS major version from Platform.Version ("26.0.1" → 26); 0 when unknown. */
export function iosMajor(version: string | number | undefined): number {
  const n = typeof version === 'number' ? version : Number.parseInt(String(version ?? '').split('.')[0] ?? '', 10);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

/** Which way this phone wakes you. AlarmKit only on iOS 26+ with the native module present and not refused. */
export function wakeMethod(p: WakePlatform): WakeMethod {
  if (p.os === 'android') return 'android-clock';
  if (p.os === 'ios') return iosMajor(p.version) >= 26 && p.alarmKit && !p.alarmKitDenied ? 'ios-alarmkit' : 'ios-notify';
  return 'web';
}

/** Minutes before the pickup we suggest waking (pickupPlan's wake), and before departure when no car is booked. */
export const WAKE_BEFORE_PICKUP = 45;
export const WAKE_BEFORE_DEPARTURE = 200;
/** The wake time can move between 3 hours and 10 minutes before you leave. */
export const WAKE_EARLIEST = 180;
export const WAKE_LATEST = 10;

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h! * 60 + m!; };

type FlightLike = { departLocal: string; departTz: string };

/** The suggested time: the pickup minus 45 minutes, or the departure minus 200 minutes with no pickup. */
export function defaultWakeTime(out: FlightLike, pickupTime: string | null): string {
  return pickupTime ? addMinutes(pickupTime, -WAKE_BEFORE_PICKUP) : addMinutes(out.departLocal.slice(11, 16), -WAKE_BEFORE_DEPARTURE);
}

/** When you leave the house: the pickup, or 155 minutes before departure (the plan's "Leave for the airport"). */
export function leaveTime(out: FlightLike, pickupTime: string | null): string {
  return pickupTime ?? addMinutes(out.departLocal.slice(11, 16), -155);
}

/** Keep a chosen time between 3 hours and 10 minutes before you leave. */
export function clampWake(time: string, leave: string): string {
  // Minutes before leaving, through midnight (a 01:10 pickup with a 23:50 alarm is 80 minutes).
  const before = (((toMin(leave) - toMin(time)) % 1440) + 1440) % 1440;
  if (before < WAKE_LATEST) return addMinutes(leave, -WAKE_LATEST);
  if (before > WAKE_EARLIEST) return addMinutes(leave, -WAKE_EARLIEST);
  return time;
}

/**
 * The wall-clock day and the instant the alarm rings, in the departure airport's zone. A wake time later in the clock
 * than leaving means the night before (a 00:40 flight with a 21:20 alarm).
 */
export function wakeAt(out: FlightLike, leave: string, time: string): { day: string; local: string; at: Date } {
  const depDay = out.departLocal.slice(0, 10);
  const depMin = toMin(out.departLocal.slice(11, 16));
  // Leaving after the departure clock time means leaving the evening before (00:40 flight, 22:05 pickup).
  const leaveDay = toMin(leave) > depMin ? addDays(depDay, -1) : depDay;
  const day = toMin(time) > toMin(leave) ? addDays(leaveDay, -1) : leaveDay;
  const local = `${day}T${time}`;
  return { day, local, at: zonedToInstant(local, out.departTz) };
}

/** Five-minute steps for the time sheet. */
export const stepWake = (time: string, delta: number, leave: string) => clampWake(addMinutes(time, delta), leave);

/** Open-Meteo's WMO weather code as one of a few plain words (the copy has each in en and ar). */
export type Sky = 'clear' | 'cloudy' | 'fog' | 'rain' | 'storm' | 'dust';
export function skyOf(code: number): Sky {
  if (code <= 1) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 95) return 'storm';
  if (code >= 51) return 'rain';
  return 'dust';
}

/** Departure airports we know the place of, for the morning weather (others go without it). */
export const AIRPORT_AT: Readonly<Record<string, readonly [number, number]>> = {
  RUH: [24.957, 46.699], JED: [21.68, 39.157], DMM: [26.471, 49.798], MED: [24.553, 39.705], AHB: [18.24, 42.657], ULH: [26.483, 38.117],
  TIF: [21.483, 40.544], TUU: [28.365, 36.619], GIZ: [16.901, 42.586], ELQ: [26.303, 43.774], HOF: [25.285, 49.485], YNB: [24.144, 38.063],
  DXB: [25.253, 55.365], DOH: [25.273, 51.608], AUH: [24.433, 54.651], KWI: [29.227, 47.969], BAH: [26.271, 50.634], CAI: [30.122, 31.406],
};

/** The hour's reading from an Open-Meteo hourly forecast (temperature_2m, weather_code) at a local "YYYY-MM-DDTHH:MM". */
export function readForecast(json: unknown, local: string): { tempC: number; sky: Sky } | null {
  const h = (json as { hourly?: { time?: string[]; temperature_2m?: number[]; weather_code?: number[] } } | null)?.hourly;
  if (!h?.time?.length) return null;
  const want = `${local.slice(0, 13)}:00`;
  const i = h.time.indexOf(want);
  if (i < 0) return null;
  const temp = h.temperature_2m?.[i];
  const code = h.weather_code?.[i];
  if (typeof temp !== 'number' || typeof code !== 'number') return null;
  return { tempC: Math.round(temp), sky: skyOf(code) };
}

/** The forecast URL for the morning (no key needed; docs: open-meteo.com/en/docs). */
export function forecastUrl(airport: string, day: string): string | null {
  const at = AIRPORT_AT[airport];
  if (!at) return null;
  return `https://api.open-meteo.com/v1/forecast?latitude=${at[0]}&longitude=${at[1]}&hourly=temperature_2m,weather_code&timezone=auto&start_date=${day}&end_date=${day}`;
}

/** What we keep per trip on this phone. */
export type WakeState = {
  on: boolean;
  /** The chosen time, or null for the suggestion (which follows a pickup change). */
  time: string | null;
  /** What was set the last time we armed it, so it can be cancelled or replaced. */
  armed: { method: WakeMethod; at: string; time: string; alarmId: string | null; notificationId: string | null } | null;
};
/** Off until the person turns it on: nothing rings that they did not set. */
export const WAKE_DEFAULT: WakeState = { on: false, time: null, armed: null };
