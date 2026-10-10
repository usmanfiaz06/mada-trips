/**
 * An Arabic section: any of the English section's keys (test/copy.test.ts checks none is missing), plus Arabic's
 * extra plural forms for a counted key ("otp.wrong.two", "otp.wrong.few", "otp.wrong.zero", "otp.wrong.many").
 * Typos in key names fail the typecheck.
 */
export type ArPluralExtra = { [k: `${string}.${'zero' | 'two' | 'few' | 'many'}`]: string };
export type ArSection<T> = Partial<Record<keyof T, string>> & ArPluralExtra;
