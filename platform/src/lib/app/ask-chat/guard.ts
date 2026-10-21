import { arBannedIn, bannedIn, normalizeDigits, screenText } from "@mada/shared";

/*
 * What stands between the traveller, the model and the phone (docs/app/ASK-CHAT.md §Safety). Pure, so the evals and
 * the tests use exactly these.
 *   redact     passport and card numbers (and CVV-like codes after "cvv") never reach the model or the thread
 *   screen     the moderation rules (moderation.ts) on what the traveller typed: abuse gets a fixed calm line and is
 *              not sent on
 *   unbacked   every price, amount and clock time in a reply must appear in this turn's tool results
 *   outgoing   the banned-word check on every reply (COPY.md §6.4)
 */

const PASSPORT = /\b(?:[A-Z]{1,2}\d{6,9}|\d{9})\b/g; // Saudi "A12345678", most others; nine digits alone too
const MRZ = /[A-Z0-9<]{30,44}/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const CVV = /\b(?:cvv|cvc|security code|رمز الأمان)\s*[:\-]?\s*\d{3,4}\b/gi;
const IBAN = /\bSA\d{2}[ ]?(?:\d{4}[ ]?){4}\d{2}\b/gi;

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** The text with documents and payment details replaced by a word for what they were. */
export function redact(text: string): { text: string; redacted: number } {
  let n = 0;
  let out = normalizeDigits(text)
    .replace(CVV, () => { n += 1; return "[security code removed]"; })
    .replace(IBAN, () => { n += 1; return "[bank account removed]"; })
    .replace(CARD, (m) => {
      const d = m.replace(/\D/g, "");
      if (d.length >= 13 && luhn(d)) { n += 1; return "[card number removed]"; }
      return m;
    })
    .replace(MRZ, (m) => (m.includes("<") ? (n += 1, "[passport line removed]") : m));
  out = out.replace(PASSPORT, (m) => {
    // A phone number or a date is not a passport: only letter-led codes and bare nine-digit runs not starting 05.
    if (/^0?5\d{8}$/.test(m)) return m;
    n += 1;
    return "[passport number removed]";
  });
  return { text: out, redacted: n };
}

export type Screened = { ok: true } | { ok: false; reason: "abuse" | "scam" };

/** The moderation rules on the traveller's words. Contact details and links are fine in a private chat with Mada. */
export function screen(text: string): Screened {
  const hold = screenText(text);
  if (hold?.code === "abuse") return { ok: false, reason: "abuse" };
  if (hold?.code === "scam") return { ok: false, reason: "scam" };
  return { ok: true };
}

/** Amounts and clock times as written: "SAR 1,120", "1120 ر.س", "£16", "09:40", "9:40pm". */
const MONEY = /(?:SAR|ر\.?\s?س|﷼|riyals?|ريال|GBP|USD|EUR|£|\$|€)\s*\d[\d,٬]*(?:\.\d+)?|\d[\d,٬]*(?:\.\d+)?\s*(?:SAR|ر\.?\s?س|﷼|riyals?|ريال|GBP|USD|EUR|£|\$|€)/gi;
const TIME = /\b\d{1,2}:\d{2}\b/g;

const numbersOf = (s: string) => new Set((normalizeDigits(s).match(/\d[\d,٬]*(?:\.\d+)?/g) ?? []).map((x) => x.replace(/[,٬]/g, "").replace(/\.0+$/, "")));

/** Flight numbers as written: "SV263", "XY 125", "F3 211". Not data sizes, quarters or clock words. */
const FLIGHT_NO = /\b((?:[A-Z]{2}|[A-Z]\d|\d[A-Z]))\s?(\d{2,4})\b/g;
const NOT_CARRIER = new Set(["GB", "MB", "KB", "KM", "AM", "PM", "ID", "UK", "US", "EU", "NO", "AD", "Q1", "Q2", "Q3", "Q4", "H1", "H2"]);
/** Star ratings and scores: "5 stars", "4-star", "rated 8.7", "9.1/10", «٥ نجوم». */
const RATING = /(\d(?:\.\d)?)\s?(?:-?\s?stars?\b|★|نجوم|نجمات|نجمة)|\brated\s(\d{1,2}(?:\.\d)?)|\b(\d{1,2}(?:\.\d)?)\s?\/\s?(?:5|10)\b/gi;
/** Airlines by name (a reply never names one no tool returned). "Emirates" in "United Arab Emirates" is a country. */
const AIRLINES = /\b(?:Saudia|flynas|flyadeal|Riyadh Air|Turkish Airlines|(?<!Arab )Emirates|Qatar Airways|Etihad|Gulf Air|Oman Air|EgyptAir|Royal Jordanian|flydubai|Pegasus|Azerbaijan Airlines|Georgian Airways|British Airways|Lufthansa|Air Arabia|Kuwait Airways|AJet)\b/g;
/** Hotel brands, and "<Name> Hotel / Resort / Suites / Palace": a hotel no tool returned is never named. */
const HOTEL_BRANDS = /\b(?:Hilton|Marriott|Sheraton|Hyatt|Rixos|Swiss[oô]tel|M[oö]venpick|Fairmont|Ritz-Carlton|Four Seasons|Kempinski|InterContinental|Radisson|Novotel|Ibis|Pullman|Sofitel|Rotana|Rove|Raffles|Waldorf|Shangri-La|Anantara|Conrad|Crowne Plaza|Holiday Inn|Millennium|Hilton|Westin|Le M[eé]ridien|Mandarin Oriental|Park Hyatt|Address)\b/g;
const HOTEL_PHRASE = /\b((?:[A-Z][\w'’&-]+\s){1,3})(?:Hotel|Resort|Suites|Palace|Inn)\b|\b(?:Hotel|Resort)\s((?:[A-Z][\w'’&-]+\s?){1,3})/g;
const NOT_NAME = new Set(["the", "a", "an", "our", "this", "that", "we", "book", "your", "any", "one", "best", "top"]);

/**
 * What a reply says that no tool returned this turn: every price, amount and clock time must appear, as a number, in
 * the tool results; so must every flight number, star rating or score, airline and hotel it names. An empty list means
 * the reply only says what the tools said (docs/app/ASK-CHAT.md §Safety: answers come only from Mada's own tools).
 */
export function unbacked(reply: string, toolText: string): string[] {
  const known = numbersOf(toolText);
  const s = normalizeDigits(reply);
  const found = [...(s.match(MONEY) ?? []), ...(s.match(TIME) ?? [])];
  const out = found.filter((m) => {
    const nums = [...numbersOf(m)];
    if (!nums.length) return false;
    // "09:40" is checked as itself and as "9:40"; money as its number.
    if (/^\d{1,2}:\d{2}$/.test(m)) return !toolText.includes(m) && !toolText.includes(m.padStart(5, "0")) && !toolText.includes(m.replace(/^0/, ""));
    return nums.some((n) => !known.has(n));
  });
  const flat = toolText.replace(/\s+/g, "");
  const lower = toolText.toLowerCase();
  for (const m of s.matchAll(FLIGHT_NO)) if (!NOT_CARRIER.has(m[1]!) && !flat.includes(`${m[1]}${m[2]}`)) out.push(m[0]);
  for (const m of s.matchAll(RATING)) { const n = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\.0+$/, ""); if (n && !known.has(n)) out.push(m[0]); }
  for (const m of s.matchAll(AIRLINES)) if (!lower.includes(m[0].toLowerCase())) out.push(m[0]);
  for (const m of s.matchAll(HOTEL_BRANDS)) if (!lower.includes(m[0].toLowerCase())) out.push(m[0]);
  for (const m of s.matchAll(HOTEL_PHRASE)) {
    const words = (m[1] ?? m[2] ?? "").trim().split(/\s+/).filter((w) => w && !NOT_NAME.has(w.toLowerCase()));
    if (words.length && !words.every((w) => lower.includes(w.toLowerCase()))) out.push(m[0].trim());
  }
  return out;
}

/** Banned words (English and Arabic) in a reply. */
export const outgoingProblems = (reply: string): string[] => [...bannedIn(reply), ...arBannedIn(reply)];

/** The mechanics COPY.md §4 fixes without asking: no exclamation marks, no em dashes, no emoji. */
export const tidy = (delta: string) => delta.replace(/[!！]/g, ".").replace(/\s?—\s?/g, ", ").replace(/\p{Extended_Pictographic}️?/gu, "");

/** Questions asked in a reply (the evals hold it to one). */
export const questionsIn = (reply: string) => (reply.match(/[?؟]/g) ?? []).length;

/*
 * Never open-ended (docs/app/ASSISTANT.md §1 "Always resolve"): the closers a reply must not end on, and the preambles
 * it must not start with. The chips take a closer's place. A closer is a sentence that hands the next step back to the
 * traveller without giving one: "Let us know which you prefer or if you'd like other dates.", "Feel free to ask.",
 * "Just say the word.", «خبرنا إذا تبي تواريخ ثانية». A sentence with content stays: "If you'd like a sea view, the
 * Address Sky View has one." names something (a capitalised name or a number), so it is kept.
 */
const AR_TELL = "(?:خبّرنا|خبرنا|خبروني|قول(?:ي)? لنا|قل لنا|علّمنا|علمنا|بلّغنا|بلغنا)";
const EN_CLOSE = String.raw`let (?:me|us) know|feel free(?: to)?|just (?:say|tell us|let us know)(?: the word)?|say the word|tell (?:me|us) (?:which|what you(?:'d| would)? (?:like|prefer)|if|whether|when you(?:'re| are) ready)|anything else|how (?:else )?can (?:i|we) help|hope (?:this|that) helps|don'?t hesitate|we'?re here (?:if|whenever|when)`;
const OPEN_ENDED = new RegExp(String.raw`\b(?:${EN_CLOSE})\b|أي خدمة (?:ثانية|أخرى)|هل (?:من|هناك) خدمة|تبي شي ثاني|تبغى شي ثاني|في شي ثاني|أي شي ثاني|تأمر(?:ني)? على شي|لا تتردد|كيف (?:يمكنني|أقدر|نقدر) (?:أساعدك|نساعدك|مساعدتك)|${AR_TELL}(?=\s+(?:أي|وش|إذا|اذا|لو|متى|بس)|\s*[.؟?،]|\s*$)`, "i");
/** At the start of a sentence: it only closes the reply. */
const CLOSER = new RegExp(String.raw`^\s*(?:(?:and |so |or )?(?:is there )?(?:${EN_CLOSE})\b|(?:هل )?(?:في|فيه)? ?(?:أي خدمة (?:ثانية|أخرى)|شي ثاني)|تبي شي ثاني|تبغى شي ثاني|تأمر(?:ني)? على شي|لا تتردد|هل (?:من|هناك) خدمة|(?:و|ف)?${AR_TELL}(?=\s+(?:أي|وش|إذا|اذا|لو|متى|بس)|\s*[.؟?،]|\s*$))`, "i");
/** "If you'd like other dates, just ask." Kept when it names something: a number, or a capitalised name after the start. */
const IF_LIKE = /^\s*(?:if you(?:'d| would)? (?:like|want|prefer|rather)|should you (?:want|like|prefer)|whenever you(?:'re| are) ready|if (?:you need|there'?s) anything)\b/i;
const AR_IF_LIKE = new RegExp(String.raw`^\s*(?:و)?(?:إذا|اذا|لو)\s+(?:تبي|تبغى|حاب|حابب|ودك)(?=\s).*${AR_TELL}`);
const namesSomething = (s: string) => /\d/.test(s) || /\s[A-Z][a-z]/.test(s.trim().slice(1).replace(/\b(?:I|I'd|I'm|Mada)\b/g, ""));
/** A sentence that only closes the reply without a next step ("Anything else?", "Let us know if…"): dropped. */
export const isCloser = (sentence: string) => {
  const s = sentence.trim();
  if (CLOSER.test(s)) return true;
  if (AR_IF_LIKE.test(s)) return true;
  return IF_LIKE.test(s) && !namesSomething(s);
};
/** A closing clause after real content ("Three ways to go, let us know which you prefer."): cut, the content kept. */
const CLOSING_CLAUSE = new RegExp(String.raw`(?:\s*[,،;]\s*(?:(?:and|or|so) |و)?|\s+(?:and|or|so)\s+|\s+و)(?:(?:${EN_CLOSE})\b|${AR_TELL}|if you(?:'d| would)? (?:like|want|prefer)\b(?=[^A-Z\d]*$))[^.?؟]*(?=[.?؟]?\s*$)`, "i");
export function trimCloser(sentence: string): string {
  const m = CLOSING_CLAUSE.exec(sentence);
  if (!m || m.index === 0) return sentence;
  const end = /[.?؟]?\s*$/.exec(sentence.slice(m.index + m[0].length))![0];
  const trail = /\s*$/.exec(end)![0];
  return `${sentence.slice(0, m.index)}${end.trim() && end.trim() !== "?" && end.trim() !== "؟" ? end.trim() : "."}${trail}`;
}
/** Open-ended phrases anywhere in a reply (the evals hold every reply to none). */
export const openEndedIn = (reply: string): string[] => { const m = OPEN_ENDED.exec(reply); return m ? [m[0]] : []; };
const PREAMBLE = /^\s*(?:great|good|excellent) question|^\s*(?:sure|of course|absolutely|certainly|definitely|happy to help|thanks for (?:asking|your message)|i understand)\b|^\s*(?:سؤال (?:حلو|رائع|جميل|ممتاز)|بكل سرور|بالتأكيد|أكيد[،,]|يسعدني|شكرًا على سؤالك)/i;
/** The reply's first sentence: a preamble, or a question (before any answer). */
export function firstSentence(reply: string): { text: string; preamble: boolean; question: boolean } {
  const text = (reply.trim().split(/(?<=[.?؟\n])\s/)[0] ?? "").trim();
  return { text, preamble: PREAMBLE.test(text), question: /[?؟]\s*$/.test(text) };
}
