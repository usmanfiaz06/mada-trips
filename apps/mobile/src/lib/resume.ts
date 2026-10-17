import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { AskIntent, CopyLocale, FlightOption, StayOption } from '@mada/shared';
import { appLocale } from './i18n';

/*
 * Keeping the traveller's place (the traveller is never clueless). What Ask has settled (the words, who, when,
 * where, the option picked) is saved on the phone as it changes, so a sign-in, a language switch (which restarts
 * the app) or a reload brings back the same search with the same option picked. The place to come back to after
 * signing in is kept here too (setReturnTo / takeReturnTo).
 */

const web = Platform.OS === 'web';
const ASK_KEY = 'mada.ask.resume.v1';
const RETURN_KEY = 'mada.return.v1';
/** A saved search older than this is a different evening: start fresh. */
const FRESH_MS = 2 * 60 * 60_000;

function writeRaw(key: string, value: string | null) {
  try {
    if (web) { if (value === null) globalThis.localStorage?.removeItem(key); else globalThis.localStorage?.setItem(key, value); return; }
    void (value === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, value)).catch(() => {});
  } catch { /* private mode: kept for this session only */ }
}
async function readRaw(key: string): Promise<string | null> {
  try { return web ? globalThis.localStorage?.getItem(key) ?? null : await AsyncStorage.getItem(key); } catch { return null; }
}

/** The option picked, by what doesn't change when the search runs again (offer ids do). */
export type AskPick = { kind: 'flight' | 'stay'; key: string };
/** `app` is the app's language when it was saved: a switch since then means the reader chose the other language. */
export type AskSnapshot = { v: 1; at: number; query: string; intent: AskIntent; pick: AskPick | null; app?: CopyLocale };

export const flightPickKey = (o: FlightOption) => [o.out.flightNumber, o.out.date, o.out.dep, o.back?.flightNumber ?? '', o.back?.date ?? '', o.cabin].join('|');
export const stayPickKey = (o: StayOption) => [o.hotel?.code ?? o.name, o.hotel?.room ?? o.facts?.room ?? '', o.facts?.refundable ?? ''].join('|');

let current: AskSnapshot | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const flush = () => { timer = null; writeRaw(ASK_KEY, current ? JSON.stringify(current) : null); };
const later = () => { if (!timer) timer = setTimeout(flush, 150); };
/** Write it now (before a restart). */
export const flushAsk = () => { if (timer) clearTimeout(timer); flush(); };

/** Ask's words and what it understood: saved (with what the flow settles, see noteAskSettled). */
export function saveAsk(query: string, intent: AskIntent) {
  current = { v: 1, at: Date.now(), query, intent, pick: current?.query === query ? current.pick : null, app: appLocale() };
  later();
}
/** What the flow on screen settled (who, dates, where), on top of what was typed. */
export function noteAskSettled(patch: Partial<AskIntent>) {
  if (!current) return;
  current = { ...current, at: Date.now(), intent: { ...current.intent, ...patch } };
  later();
}
export function noteAskPick(pick: AskPick | null) {
  if (!current || (current.pick?.key === pick?.key && current.pick?.kind === pick?.kind)) return;
  current = { ...current, at: Date.now(), pick };
  later();
}
/** The option to pick again when this kind of result shows (once). */
export function pendingPick(kind: AskPick['kind']): string | null {
  return restoredPick?.kind === kind ? restoredPick.key : null;
}
export const usedPendingPick = () => { restoredPick = null; };
let restoredPick: AskPick | null = null;

/** Done with it (booked, or a fresh ask): nothing to bring back. */
export function clearAsk() {
  current = null;
  restoredPick = null;
  if (timer) { clearTimeout(timer); timer = null; }
  writeRaw(ASK_KEY, null);
}

/** The saved search, if it is recent; its pick becomes the pending one. */
export async function loadAsk(): Promise<AskSnapshot | null> {
  const raw = current ? JSON.stringify(current) : await readRaw(ASK_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as AskSnapshot;
    if (s.v !== 1 || Date.now() - s.at > FRESH_MS || !s.intent) return null;
    current = s;
    restoredPick = s.pick;
    return s;
  } catch { return null; }
}
/** Replace guest ids with the account's after sign-in (lib/guest.ts carryOverGuestPeople). */
export function remapAsk(map: Map<string, string>) {
  if (!current || !map.size) return;
  const ids = current.intent.travellerIds?.map((id) => map.get(id) ?? id) ?? null;
  current = { ...current, intent: { ...current.intent, travellerIds: ids } };
  flush();
}

/** A peek at the saved search, for "Pick up where you left off" (nothing is restored yet). */
export async function peekAsk(): Promise<AskSnapshot | null> {
  const raw = current ? JSON.stringify(current) : await readRaw(ASK_KEY);
  try { const s = raw ? (JSON.parse(raw) as AskSnapshot) : null; return s && s.v === 1 && Date.now() - s.at <= FRESH_MS ? s : null; } catch { return null; }
}

/**
 * Where the app opens after it restarts itself (a language switch): the same screen, not Today. On the web the
 * address survives the reload; a phone reopens at the start, so it's kept here (app/index.tsx).
 */
const RELAUNCH_KEY = 'mada.relaunch.v1';
export async function setRelaunchTo(path: string) {
  const raw = JSON.stringify({ path, at: Date.now() });
  try { if (web) globalThis.localStorage?.setItem(RELAUNCH_KEY, raw); else await AsyncStorage.setItem(RELAUNCH_KEY, raw); } catch { /* */ }
}
export async function takeRelaunch(): Promise<string | null> {
  const raw = await readRaw(RELAUNCH_KEY);
  if (!raw) return null;
  writeRaw(RELAUNCH_KEY, null);
  try { const r = JSON.parse(raw) as { path?: string; at?: number }; return r.path?.startsWith('/') && Date.now() - (r.at ?? 0) < 5 * 60_000 ? r.path : null; } catch { return null; }
}

/** Where to come back to once signed in ("Sign in to book this" from a hotel, from Ask…). */
export function setReturnTo(path: string) {
  writeRaw(RETURN_KEY, JSON.stringify({ path, at: Date.now() }));
}
/** The place to come back to (once), or null. */
export async function takeReturnTo(): Promise<string | null> {
  const raw = await readRaw(RETURN_KEY);
  writeRaw(RETURN_KEY, null);
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as { path?: string; at?: number };
    return r.path && r.path.startsWith('/') && Date.now() - (r.at ?? 0) < FRESH_MS ? r.path : null;
  } catch { return null; }
}
export const clearReturnTo = () => writeRaw(RETURN_KEY, null);
