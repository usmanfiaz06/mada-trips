import { AppState, Platform } from 'react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { create } from 'zustand';

/*
 * Is there a connection, and is it any good? One store the whole app reads.
 *
 *   online   true / false / null (not known yet: treated as online)
 *   weak     a connection that works but slowly: 2G or slow 3G, data saver, a long round trip, or our own requests
 *            taking more than 2.5 s on average. Screens say "slower than usual" sooner; nothing is blocked.
 *
 * Sources, all folded together:
 *   - @react-native-community/netinfo on phones (Wi-Fi/cellular, isInternetReachable),
 *   - navigator.onLine, the online/offline events and navigator.connection on the web build,
 *   - what our own requests see: a request that couldn't reach us while the OS says "online" counts as a strike;
 *     two strikes in a row mean offline until something answers again (captive portals, dead Wi-Fi).
 *   - a demo/test switch (simulateOffline), the prototype's "Offline" toggle.
 * React Query's onlineManager follows this store, so queries pause offline and refetch on reconnect.
 */

export type NetState = {
  online: boolean | null;
  weak: boolean;
  /** What the OS reports: wifi, cellular, none, unknown… */
  type: string;
  /** When `online` last changed (ms). */
  since: number;
  /** Average round trip of our own requests (ms, exponential moving average), or null before the first. */
  rtt: number | null;
  /** The demo/test switch. */
  simulated: boolean;
  /** Our requests' consecutive network failures while the OS says online. */
  strikes: number;
};

type Os = { connected: boolean | null; reachable: boolean | null; type: string; weak: boolean };
let os: Os = { connected: null, reachable: null, type: 'unknown', weak: false };

export const useNet = create<NetState>(() => ({ online: null, weak: false, type: 'unknown', since: Date.now(), rtt: null, simulated: false, strikes: 0 }));

function recompute() {
  const s = useNet.getState();
  const osOnline = os.connected === null ? null : os.connected && os.reachable !== false;
  const online = s.simulated || osOnline === false || s.strikes >= 2 ? false : osOnline;
  const weak = !!online && (os.weak || (s.rtt !== null && s.rtt > 2500));
  const was = s.online;
  useNet.setState({ online, weak, type: os.type, ...(was !== online ? { since: Date.now() } : null) });
  if (was !== online) onlineManager.setOnline(online !== false);
  if (online === false && !s.simulated && os.connected !== false) scheduleProbe();
}

/**
 * True only when the phone itself says there's no connection (or the demo switch is on): a request is then refused
 * at once instead of waiting for a timeout. Offline-by-strikes still lets requests try, so one can bring us back.
 */
export const isOffline = () => useNet.getState().simulated || os.connected === false;

/* While our requests can't get through but the OS says online, ask the server every few seconds until it answers. */
let probe: (() => Promise<boolean>) | null = null;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probeDelay = 3000;
/** The API client registers a cheap request (GET /config) for this. */
export const setProbe = (fn: () => Promise<boolean>) => { probe = fn; };
function scheduleProbe() {
  if (probeTimer || !probe) return;
  probeTimer = setTimeout(async () => {
    probeTimer = null;
    const s = useNet.getState();
    if (s.online !== false || s.simulated || os.connected === false) { probeDelay = 3000; return; }
    const ok = await probe!().catch(() => false);
    if (!ok) { probeDelay = Math.min(probeDelay * 2, 30_000); scheduleProbe(); } else probeDelay = 3000;
  }, probeDelay);
}

export function simulateOffline(on: boolean) {
  useNet.setState({ simulated: on, strikes: 0 });
  recompute();
}

/** Our request reached the server (any HTTP status). Feeds the round-trip average and clears strikes. */
export function reportReached(ms: number) {
  const s = useNet.getState();
  const rtt = s.rtt === null ? ms : Math.round(s.rtt * 0.7 + ms * 0.3);
  useNet.setState({ rtt, strikes: 0 });
  recompute();
}

/** Our request couldn't reach the server at all (not a timeout: those happen on slow connections too). */
export function reportUnreachable() {
  useNet.setState((s) => ({ strikes: s.strikes + 1 }));
  recompute();
}

/* ───────── sources ───────── */

type NavConnection = { effectiveType?: string; rtt?: number; downlink?: number; saveData?: boolean; addEventListener?: (t: string, f: () => void) => void };

function readWebConnection(): Partial<Os> {
  const nav = globalThis.navigator as (Navigator & { connection?: NavConnection }) | undefined;
  const c = nav?.connection;
  const weak = !!c && (c.saveData === true || c.effectiveType === 'slow-2g' || c.effectiveType === '2g' || (typeof c.rtt === 'number' && c.rtt > 800) || (typeof c.downlink === 'number' && c.downlink > 0 && c.downlink < 0.4));
  return { connected: nav ? nav.onLine !== false : null, reachable: null, type: c?.effectiveType ?? 'unknown', weak };
}

let started = false;

/** Start listening. Safe to call more than once. Returns a stop function (tests). */
export function startNet(): () => void {
  if (started) return () => {};
  started = true;
  const stops: (() => void)[] = [];

  // React Query follows us (and only us) for "online".
  onlineManager.setEventListener(() => () => {});

  if (Platform.OS === 'web') {
    const update = () => { os = { ...os, ...readWebConnection() }; recompute(); };
    update();
    const w = globalThis as unknown as Window;
    if (typeof w.addEventListener === 'function') {
      w.addEventListener('online', update);
      w.addEventListener('offline', update);
      stops.push(() => { w.removeEventListener('online', update); w.removeEventListener('offline', update); });
    }
    const conn = (globalThis.navigator as Navigator & { connection?: NavConnection } | undefined)?.connection;
    conn?.addEventListener?.('change', update);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NetInfo = (require('@react-native-community/netinfo') as typeof import('@react-native-community/netinfo')).default;
    const unsubscribe = NetInfo.addEventListener((s) => {
      const details = s.details as { cellularGeneration?: string | null; isConnectionExpensive?: boolean } | null;
      const gen = s.type === 'cellular' ? details?.cellularGeneration ?? null : null;
      os = { connected: s.isConnected, reachable: s.isInternetReachable, type: gen ? `cellular-${gen}` : s.type, weak: gen === '2g' || gen === '3g' };
      recompute();
    });
    stops.push(unsubscribe);
  }

  // Refetch what's on screen when the app comes back to the foreground (React Query's focus on native).
  const sub = AppState.addEventListener('change', (st) => focusManager.setFocused(st === 'active'));
  stops.push(() => sub.remove());

  return () => { stops.forEach((f) => f()); started = false; };
}

/** Tests: reset everything. */
export function resetNet(next: Partial<Os> = {}) {
  os = { connected: null, reachable: null, type: 'unknown', weak: false, ...next };
  useNet.setState({ online: null, weak: false, type: 'unknown', since: Date.now(), rtt: null, simulated: false, strikes: 0 });
  recompute();
}
