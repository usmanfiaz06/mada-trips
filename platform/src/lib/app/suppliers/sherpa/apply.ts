import { nationalityOf, personName, t, type EntryCheck, type EntryCheckResponse, type Person } from "@mada/shared";
import { entryRequirement } from "./cache";
import type { EntryRequirement, EntryRulesSupplier } from "./types";

/*
 * The supplier's answer over the built-in one, traveller by traveller: where it has a requirement for someone's
 * passport, that replaces the visa line the rules wrote (or the "we check by hand" line for a passport the rules don't
 * know). Passport validity, iqama, re-entry and the household's UK ETA line stay as the rules wrote them. No answer
 * (not covered, down, not configured): the rules' lines stay. Answers already given ("has it", "asked Mada") count.
 */
export async function withEntryRequirements(
  s: EntryRulesSupplier,
  resp: EntryCheckResponse,
  input: { country: string; travellers: Person[]; depart: string; return: string | null; answers: Record<string, string>; language?: "en" | "ar" },
): Promise<EntryCheckResponse> {
  if (resp.domestic) return resp;
  const nats = [...new Set(input.travellers.map(nationalityOf).filter((n): n is string => !!n))];
  const found = new Map<string, EntryRequirement>();
  await Promise.all(nats.map(async (n) => {
    const r = await entryRequirement(s, { nationality: n, destination: input.country, depart: input.depart, return: input.return, language: input.language });
    if (r && r.kind !== "unknown") found.set(n, r);
  }));
  if (!found.size) return resp;
  let checks = [...resp.checks];
  const hasEta = checks.some((c) => c.key === "eta");
  const base = { done: false, info: false, title: null, need: null, answerKey: null, service: null } as const;
  for (const p of input.travellers) {
    const r = found.get(nationalityOf(p) ?? "");
    if (!r) continue;
    const name = personName(p);
    const removable = !p.isSelf || input.travellers.length > 1;
    checks = checks.filter((c) => !(c.personId === p.id && (c.key === "visa" || c.key === "manual")));
    if (r.kind === "visa_free" || r.kind === "visa_on_arrival" || (r.kind === "eta" && hasEta)) continue;
    const need = r.name ?? "visa";
    const country = resp.countryName;
    const k = `${p.id}:${input.country}:visa`;
    let check: EntryCheck;
    if (r.kind === "not_allowed") {
      check = { ...base, personId: p.id, name, key: "visa", blocking: true, removable, title: t("entry.visa.title", { name, country }), text: r.text.replace("{name}", name) };
    } else if (input.answers[k]) {
      check = { ...base, personId: p.id, name, key: "visa", blocking: false, done: true, removable, text: input.answers[k] === "has" ? t("entry.visa.has", { name, need }) : t("entry.visa.asked", { name, need }) };
    } else {
      check = { ...base, personId: p.id, name, key: "visa", blocking: true, removable, service: "evisa", title: t("entry.visa.title", { name, country }), text: r.text.replace("{name}", name), need, answerKey: k };
    }
    checks.push(check);
  }
  // One line per person, in the order the rules use: their checks together, the household's ETA first.
  const order = new Map(input.travellers.map((p, i) => [p.id, i]));
  checks.sort((a, b) => (a.personId === b.personId ? 0 : a.personId === null ? -1 : b.personId === null ? 1 : (order.get(a.personId) ?? 0) - (order.get(b.personId) ?? 0)));
  const free = [...found.values()].find((r) => r.kind === "visa_free" || r.kind === "visa_on_arrival");
  return { ...resp, checks, blocking: checks.filter((c) => c.blocking).length, okText: !checks.length ? resp.okText ?? free?.text ?? null : null };
}
