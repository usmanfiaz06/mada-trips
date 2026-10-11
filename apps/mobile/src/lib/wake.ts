import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import { create } from 'zustand';
import { AIRPORT_CITY, AIRPORT_NAME, outSegment, pickupPlan, type TripDetail } from '@mada/shared';
import { MadaAlarm } from '../../modules/mada-alarm';
import { t } from '@/lib/i18n';
import { kvGet, kvSet } from '@/lib/trips';
import { clampWake, defaultWakeTime, forecastUrl, leaveTime, readForecast, wakeAt, wakeMethod, WAKE_DEFAULT, type WakeMethod, type WakeState } from './wake-logic';

/*
 * The wake-up alarm the day before a flight, on this phone only (it is about this phone's alarm, so it isn't synced:
 * the account has no preference for it, and another phone would need its own). What each platform really does is in
 * modules/mada-alarm/README.md: a Clock alarm on Android, an AlarmKit alarm on iOS 26+, a time-sensitive notification
 * on older iOS (and as the backup everywhere), nothing but the switch on the web.
 */

const KEY = 'mada.wake.v1';
type Store = {
  byTrip: Record<string, WakeState>;
  /** The person said no to AlarmKit (Settings › Mada › Alarms): fall back to the notification. */
  alarmKitDenied: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  patch: (tripId: string, p: Partial<WakeState>) => void;
  setDenied: (v: boolean) => void;
};

const save = (s: Pick<Store, 'byTrip' | 'alarmKitDenied'>) => { void kvSet(KEY, JSON.stringify({ byTrip: s.byTrip, alarmKitDenied: s.alarmKitDenied })); };

export const useWakeStore = create<Store>((set, get) => ({
  byTrip: {}, alarmKitDenied: false, loaded: false,
  async load() {
    if (get().loaded) return;
    const raw = await kvGet(KEY);
    try {
      const v = raw ? (JSON.parse(raw) as Partial<Store>) : {};
      set({ byTrip: v.byTrip ?? {}, alarmKitDenied: !!v.alarmKitDenied, loaded: true });
    } catch { set({ loaded: true }); }
  },
  patch(tripId, p) {
    const byTrip = { ...get().byTrip, [tripId]: { ...(get().byTrip[tripId] ?? WAKE_DEFAULT), ...p } };
    set({ byTrip });
    save({ byTrip, alarmKitDenied: get().alarmKitDenied });
  },
  setDenied(v) { set({ alarmKitDenied: v }); save({ byTrip: get().byTrip, alarmKitDenied: v }); },
}));

/** How this phone wakes you right now. */
export function currentMethod(denied = useWakeStore.getState().alarmKitDenied): WakeMethod {
  let alarmKit = false;
  try { alarmKit = !!MadaAlarm?.isAlarmKitAvailable(); } catch { alarmKit = false; }
  return wakeMethod({ os: Platform.OS, version: Platform.Version, alarmKit, alarmKitDenied: denied });
}

export type WakePlan = {
  suggested: string; time: string; leave: string; day: string; at: Date; local: string;
  driver: string | null; driveMin: number; airport: string; airportCode: string; city: string; homeCity: string;
};

const minsBetween = (a: string, b: string) => { const [h1, m1] = a.split(':').map(Number); const [h2, m2] = b.split(':').map(Number); return (((h2! * 60 + m2! - (h1! * 60 + m1!)) % 1440) + 1440) % 1440; };

/** The times for this trip: the suggestion, the chosen time (kept 3 h to 10 min before leaving), and the instant. */
export function wakePlan(trip: TripDetail, chosen: string | null): WakePlan | null {
  const out = outSegment(trip);
  if (!out) return null;
  const pk = pickupPlan(trip);
  const leave = leaveTime(out, pk?.time ?? null);
  const suggested = defaultWakeTime(out, pk?.time ?? null);
  const time = chosen ? clampWake(chosen, leave) : suggested;
  const w = wakeAt(out, leave, time);
  return {
    suggested, time, leave, day: w.day, at: w.at, local: w.local,
    driver: pk?.driver ?? null, driveMin: pk ? minsBetween(pk.time, pk.airportBy) : 35,
    airport: AIRPORT_NAME[out.from] ?? out.from, airportCode: out.from, city: trip.city, homeCity: AIRPORT_CITY[out.from] ?? out.from,
  };
}

/** The alarm's name in Clock and on the lock screen: "Mada: flight to Istanbul". */
export const alarmLabel = (city: string) => t('td.wake.label', { city });

/** The morning's weather at home, from Open-Meteo (no key). Never blocks: 4 seconds, then without it. */
async function morningWeather(plan: WakePlan): Promise<string> {
  const url = forecastUrl(plan.airportCode, plan.day);
  if (!url) return '';
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), 4000);
  try {
    const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
    if (!res.ok) return '';
    const w = readForecast(await res.json(), plan.local);
    return w ? t('td.wake.nWeather', { temp: w.tempC, sky: t(`td.sky.${w.sky}` as 'td.sky.clear'), city: plan.homeCity }) : '';
  } catch { return ''; } finally { clearTimeout(timer); }
}

/** The notification's words, written the evening before: the weather if we have it, the door time, the drive. */
export async function morningText(plan: WakePlan): Promise<{ title: string; body: string }> {
  const weather = await morningWeather(plan);
  const drive = plan.driver
    ? t('td.wake.nDriver', { driver: plan.driver, time: plan.leave, n: plan.driveMin, airport: plan.airport })
    : t('td.wake.nLeave', { time: plan.leave, n: plan.driveMin, airport: plan.airport });
  return { title: t('td.wake.nTitle', { city: plan.city }), body: weather ? `${weather} ${drive}` : drive };
}

type Notif = typeof import('expo-notifications');
const notifications = async (): Promise<Notif | null> => { if (Platform.OS === 'web') return null; try { return await import('expo-notifications'); } catch { return null; } };

/** A time-sensitive local notification at the wake time. Null when notifications are off. */
async function scheduleNotice(plan: WakePlan): Promise<string | null> {
  const N = await notifications();
  if (!N) return null;
  try {
    let perm = await N.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await N.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    if (!perm.granted) return null;
    const { title, body } = await morningText(plan);
    return await N.scheduleNotificationAsync({
      content: { title, body, sound: 'default', interruptionLevel: 'timeSensitive', data: { url: '/today' } },
      trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: plan.at },
    });
  } catch { return null; }
}

async function cancelNotice(id: string | null | undefined) {
  if (!id) return;
  const N = await notifications();
  await N?.cancelScheduledNotificationAsync(id).catch(() => {});
}

/** What happened when we armed it, for the row's line and the toast. */
export type ArmResult = { method: WakeMethod; note: null | 'past' | 'alarmDenied' | 'noClock' | 'notifyOff' };

/**
 * Sets the alarm for the plan on this phone, replacing what was set before (an iOS alarm and the notification are
 * cancelled; an Android Clock alarm can't be removed for you, so the caller says so).
 */
export async function armWake(tripId: string, plan: WakePlan): Promise<ArmResult> {
  const store = useWakeStore.getState();
  const prev = store.byTrip[tripId]?.armed ?? null;
  if (prev?.alarmId && prev.method === 'ios-alarmkit') await MadaAlarm?.cancel(prev.alarmId).catch(() => {});
  await cancelNotice(prev?.notificationId);
  let method = currentMethod();
  let note: ArmResult['note'] = null;
  let alarmId: string | null = null;
  let notificationId: string | null = null;
  if (plan.at.getTime() <= Date.now()) note = 'past';
  else if (method === 'android-clock') {
    const [h, m] = plan.time.split(':').map(Number);
    const ok = await MadaAlarm?.setClockAlarm(h!, m!, alarmLabel(plan.city), false).catch(() => false);
    if (!ok) note = 'noClock';
    notificationId = await scheduleNotice(plan);
  } else if (method === 'ios-alarmkit') {
    const auth = await MadaAlarm!.requestAuthorization().catch(() => 'denied' as const);
    if (auth === 'authorized') {
      alarmId = await MadaAlarm!.schedule(newId(), plan.at.getTime(), alarmLabel(plan.city), t('td.wake.stop')).catch(() => null);
      notificationId = await scheduleNotice(plan);
      if (!alarmId) { method = 'ios-notify'; if (!notificationId) note = 'notifyOff'; }
    } else {
      store.setDenied(true);
      method = 'ios-notify';
      note = 'alarmDenied';
      notificationId = await scheduleNotice(plan);
    }
  } else if (method === 'ios-notify') {
    notificationId = await scheduleNotice(plan);
    if (!notificationId) note = 'notifyOff';
  }
  store.patch(tripId, { on: true, armed: { method, at: plan.at.toISOString(), time: plan.time, alarmId, notificationId } });
  return { method, note };
}

/** Turns it off on this phone. Android: asks Clock to dismiss it by its label; true when Clock took the request. */
export async function disarmWake(tripId: string, city: string): Promise<{ method: WakeMethod; clockAsked: boolean }> {
  const store = useWakeStore.getState();
  const prev = store.byTrip[tripId]?.armed ?? null;
  if (prev?.alarmId) await MadaAlarm?.cancel(prev.alarmId).catch(() => {});
  await cancelNotice(prev?.notificationId);
  let clockAsked = false;
  if (prev?.method === 'android-clock') clockAsked = !!(await MadaAlarm?.dismissClockAlarm(alarmLabel(city)).catch(() => false));
  store.patch(tripId, { on: false, armed: null });
  return { method: prev?.method ?? currentMethod(), clockAsked };
}

/** Rewrites the notification with tonight's weather (the evening before), keeping the alarm as it is. */
export async function refreshNotice(tripId: string, plan: WakePlan): Promise<void> {
  const st = useWakeStore.getState().byTrip[tripId];
  if (!st?.on || !st.armed?.notificationId || plan.at.getTime() <= Date.now()) return;
  await cancelNotice(st.armed.notificationId);
  const notificationId = await scheduleNotice(plan);
  useWakeStore.getState().patch(tripId, { armed: { ...st.armed, notificationId } });
}

/** The Clock app: its alarms on Android; on iOS the undocumented clock-alarm: link, false when it doesn't open. */
export async function openClock(): Promise<boolean> {
  if (Platform.OS === 'android') return !!(await MadaAlarm?.showClockAlarms().catch(() => false));
  if (Platform.OS !== 'ios') return false;
  try { await Linking.openURL('clock-alarm://'); return true; } catch { return false; }
}

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

/** This trip's wake-up alarm, loaded from the phone. */
export function useWake(tripId: string): WakeState {
  const load = useWakeStore((s) => s.load);
  useEffect(() => { void load(); }, [load]);
  return useWakeStore((s) => s.byTrip[tripId]) ?? WAKE_DEFAULT;
}
