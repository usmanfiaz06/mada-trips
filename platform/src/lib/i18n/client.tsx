"use client";
import { createContext, useContext, useCallback } from "react";

type Ctx = { locale: "en" | "ar"; dict: Record<string, string> };
const I18nCtx = createContext<Ctx>({ locale: "en", dict: {} });

export function I18nProvider({ locale, dict, children }: Ctx & { children: React.ReactNode }) {
  return <I18nCtx.Provider value={{ locale, dict }}>{children}</I18nCtx.Provider>;
}

export function useT() {
  const { locale, dict } = useContext(I18nCtx);
  const t = useCallback((text: string, vars?: Record<string, string | number>) => {
    let s = locale === "ar" ? dict[text] ?? text : text;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  }, [locale, dict]);
  return Object.assign(t, { locale });
}
