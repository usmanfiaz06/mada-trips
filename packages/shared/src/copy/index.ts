import { en, type CopyKey } from './en';

export { en, type CopyKey };

export type CopyLocale = 'en' | 'ar';
export type Vars = Record<string, string | number>;

/** Arabic is transcreated by a native Saudi writer (COPY.md §7.4). Until then, Arabic falls back to English. */
const catalogues: Record<CopyLocale, Partial<Record<CopyKey, string>>> = { en, ar: {} };

/** A string that was never written looks obviously unfinished (COPY.md §9), so it can't ship by accident. */
export const placeholderFor = (key: string) => `⟦${key}⟧`;

/** Look up a string and fill its `{placeholders}`. */
export function t(key: CopyKey, vars?: Vars, locale: CopyLocale = 'en'): string {
  const raw = catalogues[locale][key] ?? en[key] ?? placeholderFor(key);
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Plurals: `key.one` for 1, `key.other` with `{count}` otherwise. */
export function tn(base: string, count: number, vars: Vars = {}, locale: CopyLocale = 'en'): string {
  const key = `${base}.${count === 1 ? 'one' : 'other'}` as CopyKey;
  return t(key, { count, ...vars }, locale);
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
