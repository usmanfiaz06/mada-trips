import { useEffect } from 'react';
import { create } from 'zustand';
import { t } from '../i18n';
import { kvRead, kvWrite } from '../net/kv';
import { AUTH_MODE, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { AuthError } from './types';

/*
 * Which ways in the Supabase project has switched on. A provider that's off answers /auth/v1/authorize with raw JSON
 * ("Unsupported provider: provider is not enabled"), so the traveller must never be sent there. GET /auth/v1/settings
 * says what's on ({ external: { google, apple, phone, email, … } }). Kept for the session, and on the device so the
 * sign-in screen paints right at once; refreshed in the background each launch.
 *   Unknown (offline, never fetched): every button stays, and the way is checked once more right before it's used.
 *   Mock mode (EXPO_PUBLIC_API_MODE=mock): everything is on, as before.
 */
export type Way = 'google' | 'apple' | 'phone' | 'email';
export type Ways = Record<Way, boolean>;
const WAYS: Way[] = ['google', 'apple', 'phone', 'email'];
const KEY = 'mada.authWays.v1';

/** The settings body → what's on; null when it isn't the shape we expect (then nothing is hidden). */
export function parseAuthSettings(body: unknown): Ways | null {
  const ext = (body as { external?: unknown } | null)?.external;
  if (!ext || typeof ext !== 'object') return null;
  const e = ext as Record<string, unknown>;
  if (!WAYS.some((w) => typeof e[w] === 'boolean')) return null;
  // A key that's missing isn't proof it's off: only an explicit false hides a way.
  return { google: e.google !== false, apple: e.apple !== false, phone: e.phone !== false, email: e.email !== false };
}

/** Show this way? Mock mode and "don't know yet" say yes; otherwise what the project says. */
export function wayShown(mode: 'supabase' | 'mock', ways: Ways | null, way: Way): boolean {
  if (mode === 'mock' || !ways) return true;
  return ways[way];
}

/** What to say instead of going to a way that's off. Points at the ways that are on. */
export function notReadyMessage(way: Way, ways: Ways | null): string {
  if (way === 'phone') return t('auth.signin.phoneNotReady');
  const name = way === 'apple' ? t('auth.provider.apple') : way === 'google' ? t('auth.provider.google') : t('auth.provider.email');
  return ways && !ways.phone ? t('auth.signin.notReadyEmail', { name }) : t('auth.signin.notReady', { name });
}

type State = { ways: Ways | null; fresh: boolean };
export const useAuthWays = create<State>(() => ({ ways: null, fresh: false }));

async function fetchWays(timeoutMs = 5000): Promise<Ways | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY }, signal: ctl?.signal });
    if (!r.ok) return null;
    const ways = parseAuthSettings(await r.json());
    if (ways) {
      useAuthWays.setState({ ways, fresh: true });
      void kvWrite(KEY, JSON.stringify(ways));
    }
    return ways;
  } catch { return null; } finally { clearTimeout(timer); }
}

let loading: Promise<void> | null = null;
/** Once per launch: the device's copy first, then the project's answer in the background. */
export function loadAuthWays(): Promise<void> {
  if (AUTH_MODE === 'mock') return Promise.resolve();
  loading ??= (async () => {
    const raw = await kvRead(KEY);
    if (raw && !useAuthWays.getState().fresh) {
      try { const ways = parseAuthSettings({ external: JSON.parse(raw) }); if (ways) useAuthWays.setState({ ways }); } catch { /* */ }
    }
    if (!(await fetchWays())) loading = null; // try again next time a screen asks
  })();
  return loading;
}

/** For screens: is each way on (true while unknown)? Starts the check. */
export function useWayShown(): (way: Way) => boolean {
  const ways = useAuthWays((s) => s.ways);
  useEffect(() => { void loadAuthWays(); }, []);
  return (way) => wayShown(AUTH_MODE, ways, way);
}

/** Known to be off (this launch or the device's copy)? Unknown is not off. */
export const wayKnownOff = (way: Way): boolean => !wayShown(AUTH_MODE, useAuthWays.getState().ways, way);

/** Right before using a way: on per this session's answer, or per a fresh check; unreachable counts as on. */
export async function wayReady(way: Way): Promise<boolean> {
  if (AUTH_MODE === 'mock') return true;
  const s = useAuthWays.getState();
  if (s.fresh && s.ways) return s.ways[way];
  const ways = await fetchWays();
  return ways ? ways[way] : true;
}

/** Throws a calm AuthError ('notReady') instead of letting the traveller reach a way that's off. */
export async function requireWay(way: Way): Promise<void> {
  if (!(await wayReady(way))) throw new AuthError('notReady', notReadyMessage(way, useAuthWays.getState().ways));
}
