import { ENTRY_RULES } from "@mada/shared";
import fixtures from "./fixtures.json";
import type { EntryKind, EntryRequirement, EntryRulesSupplier } from "./types";

/*
 * Mock entry rules: the fixture pairs, then the built-in rules for Saudi and Philippine passports read as requirements
 * (so the mock agrees with the fallback), else nothing (null). A destination of "XX" fails, for the fallback path.
 */

const kindOf = (ok: string): EntryKind => (/on arrival/i.test(ok) ? "visa_on_arrival" : /eta/i.test(ok) ? "eta" : "visa_free");

export const mockEntryRules: EntryRulesSupplier = {
  name: "mock",
  async requirement(q) {
    if (q.destination === "XX") throw new Error("mock sherpa answered 503");
    const f = fixtures.pairs.find((p) => p.nationality === q.nationality && p.destination === q.destination);
    const base = { nationality: q.nationality, destination: q.destination, source: "mock" as const, checkedAt: null, applyUrl: null };
    if (f) return { ...base, kind: f.kind as EntryKind, name: f.name, text: f.text, maxStayDays: f.maxStayDays, passportDays: f.passportDays };
    const rule = ENTRY_RULES[q.destination];
    const r = q.nationality === "SAU" ? rule?.SAU : q.nationality === "PHL" ? rule?.PHL : undefined;
    if (!rule || rule.domestic || !r) return null;
    const need = (r as { need?: string }).need;
    const text = (r as { text?: string; ok?: string }).text ?? (r as { ok?: string }).ok ?? "";
    const out: EntryRequirement = need
      ? { ...base, kind: /e-?visa/i.test(need) ? "evisa" : "visa_required", name: need, text, maxStayDays: null, passportDays: rule.passportDays ?? null }
      : { ...base, kind: (r as { eta?: boolean }).eta ? "eta" : kindOf(text), name: (r as { eta?: boolean }).eta ? "UK ETA" : null, text, maxStayDays: null, passportDays: rule.passportDays ?? null };
    return out;
  },
};
