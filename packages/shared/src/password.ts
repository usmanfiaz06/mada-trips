/* No zod here, so the prototype can import it too (docs/app/prototype-app). */

/** Passwords are optional; when someone sets one it has at least this many characters (Supabase's minimum too). */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * What Supabase checks (Authentication › Providers › Email › Password requirements), as a live checklist. Keep it in
 * step with the dashboard: change a rule here and every Set, Change and Reset password screen follows. Supabase also
 * refuses passwords found in data leaks (Have I Been Pwned), which only it can check.
 */
export const PASSWORD_RULES = [
  { id: 'length', copy: 'auth.password.rule.length', test: (p: string) => [...p].length >= PASSWORD_MIN_LENGTH },
  { id: 'lower', copy: 'auth.password.rule.lower', test: (p: string) => /\p{Ll}/u.test(p) },
  { id: 'upper', copy: 'auth.password.rule.upper', test: (p: string) => /\p{Lu}/u.test(p) },
  { id: 'digit', copy: 'auth.password.rule.digit', test: (p: string) => /\d/.test(p) },
  { id: 'symbol', copy: 'auth.password.rule.symbol', test: (p: string) => /[^\p{L}\p{N}\s]/u.test(p) },
] as const;
export type PasswordRuleId = (typeof PASSWORD_RULES)[number]['id'];

/** Each rule, passed or not, in order. */
export const passwordChecks = (p: string) => PASSWORD_RULES.map((r) => ({ id: r.id, copy: r.copy, ok: r.test(p) }));
export const passwordMeetsRules = (p: string) => PASSWORD_RULES.every((r) => r.test(p));
