import { afterEach, describe, expect, it, vi } from "vitest";
import { EntryCheckResponse, entryChecks, type Person } from "@mada/shared";
import { clearEntryRulesCache, entryRequirement, entryRulesSupplier, withEntryRequirements } from "@/lib/app/suppliers/sherpa";
import { mockEntryRules } from "@/lib/app/suppliers/sherpa/mock";
import { parseTrip, tripBody } from "@/lib/app/suppliers/sherpa/sherpa";
import { resetBreakers } from "@/lib/app/resilience/breaker";

/* Sherpa behind the entry check: the switch, the fixtures, the parser, and the merge over the built-in rules. */

const person = (id: string, firstName: string, nationality: string | null, isSelf = false): Person => ({
  id, isSelf, givenNames: firstName, surname: "Test", firstName, relation: isSelf ? "self" : "spouse", dateOfBirth: "1990-01-01", sex: null, nationality, passport: null, createdAt: "2026-01-01T00:00:00Z",
});
const P = {
  sara: person("00000000-0000-4000-8000-000000000001", "Sara", "SAU", true),
  priya: person("00000000-0000-4000-8000-000000000002", "Priya", "IND"),
  tom: person("00000000-0000-4000-8000-000000000003", "Tom", "GBR"),
};
const rulesFor = (destination: string, travellers: Person[], answers: Record<string, string> = {}) =>
  entryChecks({ destination, travellers, depart: "2027-03-09", return: "2027-03-15", answers, today: "2026-10-21" });

afterEach(() => {
  for (const k of ["SUPPLIER_MODE_SHERPA", "SHERPA_API_KEY"]) delete process.env[k];
  vi.unstubAllGlobals();
  clearEntryRulesCache();
  resetBreakers();
});

describe("switch", () => {
  it("is off by default (the rules answer alone), mock when asked, Sherpa with the key", () => {
    expect(entryRulesSupplier()).toBeNull();
    process.env.SUPPLIER_MODE_SHERPA = "mock";
    expect(entryRulesSupplier()?.name).toBe("mock");
    delete process.env.SUPPLIER_MODE_SHERPA;
    process.env.SHERPA_API_KEY = "k";
    expect(entryRulesSupplier()?.name).toBe("sherpa");
  });
});

describe("merge over the built-in rules", () => {
  it("replaces 'we check by hand' with Sherpa's visa line for a passport the rules don't know", async () => {
    const rules = rulesFor("istanbul", [P.sara, P.priya]);
    expect(rules.checks.find((c) => c.personId === P.priya.id)?.key).toBe("manual");
    const out = EntryCheckResponse.parse(await withEntryRequirements(mockEntryRules, rules, { country: "TR", travellers: [P.sara, P.priya], depart: "2027-03-09", return: "2027-03-15", answers: {} }));
    const visa = out.checks.find((c) => c.personId === P.priya.id && c.key === "visa")!;
    expect(visa).toMatchObject({ blocking: true, need: "Türkiye visa", service: "evisa", answerKey: `${P.priya.id}:TR:visa` });
    expect(visa.text).toMatch(/^Priya needs a Türkiye visa/);
    expect(out.checks.some((c) => c.key === "manual")).toBe(false);
    // Priya's re-entry visa (a resident) stays as the rules wrote it.
    expect(out.checks.filter((c) => c.blocking).map((c) => c.key).sort()).toEqual(["reentry", "visa"]);
    expect(out.blocking).toBe(2);
  });
  it("counts an answer already given, and visa-free clears the line", async () => {
    const ans = { [`${P.priya.id}:TR:visa`]: "has" };
    const out = await withEntryRequirements(mockEntryRules, rulesFor("istanbul", [P.sara, P.priya], ans), { country: "TR", travellers: [P.sara, P.priya], depart: "2027-03-09", return: null, answers: ans });
    expect(out.checks.find((c) => c.personId === P.priya.id && c.key === "visa")).toMatchObject({ done: true, blocking: false });
    const gb = await withEntryRequirements(mockEntryRules, rulesFor("istanbul", [P.tom]), { country: "TR", travellers: [P.tom], depart: "2027-03-09", return: null, answers: {} });
    expect(gb.checks.map((c) => c.key)).toEqual(["reentry"]);
    const alone = await withEntryRequirements(mockEntryRules, { ...rulesFor("istanbul", [P.tom]), checks: [], blocking: 0, okText: null }, { country: "TR", travellers: [P.tom], depart: "2027-03-09", return: null, answers: {} });
    expect(alone.okText).toBe("Visa-free for 90 days.");
  });
  it("agrees with the rules for Saudi passports, and keeps them when Sherpa fails", async () => {
    const rules = rulesFor("istanbul", [P.sara]);
    expect(await withEntryRequirements(mockEntryRules, rules, { country: "TR", travellers: [P.sara], depart: "2027-03-09", return: null, answers: {} })).toEqual(rules);
    const fallback = rulesFor("istanbul", [P.priya]);
    expect(await withEntryRequirements(mockEntryRules, fallback, { country: "XX", travellers: [P.priya], depart: "2027-03-09", return: null, answers: {} })).toEqual(fallback);
  });
});

describe("Sherpa v3", () => {
  it("sends one trip from Saudi Arabia in alpha-3", () => {
    const b = tripBody({ nationality: "IND", destination: "TR", depart: "2027-03-09", return: "2027-03-15" }, "TUR");
    expect(b.data.attributes.travelNodes.map((n) => n.locationCode)).toEqual(["SAU", "TUR"]);
    expect(b.data.attributes.travellers[0]!.nationality).toBe("IND");
  });
  it("keeps the most demanding visa procedure and the passport validity", () => {
    const q = { nationality: "IND", destination: "TR", depart: "2027-03-09", return: null };
    const r = parseTrip({ included: [
      { type: "PROCEDURE", attributes: { category: "VISA", subCategory: "EVISA", title: "Türkiye e-Visa", description: "<p>Apply online.</p>", durationStay: { value: 30, unit: "DAY" }, actions: [{ url: "https://www.evisa.gov.tr" }], lastUpdatedAt: "2026-10-01T00:00:00Z" } },
      { type: "PROCEDURE", attributes: { category: "VISA", subCategory: "EMBASSY_VISA", title: "Türkiye visa", description: "From the consulate." } },
      { type: "PROCEDURE", attributes: { category: "PASSPORT", subCategory: "PASSPORT_VALIDITY", documentValidity: { value: 5, unit: "MONTHS" } } },
      { type: "RESTRICTION", attributes: { category: "VISA" } },
    ] }, q);
    expect(r).toMatchObject({ kind: "visa_required", name: "Türkiye visa", passportDays: 150, source: "sherpa" });
    expect(parseTrip({ included: [] }, q)).toBeNull();
  });
  it("asks Sherpa once per pair and month through the breaker", async () => {
    process.env.SHERPA_API_KEY = "sk";
    const f = vi.fn(async (url: string) => {
      expect(url).toContain("key=sk");
      return new Response(JSON.stringify({ included: [{ type: "PROCEDURE", attributes: { category: "VISA", subCategory: "VISA_FREE", title: "No visa", description: "Visa-free for 90 days." } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", f);
    const s = entryRulesSupplier()!;
    const q = { nationality: "GBR", destination: "TR", depart: "2027-03-09", return: null };
    expect(await entryRequirement(s, q)).toMatchObject({ kind: "visa_free" });
    await entryRequirement(s, { ...q, depart: "2027-03-20" });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
