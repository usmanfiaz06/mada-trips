import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { z } from 'zod';
import { create } from 'zustand';
import {
  dayLabel, departInstant, hhmm, liveFlightState, liveSegment, liveWindow, LIVE_START_BEFORE_MS, type LiveFlightState, type SegmentDetail, type TripDetail,
} from '@mada/shared';
import { MadaLive } from '../../modules/mada-live';
import { request } from '@/lib/api';
import { API_MODE } from '@/lib/config';
import { getLocale, t } from '@/lib/i18n';
import { kvGet, kvSet } from '@/lib/trips';

/*
 * The lock-screen flight (docs/app/NATIVE.md). On iPhone a Live Activity (lock screen and Dynamic Island) drawn by
 * the widget extension (targets/live); on Android an ongoing notification with the same lines. It starts by itself
 * 4 hours before take-off, or when the traveller taps "Follow on lock screen" on Today, and ends 30 minutes after
 * landing. While Mada is open the phone updates it from the trip; the server keeps it current over APNs once it has
 * the push token (and the APNs key: until then the phone's own updates and the usual pushes are what there is).
 * Also writes the next trip for the home-screen widget.
 */

export type LiveSupport = 'ios' | 'android' | 'off' | 'none';

/** What this phone can do: a Live Activity, an ongoing notification, Live Activities turned off in Settings, nothing. */
export function liveSupport(): LiveSupport {
  if (Platform.OS === 'android') return 'android';
  if (Platform.OS !== 'ios' || !MadaLive?.isSupported()) return 'none';
  return MadaLive.areActivitiesEnabled() ? 'ios' : 'off';
}

const KEY = 'mada.live.v1';
type Running = { activityId: string; tripId: string; segmentId: string; token: string | null; sent: string | null };
type Store = {
  running: Record<string, Running>;
  /** Segments the traveller took off the lock screen: never started again by itself. */
  stopped: string[];
  loaded: boolean;
  load: () => Promise<void>;
  set: (segmentId: string, r: Running | null) => void;
  stop: (segmentId: string) => void;
};

const persist = (s: Pick<Store, 'running' | 'stopped'>) => { void kvSet(KEY, JSON.stringify({ running: s.running, stopped: s.stopped.slice(-20) })); };

export const useLive = create<Store>((set, get) => ({
  running: {}, stopped: [], loaded: false,
  async load() {
    if (get().loaded) return;
    try {
      const v = JSON.parse((await kvGet(KEY)) ?? '{}') as Partial<Store>;
      set({ running: v.running ?? {}, stopped: v.stopped ?? [], loaded: true });
    } catch { set({ loaded: true }); }
  },
  set(segmentId, r) {
    const running = { ...get().running };
    if (r) running[segmentId] = r; else delete running[segmentId];
    set({ running }); persist(get());
  },
  stop(segmentId) {
    const stopped = [...new Set([...get().stopped, segmentId])];
    set({ stopped }); persist(get());
  },
}));

const Registered = z.object({ push: z.boolean() });

async function register(r: Running, platform: 'ios' | 'android') {
  if (API_MODE === 'mock') return;
  const key = `${r.activityId}:${r.token ?? ''}`;
  if (r.sent === key) return;
  try {
    await request({ method: 'POST', path: '/live-activities', body: { tripId: r.tripId, segmentId: r.segmentId, activityId: r.activityId, pushToken: r.token, platform, locale: getLocale() } }, Registered);
    useLive.getState().set(r.segmentId, { ...r, sent: key });
  } catch { /* told again on the next update */ }
}

async function unregister(activityId: string) {
  if (API_MODE === 'mock') return;
  try { await request({ method: 'DELETE', path: `/live-activities/${encodeURIComponent(activityId)}` }, z.object({ ended: z.boolean() })); } catch { /* the server ends it after landing anyway */ }
}

/* ───────── Android: the ongoing notification ───────── */

const CHANNEL = 'flight-live';
const notifId = (segmentId: string) => `mada-live-${segmentId}`;
let channelReady = false;

async function showAndroid(seg: SegmentDetail, s: LiveFlightState) {
  if (!channelReady) {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: t('live.channel'), importance: Notifications.AndroidImportance.DEFAULT, sound: null, vibrationPattern: null, showBadge: false }).catch(() => {});
    channelReady = true;
  }
  const vars = { gate: s.gate ?? '–', seat: s.seat ?? '–', boards: s.boards };
  await Notifications.scheduleNotificationAsync({
    identifier: notifId(seg.id),
    content: {
      title: t('live.notif.title', { flight: s.flight, to: s.to, status: s.statusText }),
      body: s.leaveText ? t('live.notif.leave', { leave: s.leaveText, ...vars }) : t('live.notif.body', vars),
      sticky: true, autoDismiss: false, sound: false, data: { href: '/today' },
    },
    trigger: { channelId: CHANNEL },
  });
}

/* ───────── start, update, stop ───────── */

const attributesOf = (trip: TripDetail, seg: SegmentDetail) => ({ tripId: trip.id, segmentId: seg.id, airline: seg.carrierName, brand: seg.brand ?? '#1e352d' });

/** Puts this trip's next flight on the lock screen now. */
export async function startLive(trip: TripDetail, now: number): Promise<boolean> {
  const seg = liveSegment(trip, now);
  const state = seg ? liveFlightState(trip, now, getLocale(), seg) : null;
  if (!seg || !state) return false;
  const support = liveSupport();
  if (support === 'android') {
    await showAndroid(seg, state);
    const r: Running = { activityId: notifId(seg.id), tripId: trip.id, segmentId: seg.id, token: null, sent: null };
    useLive.getState().set(seg.id, r);
    void register(r, 'android');
    return true;
  }
  if (support !== 'ios' || !MadaLive) return false;
  try {
    const activityId = await MadaLive.start(attributesOf(trip, seg), state);
    const prev = useLive.getState().running[seg.id];
    const token = MadaLive.running().find((x) => x.activityId === activityId)?.token ?? (prev?.activityId === activityId ? prev.token : null);
    const r: Running = { activityId, tripId: trip.id, segmentId: seg.id, token, sent: prev?.activityId === activityId ? prev.sent : null };
    useLive.getState().set(seg.id, r);
    void register(r, 'ios');
    return true;
  } catch { return false; }
}

/** Takes it off the lock screen, and doesn't put it back by itself. */
export async function stopLive(segmentId: string): Promise<void> {
  const r = useLive.getState().running[segmentId];
  useLive.getState().stop(segmentId);
  useLive.getState().set(segmentId, null);
  if (Platform.OS === 'android') await Notifications.dismissNotificationAsync(notifId(segmentId)).catch(() => {});
  else if (r && MadaLive) await MadaLive.end(r.activityId, null, true).catch(() => {});
  if (r) void unregister(r.activityId);
}

let tokenSub: { remove: () => void } | null = null;
function listen() {
  if (tokenSub || !MadaLive) return;
  const a = MadaLive.addListener('onPushToken', (e) => {
    const prev = useLive.getState().running[e.segmentId];
    const r: Running = { activityId: e.activityId, tripId: e.tripId, segmentId: e.segmentId, token: e.token, sent: prev?.sent ?? null };
    useLive.getState().set(e.segmentId, r);
    void register(r, 'ios');
  });
  // Swiped away on the lock screen: the traveller doesn't want it, so it isn't started again by itself.
  const b = MadaLive.addListener('onEnded', (e) => {
    if (e.dismissed) useLive.getState().stop(e.segmentId);
    useLive.getState().set(e.segmentId, null);
  });
  tokenSub = { remove: () => { a.remove(); b.remove(); } };
}

/**
 * Keeps the lock screen in step with the trip while Mada is open: starts it by itself 4 hours before take-off
 * (unless the traveller took it off), updates it whenever the trip changes, and ends it after landing.
 */
export function useLiveFlight(trip: TripDetail | null | undefined, now: () => number) {
  const live = useLive();
  const last = useRef('');
  useEffect(() => { void live.load(); listen(); }, [live]);
  useEffect(() => {
    if (!trip || !live.loaded) return;
    const at = now();
    widgetData(trip, at);
    const seg = liveSegment(trip, at);
    if (!seg) return;
    const window = liveWindow(seg, at);
    const r = live.running[seg.id];
    const state = liveFlightState(trip, at, getLocale(), seg);
    if (window === 'over') { if (r) void endLive(seg.id, state); return; }
    if (window !== 'live' || !state) return;
    const { updatedEpoch: _u, ...face } = state;
    const key = `${seg.id}:${JSON.stringify(face)}`;
    if (key === last.current && r) return;
    last.current = key;
    if (r) {
      if (Platform.OS === 'android') void showAndroid(seg, state);
      else void MadaLive?.update(r.activityId, state).catch(() => startLive(trip, at));
    } else if (!live.stopped.includes(seg.id) && liveSupport() !== 'none' && liveSupport() !== 'off') void startLive(trip, at);
  }, [trip, live, now]);
}

async function endLive(segmentId: string, state: LiveFlightState | null) {
  const r = useLive.getState().running[segmentId];
  useLive.getState().set(segmentId, null);
  if (Platform.OS === 'android') await Notifications.dismissNotificationAsync(notifId(segmentId)).catch(() => {});
  else if (r && MadaLive) await MadaLive.end(r.activityId, state, false).catch(() => {});
}

/** Whether "Follow on lock screen" makes sense now: the flight is less than a day away and hasn't landed. */
export function followable(trip: TripDetail, now: number): SegmentDetail | null {
  const seg = liveSegment(trip, now);
  if (!seg || seg.status === 'cancelled') return null;
  const w = liveWindow(seg, now);
  if (w === 'over') return null;
  return w === 'live' || departInstant(seg).getTime() - now < 24 * 3_600_000 ? seg : null;
}
export const startsByItselfAt = (seg: SegmentDetail) => departInstant(seg).getTime() - LIVE_START_BEFORE_MS;

/* ───────── the home-screen widget ───────── */

let lastWidget = '';
/** The next trip, in the traveller's language, for the widget to read (App Group). iPhone only. */
export function widgetData(trip: TripDetail | null, now: number) {
  if (Platform.OS !== 'ios' || !MadaLive) return;
  const seg = trip ? liveSegment(trip, now) : null;
  const json = trip ? JSON.stringify({
    city: trip.city,
    when: seg ? `${dayLabel(seg.departLocal.slice(0, 10), { locale: getLocale() })} · ${hhmm(seg.departLocal)}` : dayLabel(trip.startDate, { locale: getLocale() }),
    flight: seg?.flightNumber ?? null, route: seg ? `${seg.from} → ${seg.to}` : null,
    gate: seg?.gate ?? null, seat: seg?.seats[0] ?? null,
    line: seg ? liveFlightState(trip, now, getLocale(), seg)?.leaveText ?? null : null,
    labels: { gate: t('live.label.gate'), seat: t('live.label.seat') },
  }) : null;
  if (json === lastWidget) return;
  lastWidget = json ?? '';
  try { MadaLive.setWidgetData(json); } catch { /* an older build without the widget */ }
}
