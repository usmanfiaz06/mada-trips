/**
 * An Arabic section: any of the English section's keys (test/copy.test.ts checks none is missing), plus Arabic's
 * extra plural forms for a counted key ("otp.wrong.two", "otp.wrong.few", "otp.wrong.zero", "otp.wrong.many"), and forms for
 * keys English writes once with a number ("td.when.inWeeks.few" for "In {n} weeks").
 * Typos in key names fail the typecheck.
 */
export type ArPluralExtra = { [k: `${string}.${'zero' | 'one' | 'two' | 'few' | 'many' | 'other'}`]: string };
export type ArSection<T> = Partial<Record<keyof T, string>> & ArPluralExtra;
