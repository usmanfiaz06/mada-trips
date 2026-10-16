/*
 * What a public feed holds for a person before it shows (FLOWS.md §8b, audit item 28). Pure rules, shared by the
 * platform's screen() and its tests. Nothing here rejects outright: a match means "a person looks first", and the
 * author is told plainly why (copy keys mod.held.*). The lists are deliberately short and clear: abuse, not opinion.
 *
 *  - screenText: contact details, links, a home address, abuse and profanity (English, Arabic, Arabizi, the usual
 *    misspellings and leet), scam words.
 *  - unlistedVenue: places Mada doesn't list (bars, nightclubs, adult venues, gambling, alcohol-led), by keyword in
 *    any language and by category from the places data (OpenStreetMap and Wikidata tags, supplier categories).
 *  - looksSpam: the same text again, a flood of links, or a line that is mostly one repeated thing.
 */

export type HoldCode = 'contact' | 'link' | 'address' | 'abuse' | 'scam' | 'venue' | 'spam' | 'image';
export type Hold = { code: HoldCode; match: string };

/* ───────────── normalising ───────────── */

const AR_DIACRITICS = /[ً-ٰٟـ]/g; // tashkeel and tatweel
/** Arabic letters as people type them: alef forms, taa marbuta, alef maqsura, Persian kaf/yeh, repeated letters. */
export function normaliseArabic(s: string): string {
  return s
    .replace(AR_DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ڪک]/g, 'ك').replace(/ی/g, 'ي').replace(/[ڤ]/g, 'ف').replace(/گ/g, 'ك')
    .replace(/([\u0621-\u064A])\1+/g, '$1'); // "كسسسس" → "كس" (both sides of the match are normalised the same way)
}
/** Latin as people type it to dodge a filter: leet digits, symbols for letters, repeated letters, spacing. */
export function normaliseLatin(s: string): string {
  return s.toLowerCase()
    .replace(/[0]/g, 'o').replace(/[1!|]/g, 'i').replace(/[3]/g, 'e').replace(/[4@]/g, 'a').replace(/[5$]/g, 's').replace(/[7]/g, 't').replace(/\*/g, 'u')
    .replace(/(.)\1{2,}/g, '$1$1');
}

/* ───────────── contact details, links, addresses ───────────── */

const CONTACT: [RegExp, string][] = [
  [/(?:^|\D)(?:\+?966[ -]?|0)?5\d[ -]?\d{3}[ -]?\d{4}(?:\D|$)/, 'phone'], // a Saudi mobile, with or without spaces
  [/\+\d{1,3}[ -]?\d{2,4}[ -]?\d{3,4}[ -]?\d{3,4}\b/, 'phone'], // any international number
  [/[\w.+-]+@[\w-]+\.[\w.]+/, 'email'],
  [/\b(?:whatsapp|whats app|واتس|واتساب|وتساب|snap(?:chat)?|سناب|telegram|تيليجرام|تلجرام|تيلي)\b.{0,20}\b(?:me|us|ني|نا|لي|على|at|@)\b/i, 'messenger'],
  [/\b(?:dm me|call me|text me)\b/i, 'contact ask'],
  // Arabic letters aren't \w, so no \b around them.
  [/(?:كلمني|كلموني|اتصل علي|اتصل بي|اتصلوا علي|راسلني|راسلوني|ارسل لي خاص|خاص لي|(?:على|ع)\s*(?:ال)?(?:واتس|واتساب|سناب|تلجرام|تيليجرام))/, 'contact ask'],
];
const LINK: [RegExp, string][] = [
  [/\bhttps?:\/\/\S+/i, 'url'],
  [/\bwww\.\S+/i, 'url'],
  [/\b[\w-]+\.(?:com|net|org|sa|io|co|me|link|xyz|ly|tv)\b(?:\/\S*)?/i, 'domain'],
  [/\bt\.me\/|\bwa\.me\/|\bbit\.ly\//i, 'short link'],
];
const ADDRESS: [RegExp, string][] = [
  [/\b(?:room|flat|apartment|apt|house|villa|unit)\s*(?:no\.?|number|#)?\s*\d+\b/i, 'a room or flat number'],
  [/(?:شقة|شقه|فيلا|بيت|غرفة|غرفه|عمارة|عماره|وحدة|وحده)\s*(?:رقم)?\s*\d+/, 'a room or flat number'],
  [/\b(?:my|our) (?:home )?address is\b/i, 'home address'],
  [/(?:عنواني|عنواننا|بيتي في|بيتنا في)/, 'home address'],
];

/* ───────────── abuse and profanity ───────────── */

/** English, matched on leet-normalised lowercase text with word boundaries. */
const ABUSE_EN = [
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bullshit', 'bitch', 'bastard', 'slut', 'whore', 'cunt', 'dick', 'pussy', 'asshole', 'arsehole',
  'retard', 'faggot', 'nigger', 'nigga', 'porn', 'nude', 'nudes', 'sex', 'sexy', 'hooker', 'escort', 'kill you', 'kill yourself', 'kys', 'die',
  'fuk', 'fck', 'fcuk', 'sht', 'btch', 'biatch', 'wtf', 'stfu', 'dickhead', 'jerk off', 'wanker', 'twat', 'cock',
];
/** Arabic, matched on normalised text; written both with and without the attached prefixes. */
const ABUSE_AR = [
  'كس', 'كسم', 'كسمك', 'كس امك', 'كس اختك', 'زب', 'زبي', 'زبر', 'طيز', 'طيزك', 'شرموط', 'شرموطه', 'شراميط', 'قحبه', 'قحاب', 'كحبه', 'عرص', 'عرصه', 'خول', 'خوال',
  'منيك', 'منيوك', 'منيوكه', 'نيك', 'نياكه', 'انيك', 'ينيك', 'ابن كلب', 'ابن الكلب', 'يا كلب', 'كلاب', 'ابن حرام', 'ولد حرام', 'يا حمار', 'يا حيوان', 'حيوانه',
  'وسخ', 'وسخه', 'زباله', 'يلعن', 'العن', 'لعنه الله', 'اللعنه', 'خرا', 'خره', 'خرى', 'تبا لك', 'تفو', 'مكوه', 'لوطي', 'لواط', 'سحاق', 'سكس', 'جنس', 'عاهره', 'داعر', 'دعاره', 'بغاء',
  'اقتلك', 'بقتلك', 'اذبحك', 'موت', 'انتحر',
];
/** Arabizi (Arabic typed in Latin letters and numbers), matched on raw lowercase text so the digits keep their sound. */
const ABUSE_ARABIZI = [
  'kos', 'koss', 'kess', 'kosomak', 'kos omak', 'kosommak', 'ks omk', 'zeb', 'zebi', 'zebb', 'zobr', 'teez', 'tez', 'tizak', 'sharmoota', 'sharmota', 'sharmouta', 'sharmoot', 'sharmoto',
  'ga7ba', 'qa7ba', 'kahba', 'gahba', 'ka7ba', '3ars', '3arsa', 'arss', 'khawal', '5awal', 'khwl', 'manyak', 'manyoka', 'manyook', 'mnayek', 'nek', 'neek', 'aneek', 'yneek',
  'ibn kalb', 'ebn kalb', 'wld kalb', 'ya kalb', 'ya 7mar', 'ya 7ayawan', 'ya hayawan', 'ibn 7aram', 'wld 7aram', 'khara', '5ara', 'kharaa', 'yl3an', 'yel3an', 'ya zbala', 'wsikh', 'wse5',
  'a2talak', 'b2tlk', 'bagtlk', 'ad-ba7ak', 'adb7ak',
];
const SCAM: [RegExp, string][] = [
  [/\b(?:scam|scammer|fraud|phishing|investment opportunity|guaranteed (?:profit|return)|double your money|crypto signals?|forex signals?)\b/i, 'scam words'],
  [/(?:نصب|نصاب|احتيال|احتيالي|استثمار مضمون|ربح مضمون|ضاعف فلوسك|توصيات (?:تداول|كريبتو|فوركس))/, 'scam words'],
];

const latinBoundary = (w: string) => new RegExp(`(?:^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z])`);
const AR_LETTER = '\\u0621-\\u064A\\u0671-\\u06D3';
const arabicBoundary = (w: string) => new RegExp(`(?:^|[^${AR_LETTER}])(?:و|ف|ب|ل|وال|فال|بال|لل|ال|يا)?${w}(?:ك|كم|ها|هم|ه|ي|ين|ات)?(?:$|[^${AR_LETTER}])`);

const squeeze = (s: string) => s.replace(/(.)\1+/g, '$1');
const EN_RULES = ABUSE_EN.map((w) => [latinBoundary(w), w] as const);
/** The same words with doubled letters squeezed, for "fuuuuck" and "shiiit". */
const EN_SQUEEZED = ABUSE_EN.map((w) => [latinBoundary(squeeze(w)), w] as const);
const AR_RULES = ABUSE_AR.map((w) => [arabicBoundary(normaliseArabic(w)), w] as const);
const ARABIZI_RULES = ABUSE_ARABIZI.map((w) => [latinBoundary(w), w] as const);

/** Why a text needs a person first, or null when it is clean. The first thing found wins; contact details before abuse. */
export function screenText(text: string): Hold | null {
  const raw = text;
  for (const [re, what] of CONTACT) if (re.test(raw)) return { code: 'contact', match: what };
  for (const [re, what] of LINK) if (re.test(raw)) return { code: 'link', match: what };
  for (const [re, what] of ADDRESS) if (re.test(raw)) return { code: 'address', match: what };
  const ar = normaliseArabic(raw);
  for (const [re, w] of AR_RULES) if (re.test(ar)) return { code: 'abuse', match: w };
  const lower = raw.toLowerCase().replace(/(.)\1{2,}/g, '$1$1');
  for (const [re, w] of ARABIZI_RULES) if (re.test(lower)) return { code: 'abuse', match: w };
  const en = normaliseLatin(raw);
  for (const [re, w] of EN_RULES) if (re.test(en)) return { code: 'abuse', match: w };
  const sq = squeeze(en);
  for (const [re, w] of EN_SQUEEZED) if (re.test(sq)) return { code: 'abuse', match: w };
  for (const [re, what] of SCAM) if (re.test(raw)) return { code: 'scam', match: what };
  return null;
}

/* ───────────── places we don't list ───────────── */

/** By keyword, in the name or the text, in English, Arabic and the usual transliterations. */
const VENUE_WORDS = [
  // alcohol-led
  'bar', 'bars', 'pub', 'pubs', 'wine bar', 'cocktail bar', 'cocktails', 'brewery', 'winery', 'distillery', 'taproom', 'beer garden', 'biergarten', 'happy hour', 'liquor', 'liquor store', 'bottle shop', 'rooftop bar', 'sports bar', 'lounge bar',
  'بار', 'بارات', 'حانة', 'حانه', 'خمارة', 'خماره', 'خمر', 'خمور', 'كحول', 'كحوليات', 'بيرة', 'بيره', 'نبيذ', 'مشروبات روحية', 'مشروبات كحولية', 'ويسكي', 'فودكا', 'كوكتيل بار', 'بوب', 'باب',
  // nightlife
  'nightclub', 'night club', 'nightclubs', 'disco', 'discotheque', 'dance club', 'rave', 'lap dance', 'strip club', 'stripclub', 'striptease', 'gentlemen\'s club', 'hookah bar',
  'ملهى', 'ملهى ليلي', 'ملاهي ليلية', 'نادي ليلي', 'نوادي ليلية', 'ديسكو', 'ديسكوتيك', 'كباريه', 'كاباريه', 'سهرة مختلطة', 'نايت كلوب',
  // adult
  'adult venue', 'adult club', 'adult shop', 'sex shop', 'erotic', 'massage parlour', 'massage parlor', 'happy ending', 'escort', 'brothel', 'red light', 'swingers',
  'ماساج خاص', 'مساج خاص', 'تدليك خاص', 'ماخور', 'دعارة', 'بغاء', 'للكبار فقط', 'إباحي', 'اباحي', 'جنسي',
  // gambling
  'casino', 'casinos', 'gambling', 'betting', 'betting shop', 'bookmaker', 'slot machines', 'poker room', 'roulette', 'sportsbook',
  'كازينو', 'كازينوهات', 'قمار', 'مراهنات', 'مراهنة', 'رهان', 'ماكينات قمار', 'بوكر', 'روليت', 'يانصيب',
  // transliterations
  'nadi laili', 'nady layli', 'malha laili', 'kazino', 'khamr', 'khamra', 'khamara', 'disko',
];
const VENUE_RULES = VENUE_WORDS.map((w) => [/[؀-ۿ]/.test(w) ? arabicBoundary(normaliseArabic(w)) : latinBoundary(w), w] as const);
/** "Baby Bar" is not a bar: words that make the keyword innocent. */
const VENUE_INNOCENT = /\b(?:juice bar|coffee bar|snack bar|salad bar|sushi bar|oxygen bar|milk bar|dessert bar|breakfast bar|bar\s*b\s*q|bbq|barber|barbecue|barista|baraka|barakah|bari|barn|barrel|cafe bar|café bar|tea bar|chocolate bar|candy bar|mocktail|mocktails)\b/i;
const VENUE_INNOCENT_AR = /(?:عصير|عصيرات|قهوة|قهوه|كوفي|مطعم|باربكيو|مشويات|حلويات|شاي|موكتيل|موكتيلات)/;

/** OpenStreetMap tags (amenity=bar…) and the categories other sources use. */
const VENUE_TAGS: Record<string, readonly string[]> = {
  amenity: ['bar', 'pub', 'nightclub', 'casino', 'stripclub', 'brothel', 'gambling', 'biergarten', 'swingerclub', 'love_hotel', 'hookah_lounge_bar'],
  shop: ['alcohol', 'wine', 'erotic', 'bookmaker', 'lottery', 'cannabis'],
  leisure: ['adult_gaming_centre', 'dance', 'casino'],
  craft: ['brewery', 'winery', 'distillery'],
  club: ['sex', 'swingers', 'nightclub'],
  tourism: ['casino'],
  building: ['casino'],
  gambling: ['*'],
  brewery: ['*'],
  microbrewery: ['*'],
  'drink:beer': ['*'],
  'drink:wine': ['*'],
  'drink:cocktail': ['*'],
  'drink:spirits': ['*'],
  adult: ['*'],
};
/** Wikidata "instance of" items (P31) for the same venues. */
const VENUE_WIKIDATA = new Set([
  'Q187456', // bar
  'Q212198', // pub
  'Q622425', // nightclub
  'Q133215', // casino
  'Q1370598', // strip club
  'Q167346', // brothel
  'Q131734', // brewery
  'Q156362', // winery
  'Q2493', // distillery (rarely used)
  'Q1066133', // dance club / discotheque
  'Q28129', // wine bar
  'Q1192284', // gambling house
]);
const VENUE_CATEGORY = /\b(?:bar|pub|night ?club|night ?life|casino|gambling|betting|adult|erotic|strip|brewery|winery|wine|cocktail|liquor|alcohol|disco|lounge bar)\b|ملهى|كازينو|بار|خمر|قمار/i;

export type VenueInput = {
  name?: string | null;
  text?: string | null;
  /** OpenStreetMap tags where the place came with them. */
  tags?: Record<string, string> | null;
  /** Wikidata "instance of" ids where known (P31). */
  wikidataClasses?: readonly string[] | null;
  /** A category string from a supplier or an events source ("Nightlife", "Casino"). */
  category?: string | null;
};

/** Why a place is one Mada doesn't list (a word or a tag), or null when it may be listed. */
export function unlistedVenue(input: VenueInput): string | null {
  const tags = input.tags ?? {};
  for (const [k, vals] of Object.entries(VENUE_TAGS)) {
    const v = tags[k];
    if (!v) continue;
    const values = v.split(';').map((x) => x.trim());
    if (vals.includes('*') ? v !== 'no' : values.some((x) => vals.includes(x))) return `${k}=${v}`;
  }
  for (const q of input.wikidataClasses ?? []) if (VENUE_WIKIDATA.has(q)) return `wikidata ${q}`;
  if (input.category && VENUE_CATEGORY.test(input.category)) return `category ${input.category}`;
  const text = [input.name ?? '', input.text ?? ''].join('\n');
  if (!text.trim()) return null;
  const ar = normaliseArabic(text);
  const en = text.toLowerCase();
  const innocent = VENUE_INNOCENT.test(en) || VENUE_INNOCENT_AR.test(ar);
  for (const [re, w] of VENUE_RULES) {
    const hit = /[؀-ۿ]/.test(w) ? re.test(ar) : re.test(en);
    if (!hit) continue;
    // "Juice bar", "coffee bar": the innocent phrase, not the venue. Still held when a stronger word is there too.
    if (innocent && /^(?:bar|bars|بار|باب|بوب|lounge bar)$/.test(w)) continue;
    return w;
  }
  return null;
}

/* ───────────── spam and duplicates ───────────── */

/** Text reduced to what it says: lowercase, no punctuation, no diacritics, one space. */
export function fingerprint(text: string): string {
  return normaliseArabic(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export type SpamVerdict = 'duplicate' | 'flood' | 'repeated' | null;

/**
 * The same thing again (within the author's recent lines, as fingerprints), three or more links, or a line that is
 * mostly one word or one character repeated.
 */
export function looksSpam(text: string, recent: readonly string[] = []): SpamVerdict {
  const fp = fingerprint(text);
  if (fp.length >= 12 && recent.some((r) => fingerprint(r) === fp)) return 'duplicate';
  const links = (text.match(/\bhttps?:\/\/|\bwww\.|\b[\w-]+\.(?:com|net|org|sa|io|co|me|ly)\b/gi) ?? []).length;
  if (links >= 3) return 'flood';
  if (/(.)\1{9,}/.test(text)) return 'repeated'; // "!!!!!!!!!!" or "aaaaaaaaaa"
  const words = fp.split(' ').filter(Boolean);
  if (words.length >= 6) {
    const counts = new Map<string, number>();
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
    const top = Math.max(...counts.values());
    if (top / words.length >= 0.6) return 'repeated';
  }
  return null;
}

/* ───────────── the whole check ───────────── */

export type ScreenInput = {
  text: string;
  /** The place the tip is about, when there is one. */
  place?: string | null;
  venue?: Omit<VenueInput, 'name' | 'text'> | null;
  /** The author's recent texts, for duplicates. */
  recent?: readonly string[];
  /** Skip the venue rule (a chat line names places freely). */
  noVenue?: boolean;
};

/** Everything screen() applies, in order: contact, link, address, abuse, scam, venue, spam. */
export function screenContent(input: ScreenInput): Hold | null {
  const text = [input.place ?? '', input.text].filter(Boolean).join('\n');
  const t = screenText(text);
  if (t) return t;
  if (!input.noVenue) {
    const v = unlistedVenue({ name: input.place, text: input.text, ...(input.venue ?? {}) });
    if (v) return { code: 'venue', match: v };
  }
  const s = looksSpam(input.text, input.recent ?? []);
  if (s) return { code: 'spam', match: s };
  return null;
}

/** The hold a stored "code: match" string describes (app_posts.flagged), or null for the older free text. */
export function holdFromFlag(flag: string | null | undefined): Hold | null {
  if (!flag) return null;
  const m = /^(contact|link|address|abuse|scam|venue|spam|image): ?(.*)$/.exec(flag);
  return m ? { code: m[1] as HoldCode, match: m[2] ?? '' } : null;
}
export const flagOf = (h: Hold) => `${h.code}: ${h.match}`.slice(0, 120);
