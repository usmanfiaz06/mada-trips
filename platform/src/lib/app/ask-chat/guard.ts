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

/**
 * Prices and times in a reply that no tool returned this turn: each must appear, as a number, in the tool results.
 * An empty list means the reply only says what the tools said.
 */
export function unbacked(reply: string, toolText: string): string[] {
  const known = numbersOf(toolText);
  const s = normalizeDigits(reply);
  const found = [...(s.match(MONEY) ?? []), ...(s.match(TIME) ?? [])];
  return found.filter((m) => {
    const nums = [...numbersOf(m)];
    if (!nums.length) return false;
    // "09:40" is checked as itself and as "9:40"; money as its number.
    if (/^\d{1,2}:\d{2}$/.test(m)) return !toolText.includes(m) && !toolText.includes(m.padStart(5, "0")) && !toolText.includes(m.replace(/^0/, ""));
    return nums.some((n) => !known.has(n));
  });
}

/** Banned words (English and Arabic) in a reply. */
export const outgoingProblems = (reply: string): string[] => [...bannedIn(reply), ...arBannedIn(reply)];

/** The mechanics COPY.md §4 fixes without asking: no exclamation marks, no em dashes, no emoji. */
export const tidy = (delta: string) => delta.replace(/[!！]/g, ".").replace(/\s?—\s?/g, ", ").replace(/\p{Extended_Pictographic}️?/gu, "");

/** Questions asked in a reply (the evals hold it to one). */
export const questionsIn = (reply: string) => (reply.match(/[?؟]/g) ?? []).length;

/*
 * Never open-ended (docs/app/ASSISTANT.md §1 "Always resolve"): the closers a reply must not end on, and the preambles
 * it must not start with. The chips take a closer's place.
 */
const OPEN_ENDED = /\b(?:anything else|how (?:else )?can (?:i|we) help|let (?:me|us) know|feel free to|hope (?:this|that) helps|don'?t hesitate)\b|أي خدمة (?:ثانية|أخرى)|هل (?:من|هناك) خدمة|تبي شي ثاني|تبغى شي ثاني|في شي ثاني|أي شي ثاني|تأمر(?:ني)? على شي|لا تتردد|كيف (?:يمكنني|أقدر|نقدر) (?:أساعدك|نساعدك|مساعدتك)/i;
/** A sentence that only closes the reply without a next step ("Anything else?", "Let us know if…"): dropped. */
const CLOSER = /^\s*(?:(?:is there )?anything else\b|how (?:else )?can (?:i|we) help\b|let (?:me|us) know (?:if|when|whether)\b|feel free\b|hope (?:this|that) helps\b|don'?t hesitate\b|(?:هل )?(?:في|فيه)? ?(?:أي خدمة (?:ثانية|أخرى)|شي ثاني)|تبي شي ثاني|تبغى شي ثاني|تأمر(?:ني)? على شي|لا تتردد|هل (?:من|هناك) خدمة)/i;
export const isCloser = (sentence: string) => CLOSER.test(sentence.trim());
/** Open-ended phrases anywhere in a reply (the evals hold every reply to none). */
export const openEndedIn = (reply: string): string[] => { const m = OPEN_ENDED.exec(reply); return m ? [m[0]] : []; };
const PREAMBLE = /^\s*(?:great|good|excellent) question|^\s*(?:sure|of course|absolutely|certainly|definitely|happy to help|thanks for (?:asking|your message)|i understand)\b|^\s*(?:سؤال (?:حلو|رائع|جميل|ممتاز)|بكل سرور|بالتأكيد|أكيد[،,]|يسعدني|شكرًا على سؤالك)/i;
/** The reply's first sentence: a preamble, or a question (before any answer). */
export function firstSentence(reply: string): { text: string; preamble: boolean; question: boolean } {
  const text = (reply.trim().split(/(?<=[.?؟\n])\s/)[0] ?? "").trim();
  return { text, preamble: PREAMBLE.test(text), question: /[?؟]\s*$/.test(text) };
}
