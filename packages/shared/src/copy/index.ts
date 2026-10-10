import { en, type CopyKey } from './en';
import { authCopyAr } from './auth.ar';
import { arSections } from './ar';
import { isLatinRun, localeOr, localizeDigits, LRI, PDI, pluralKeys, type Lang } from '../locale';

export { en, type CopyKey };

export type CopyLocale = Lang;
export type Vars = Record<string, string | number>;

/**
 * Arabic (COPY.md §7.4): every English key (test/copy.test.ts holds it to that), plus Arabic's extra plural forms
 * (`.two`, `.few`, `.many`, `.zero`). Sections live in ./ar; sign-in keeps its own file (auth.ar.ts).
 * A key Arabic lacks falls back to English rather than showing nothing.
 */
export const ar: Readonly<Record<string, string>> = { ...arSections, ...authCopyAr };
const catalogues: Record<CopyLocale, Readonly<Record<string, string>>> = { en, ar };

/** The whole catalogue for a locale. */
export const catalogueFor = (locale: CopyLocale): Readonly<Record<string, string>> => catalogues[locale];

/** A string that was never written looks obviously unfinished (COPY.md §9), so it can't ship by accident. */
export const placeholderFor = (key: string) => `⟦${key}⟧`;

/**
 * Fill `{placeholders}`. In Arabic, a value that is a Latin run (a flight number, PNR, IATA code, a hotel's Latin
 * name) is wrapped in a left-to-right isolate so it never scrambles the sentence around it, and digits follow the
 * Arabic-Indic setting everywhere except inside those codes.
 */
function fill(raw: string, vars: Vars | undefined, locale: CopyLocale): string {
  const text = locale === 'ar' ? localizeDigits(raw, 'ar') : raw;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    if (!(name in vars)) return m;
    const v = vars[name] ?? '';
    if (locale !== 'ar') return String(v);
    if (typeof v === 'number') return localizeDigits(String(v), 'ar');
    if (/[\u2066-\u2069]/.test(v)) return v;
    if (/[A-Za-z]/.test(v) && isLatinRun(v)) return `${LRI}${v}${PDI}`;
    return localizeDigits(v, 'ar');
  });
}

/** Look up a string and fill its `{placeholders}`. The locale defaults to the display locale (setDisplayPrefs). */
export function t(key: CopyKey, vars?: Vars, locale?: CopyLocale): string {
  const l = localeOr(locale);
  const own = catalogues[l][key];
  return own !== undefined ? fill(own, vars, l) : fill(en[key] ?? placeholderFor(key), vars, 'en');
}

/**
 * Plurals. English has `key.one` and `key.other`. Arabic has six forms (Intl.PluralRules): writers give `.one`,
 * `.two`, `.few` (3–10) and `.other` (the singular-noun form that "many", 11–99, shares), and `.zero` where it
 * reads better. `{count}` is filled with the number.
 */
export function tn(base: string, count: number, vars: Vars = {}, locale?: CopyLocale): string {
  const l = localeOr(locale);
  const all = { count, ...vars };
  for (const k of pluralKeys(base, count, l)) {
    const raw = catalogues[l][k];
    if (raw !== undefined) return fill(raw, all, l);
  }
  return t(`${base}.${count === 1 ? 'one' : 'other'}` as CopyKey, all, 'en');
}

export function hasKey(key: string): key is CopyKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

/* ───────────── the banned list (COPY.md §3.2) ───────────── */

/** Words and phrases that never appear in the interface. Matched case-insensitively on word boundaries. */
export const BANNED: readonly string[] = [
  // sounds like AI
  'AI', 'smart', 'intelligent', 'magic', 'generate', 'generating', 'assistant', 'bot', "I'd be happy to", 'Certainly',
  'Great question', 'As an AI', 'delve', 'embark', 'tailored', 'curated', 'seamless', 'elevate', 'unlock', 'effortless',
  'personalised for you',
  // sounds like a system
  'error', 'invalid', 'failed', 'submit', 'successfully', 'request processed', 'user', 'item', 'data', 'oops', 'uh-oh',
  'something went wrong', 'please try again later',
  // travel clichés
  'journey', 'adventure awaits', 'wanderlust', 'explore the world', 'hidden gems', 'unforgettable', 'bucket list',
  'getaway', 'paradise',
  // corporate filler
  'kindly', 'dear customer', 'valued', 'we apologise for any inconvenience', 'at your earliest convenience', 'utilise',
  'leverage', 'via', 'hassle-free', 'best-in-class',
  // pressure
  'hurry', "don't miss out", 'last chance', 'limited time',
  // vague time
  'soon', 'shortly', 'in a moment',
];

/**
 * Strings allowed to use a banned word, each with the reason. Keep this list short; every entry is reviewed.
 * "data" is the section name COPY.md §5.10 itself uses ("Your data") and the prototype's privacy promise.
 */
export const BANNED_ALLOW: Readonly<Partial<Record<CopyKey, readonly string[]>>> = {
  'signin.note': ['data'],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s: string) => s.replace(/[’‘]/g, "'");

/** The banned words and phrases found in a string. */
export function bannedIn(text: string, allow: readonly string[] = []): string[] {
  const s = norm(text);
  return BANNED.filter((w) => !allow.includes(w)).filter((w) => {
    const caseSensitive = w === 'AI';
    const re = new RegExp(`(^|[^A-Za-z])${escape(norm(w))}($|[^A-Za-z])`, caseSensitive ? '' : 'i');
    return re.test(s);
  });
}

export type CopyProblem = { key: string; problem: string };
export { lintArabic, missingArabic, AR_BANNED } from './lint-ar';

/** Every rule CI enforces on the catalogue (COPY.md §4, §9). */
export function lintCatalogue(cat: Record<string, string> = en): CopyProblem[] {
  const out: CopyProblem[] = [];
  for (const [key, value] of Object.entries(cat)) {
    const allow = (BANNED_ALLOW as Record<string, readonly string[]>)[key] ?? [];
    for (const w of bannedIn(value, allow)) out.push({ key, problem: `banned word "${w}"` });
    if (value.includes('!')) out.push({ key, problem: 'exclamation mark' });
    if (value.includes('—')) out.push({ key, problem: 'em dash' });
    if (/\p{Extended_Pictographic}/u.test(value)) out.push({ key, problem: 'emoji' });
    if (/⟦|⟧/.test(value)) out.push({ key, problem: 'unfinished placeholder' });
    if (/\s$|^\s/.test(value)) out.push({ key, problem: 'leading or trailing space' });
    if (key.startsWith('notify.')) {
      // Limits are for the filled string; leave room for typical values in placeholders.
      const filled = value.replace(/\{\w+\}/g, 'XXXX');
      const limit = key.endsWith('.title') ? 32 : 90;
      if (filled.length > limit) out.push({ key, problem: `${filled.length} characters, limit ${limit}` });
    }
  }
  return out;
}
