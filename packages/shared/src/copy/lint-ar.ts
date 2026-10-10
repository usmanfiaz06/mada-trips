/**
 * The Arabic copy lint (COPY.md §3.2, §4, §7.4, §9). Run by test/copy.test.ts next to the English one.
 *
 *  - Every `{placeholder}` in the English string is in the Arabic one, and no others. Arabic's singular and dual
 *    forms (".one", ".two", ".zero") may leave the number out: "محاولة واحدة", "محاولتان".
 *  - No exclamation marks, em dashes, emoji or unfinished ⟦placeholders⟧.
 *  - Arabic punctuation inside Arabic text: "،" "؟" "؛" rather than the Latin marks.
 *  - Not Latin-only: a string with no Arabic letters must be a brand, a code, an example address or pure
 *    placeholders and symbols (AR_LATIN_OK).
 *  - None of the Arabic counterparts of the banned words.
 *  - Lock-screen notifications: title ≤ 36 characters, body ≤ 100 (Arabic sets narrower than it counts; the
 *    English limits are 32 and 90).
 */

export type ArProblem = { key: string; problem: string };

/** Arabic counterparts of COPY.md §3.2: AI words, system words, filler, pressure, vague time. */
export const AR_BANNED: readonly string[] = [
  // sounds like AI
  'ذكاء اصطناعي', 'الذكاء الاصطناعي', 'ذكي', 'ذكية', 'سحري', 'سحرية', 'مساعد ذكي', 'مساعدك', 'روبوت', 'بوت',
  'بكل سرور', 'سؤال رائع',
  // sounds like a system
  'خطأ', 'فشل', 'فشلت', 'غير صالح', 'بنجاح', 'المستخدم', 'عفوًا', 'عفواً', 'حدث خطأ ما', 'يرجى المحاولة لاحقًا',
  // travel clichés
  'مغامرة', 'رحلة العمر', 'لا تُنسى', 'جنة',
  // corporate filler
  'يرجى التكرم', 'عزيزي العميل', 'عميلنا العزيز', 'نعتذر عن أي إزعاج', 'في أقرب وقت ممكن',
  // pressure
  'سارع', 'لا تفوّت', 'لا تفوت', 'فرصة أخيرة', 'لفترة محدودة',
  // vague time
  'قريبًا', 'قريباً', 'بعد قليل', 'حالًا',
];

const AR_LETTERS = '\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF';
const HAS_ARABIC = new RegExp(`[${AR_LETTERS}]`);

/** A banned Arabic word, with Arabic letter boundaries and the usual attached prefixes (و ف ب ل ال). */
function arBannedIn(text: string): string[] {
  return AR_BANNED.filter((w) => {
    const re = new RegExp(`(^|[^${AR_LETTERS}])(و|ف|ب|ل|وال|فال|بال|لل|ال)?${w}($|[^${AR_LETTERS}])`);
    return re.test(text);
  });
}

/**
 * A string with no Arabic letters is allowed when it is only placeholders, digits and symbols, an e-mail or web
 * address, a code in capitals ("SV263", "RUH → IST"), or one of these brands and terms that stay in Latin.
 */
export const AR_LATIN_OK: readonly RegExp[] = [
  /^[\w.+-]+@[\w-]+\.[\w.]+$/, // example e-mail
  /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/, // web address
  /^[A-Z0-9 ·→\-–/:+]+$/, // codes in capitals
  /^(Mada|Mada Trips|Mada Ops|Tabby|Tamara|Apple Pay|Google Pay|mada|Visa|Mastercard|Face ID|Touch ID|Apple|Google|WhatsApp|eSIM|Saudia|flynas|flyadeal|Instagram|Snapchat|X)$/,
];

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
const PLURAL_SHORT = /\.(one|two|zero)$/;
const PLURAL_EXTRA = /\.(zero|two|few|many)$/;

function latinOnlyOk(v: string): boolean {
  const bare = v.replace(/\{\w+\}/g, '');
  if (!/[A-Za-z]/.test(bare)) return true;
  return AR_LATIN_OK.some((re) => re.test(v.trim()));
}

/** Every rule CI enforces on the Arabic catalogue, against the English one. */
export function lintArabic(ar: Record<string, string>, en: Record<string, string>): ArProblem[] {
  const out: ArProblem[] = [];
  for (const [key, value] of Object.entries(ar)) {
    const enKey = PLURAL_EXTRA.test(key) && !(key in en) ? key.replace(PLURAL_EXTRA, '.other') : key;
    const english = en[enKey];
    if (english === undefined) {
      out.push({ key, problem: 'no English key (a typo, or a plural form without an English .other)' });
      continue;
    }
    // Placeholders match English. Singular/dual forms may drop the count.
    const want = placeholders(english);
    const got = placeholders(value);
    const optional = PLURAL_SHORT.test(key) || /\.two$/.test(key) ? new Set(['count', 'n']) : new Set<string>();
    const missing = want.filter((p) => !got.includes(p) && !optional.has(p));
    const extra = got.filter((p) => !want.includes(p));
    if (missing.length) out.push({ key, problem: `missing placeholder ${missing.map((p) => `{${p}}`).join(' ')}` });
    if (extra.length) out.push({ key, problem: `unknown placeholder ${extra.map((p) => `{${p}}`).join(' ')}` });
    if (/[!！]/.test(value)) out.push({ key, problem: 'exclamation mark' });
    if (value.includes('—')) out.push({ key, problem: 'em dash' });
    if (/\p{Extended_Pictographic}/u.test(value)) out.push({ key, problem: 'emoji' });
    if (/⟦|⟧/.test(value)) out.push({ key, problem: 'unfinished placeholder' });
    if (/\s$|^\s/.test(value)) out.push({ key, problem: 'leading or trailing space' });
    if (value.trim() === '') out.push({ key, problem: 'empty' });
    if (HAS_ARABIC.test(value)) {
      if (new RegExp(`[${AR_LETTERS}] ?, `).test(value) || new RegExp(`, [${AR_LETTERS}]`).test(value)) out.push({ key, problem: 'Latin comma in Arabic text (use ،)' });
      if (new RegExp(`[${AR_LETTERS}] ?\\?`).test(value)) out.push({ key, problem: 'Latin question mark in Arabic text (use ؟)' });
      if (new RegExp(`[${AR_LETTERS}] ?;`).test(value)) out.push({ key, problem: 'Latin semicolon in Arabic text (use ؛)' });
    } else if (!latinOnlyOk(value) && value !== english) {
      out.push({ key, problem: 'Latin only, not a brand or code' });
    } else if (!latinOnlyOk(value)) {
      out.push({ key, problem: 'still English' });
    }
    for (const w of arBannedIn(value)) out.push({ key, problem: `banned word "${w}"` });
    if (key.startsWith('notify.') && key !== 'notify.sender') {
      const filled = value.replace(/\{\w+\}/g, 'XXXX');
      const limit = key.endsWith('.title') ? 36 : 100;
      if (filled.length > limit) out.push({ key, problem: `${filled.length} characters, limit ${limit}` });
    }
  }
  return out;
}

/** English keys with no Arabic. */
export function missingArabic(ar: Record<string, string>, en: Record<string, string>): string[] {
  return Object.keys(en).filter((k) => !(k in ar));
}
