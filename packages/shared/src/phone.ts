import { normalizeDigits } from './money';

/**
 * Saudi mobile numbers: +966 and 9 digits starting with 5 (FLOWS.md §1).
 * The same check runs in the app (inline hints while typing) and on the server (before any code is sent).
 */

export type PhoneProblem = 'prefix' | 'short' | 'long' | 'empty';

export type PhoneCheck =
  | { ok: true; e164: string; national: string; pretty: string }
  | { ok: false; problem: PhoneProblem; digits: string };

/** Digits after +966, from whatever was typed: "+966 50 000 4127", "0500004127", "500004127", Arabic-Indic digits. */
export function nationalDigits(input: string): string {
  return normalizeDigits(String(input ?? ''))
    .replace(/\D/g, '')
    .replace(/^00966/, '')
    .replace(/^966/, '')
    .replace(/^0/, '');
}

export function checkSaudiMobile(input: string): PhoneCheck {
  const digits = nationalDigits(input);
  if (!digits.length) return { ok: false, problem: 'empty', digits };
  if (!digits.startsWith('5')) return { ok: false, problem: 'prefix', digits };
  if (digits.length < 9) return { ok: false, problem: 'short', digits };
  if (digits.length > 9) return { ok: false, problem: 'long', digits };
  return { ok: true, e164: `+966${digits}`, national: digits, pretty: prettyPhone(`+966${digits}`) };
}

/** "+966 50 000 4127" */
export function prettyPhone(e164: string): string {
  const d = e164.replace(/^\+966/, '');
  if (!/^5\d{8}$/.test(d)) return e164;
  return `+966 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
}

/** "+966 •• ••• 4127": enough to recognise, not enough to copy. */
export function maskPhone(e164: string): string {
  const d = e164.replace(/^\+966/, '');
  if (!/^5\d{8}$/.test(d)) return e164.length > 4 ? `•••• ${e164.slice(-4)}` : e164;
  return `+966 •• ••• ${d.slice(5)}`;
}

export const E164_SAUDI_MOBILE = /^\+9665\d{8}$/;
