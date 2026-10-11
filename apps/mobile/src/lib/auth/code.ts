/**
 * The six digits out of whatever was typed or pasted: a whole message pasted ("123456 is your Mada Trips code…") gives
 * its 6-digit run, a code pasted over a half-typed one replaces it, and typing just adds digits.
 */
export function codeFrom(raw: string, previous = ''): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= 6) return digits;
  const runs = [...raw.matchAll(/(^|\D)(\d{6})(?!\d)/g)].map((m) => m[2]!);
  if (runs.length) return runs[runs.length - 1]!;
  return raw.length - previous.length > 1 ? digits.slice(-6) : digits.slice(0, 6);
}
