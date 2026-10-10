import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { DevSettings, I18nManager, Platform } from 'react-native';
import { create } from 'zustand';
import {
  getDisplayPrefs, pickLocale, setDisplayPrefs, t as tShared, tn as tnShared,
  type CopyKey, type CopyLocale, type Digits, type Vars,
} from '@mada/shared';

/*
 * Language and direction (COPY.md §7.4). Every user-facing word comes from the shared catalogue; layouts use
 * start/end, never left/right, so Arabic flips cleanly.
 *
 *  - First run follows the phone's language. Profile › Language switches, which restarts the app: React Native
 *    sets the layout direction once per launch (I18nManager.forceRTL), so a switch can't happen in place.
 *  - Native: the OS persists the forced direction across launches, so I18nManager.isRTL is read synchronously at
 *    start and the very first frame (fonts, layout) is already right. The saved choice confirms it at boot.
 *  - Web (review builds, e2e): localStorage is synchronous, and the document's dir does the flipping.
 *  - Digits (Western by default, Arabic-Indic optional) and the Hijri date apply at once, no restart.
 */

const web = Platform.OS === 'web';
const KEY = 'mada.locale.v1';

type Saved = { locale?: CopyLocale; digits?: Digits; hijri?: boolean };

function deviceLocale(): CopyLocale {
  try {
    return pickLocale(Localization.getLocales().map((l) => l.languageTag));
  } catch {
    return 'en';
  }
}

function readWeb(): Saved {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : {};
  } catch {
    return {};
  }
}

async function readSaved(): Promise<Saved> {
  if (web) return readWeb();
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : {};
  } catch {
    return {};
  }
}

async function writeSaved(patch: Saved): Promise<void> {
  const next = { ...(await readSaved()), ...patch };
  const raw = JSON.stringify(next);
  try {
    if (web) globalThis.localStorage?.setItem(KEY, raw);
    else await AsyncStorage.setItem(KEY, raw);
  } catch { /* private mode: the choice lasts this session */ }
}

/** The locale for this launch, known synchronously so the first frame is right. */
function initialLocale(): CopyLocale {
  if (web) {
    const s = readWeb();
    return s.locale ?? deviceLocale();
  }
  I18nManager.allowRTL(true);
  return I18nManager.getConstants().isRTL ? 'ar' : 'en';
}

const locale: CopyLocale = initialLocale();
const webSaved = web ? readWeb() : {};
setDisplayPrefs({ locale, digits: webSaved.digits ?? 'latn', hijri: webSaved.hijri ?? false });

if (web && typeof document !== 'undefined') {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  // Drawings (route maps, stamps, card marks) are pictures, not reading order: their text anchors stay put, as on
  // native, instead of following the page's direction.
  const style = document.createElement('style');
  style.textContent = 'svg { direction: ltr; }';
  document.head.appendChild(style);
}

export const getLocale = (): CopyLocale => locale;
/** Right-to-left this launch. Use for what CSS/Yoga can't flip by itself: icons, swipes, translateX, gradients. */
export const isRTL = (): boolean => locale === 'ar';
/** 1 in left-to-right, −1 in right-to-left: multiply horizontal offsets and swipe distances by it. */
export const dirSign = (): 1 | -1 => (locale === 'ar' ? -1 : 1);
/** Mirror a directional glyph (back chevron, arrow, progress) in right-to-left. Never clocks, logos or media. */
export const flipX = () => (locale === 'ar' ? [{ scaleX: -1 }] : []);
/** Old name, kept for callers: the catalogue locale is set at start and changes only with a restart. */
export const setLocale = (_l: CopyLocale) => { I18nManager.allowRTL(true); };

export const t = (key: CopyKey, vars?: Vars) => tShared(key, vars, locale);

/** The list separator: ", " in English, the Arabic comma "، " in Arabic. */
export const listSep = (): string => (locale === 'ar' ? '، ' : ', ');
/** "Sara, Hessa and Ahmed" / "سارة، حصة وأحمد": in Arabic "و" joins the last name with no space. */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  const and = tShared('circles.and', undefined, locale);
  return `${items.slice(0, -1).join(listSep())} ${and}${locale === 'ar' ? '' : ' '}${items[items.length - 1]}`;
}
export const tn = (base: string, count: number, vars?: Vars) => tnShared(base, count, vars, locale);

/** Display settings that apply without a restart. Components that show them subscribe here. */
type DisplayState = { digits: Digits; hijri: boolean; set: (p: { digits?: Digits; hijri?: boolean }) => void };
export const useDisplay = create<DisplayState>((set) => ({
  digits: getDisplayPrefs().digits,
  hijri: getDisplayPrefs().hijri,
  set: (p) => {
    setDisplayPrefs(p);
    set(p);
    void writeSaved(p);
  },
}));

/**
 * At boot: load the digits and Hijri settings, and make sure this launch's language is the one chosen (or, before
 * any choice, the phone's). On native, a mismatch flips the direction and restarts once, behind the splash screen.
 * Resolves false when a restart is on its way.
 */
export async function bootLocale(): Promise<boolean> {
  const saved = await readSaved();
  if (saved.digits || saved.hijri !== undefined) useDisplay.getState().set({ digits: saved.digits ?? 'latn', hijri: saved.hijri ?? false });
  if (web) return true;
  const wanted = saved.locale ?? deviceLocale();
  if (wanted === locale) return true;
  I18nManager.forceRTL(wanted === 'ar');
  return !(await restart());
}

/** Restart the app. Web reloads the page; native reloads the JS bundle. False when this build can't. */
async function restart(): Promise<boolean> {
  if (web) {
    try { globalThis.location?.reload(); return true; } catch { return false; }
  }
  try {
    const Updates = await import('expo-updates');
    await Updates.reloadAsync();
    return true;
  } catch {
    if (__DEV__) { DevSettings.reload(); return true; }
    return false;
  }
}

/**
 * Switch language: saved, direction flipped, app restarted. Resolves false when the build can't restart itself,
 * so the caller can ask the traveller to close and reopen Mada (the choice is already saved).
 */
export async function switchLanguage(next: CopyLocale): Promise<boolean> {
  await writeSaved({ locale: next });
  if (!web) I18nManager.forceRTL(next === 'ar');
  if (next === locale) return true;
  return restart();
}
