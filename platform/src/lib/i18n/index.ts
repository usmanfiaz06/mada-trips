import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { AR } from "./ar";

export type Locale = "en" | "ar";
export const LOCALE_COOKIE = "mada_locale";

export const getLocale = cache(async (): Promise<Locale> => {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return v === "ar" ? "ar" : "en";
});

/** English text is the key; Arabic comes from the dictionary. `{name}` placeholders are filled from vars. */
export function translate(locale: Locale, text: string, vars?: Record<string, string | number>) {
  let s = locale === "ar" ? AR[text] ?? text : text;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export async function getT() {
  const locale = await getLocale();
  const t = (text: string, vars?: Record<string, string | number>) => translate(locale, text, vars);
  return Object.assign(t, { locale });
}
export type T = Awaited<ReturnType<typeof getT>>;
