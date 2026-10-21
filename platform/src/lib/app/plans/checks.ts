import { ENTRY_RULES, addDays, nationalityOf, type Person, type PlanCheck, type PlanItemStatus } from "@mada/shared";

/*
 * Whole-trip checks (ASK-INTEGRATED §3.4): computed from the plan, the travellers on file and the bookings, never typed.
 * They never block; they're the plan's to-do list. Pure, so the read and the tests run the same code. Entry rules come
 * from the shared rule table (ENTRY_RULES, what checkEntry uses); a country it doesn't know is "unknown", never "fine".
 */

export type CheckItem = { kind: string; mode: string | null; day: number | null; nights: number | null; status: PlanItemStatus };
export type CheckInput = {
  startDate: string;
  endDate: string;
  days: number;
  items: CheckItem[];
  travellers: Person[];
  /** ISO 3166-1 alpha-2 of each country the route visits (stops, not the origin). */
  countries: string[];
  originCountry: string | null;
  esims: { status: string }[];
  /** The traveller said they need no hotel (family, own flat): app_trip_facts.no_stay. */
  noStay: boolean;
};

const live = (s: PlanItemStatus) => s !== "skipped" && s !== "cancelled";
const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const human = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const firstName = (p: Person) => p.firstName || p.givenNames.split(" ")[0] || "Traveller";

/** "2", "2–4", "1, 3": 1-based for people, from 0-based numbers. */
export function ranges(nums: number[]): string {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j]! + 1) j++;
    out.push(i === j ? `${s[i]! + 1}` : `${s[i]! + 1}–${s[j]! + 1}`);
    i = j;
  }
  return out.join(", ");
}

export function computeChecks(input: CheckInput): PlanCheck[] {
  const out: PlanCheck[] = [];
  const foreign = [...new Set(input.countries)].filter((c) => c && c !== (input.originCountry ?? "SA") && !ENTRY_RULES[c]?.domestic);

  // Passports: valid for what each country on the route asks (days after arrival), else the trip's end + 6 months.
  if (foreign.length) {
    const need = foreign.map((c) => (ENTRY_RULES[c]?.passportDays ? addDays(input.startDate, ENTRY_RULES[c]!.passportDays!) : addMonths(input.endDate, 6))).sort().at(-1)!;
    const missing = input.travellers.filter((p) => !p.passport?.expiry);
    const short = input.travellers.filter((p) => p.passport?.expiry && p.passport.expiry < need);
    if (!input.travellers.length) out.push({ key: "passports", state: "unknown", text: "Add who's going to check passports.", who: [], nights: [], days: [] });
    else if (short.length) out.push({ key: "passports", state: "warn", who: short.map((p) => p.id), nights: [], days: [], text: short.map((p) => `${firstName(p)}'s passport expires ${human(p.passport!.expiry!)}; it needs to be valid to ${human(need)}.`).join(" ") });
    else if (missing.length) out.push({ key: "passports", state: "todo", who: missing.map((p) => p.id), nights: [], days: [], text: `No passport on file for ${missing.map(firstName).join(", ")}.` });
    else out.push({ key: "passports", state: "ok", text: `Passports valid to ${human(need)} or later.`, who: [], nights: [], days: [] });
  }

  // Visa and entry, per nationality and country, from the rule table only.
  if (foreign.length) {
    const needs: string[] = [];
    const who = new Set<string>();
    let unknown = false;
    for (const c of foreign) {
      const rule = ENTRY_RULES[c];
      if (!rule) { unknown = true; continue; }
      for (const p of input.travellers) {
        const nat = nationalityOf(p);
        const r = nat === "SAU" ? rule.SAU : nat === "PHL" ? rule.PHL : undefined;
        if (!r) { unknown = true; continue; }
        const visa = (r as { need?: string }).need;
        if (visa) { needs.push(`${firstName(p)}: ${visa}`); who.add(p.id); } else if ((r as { eta?: boolean }).eta) { needs.push(`${firstName(p)}: ${rule.name} ETA`); who.add(p.id); }
      }
    }
    if (needs.length) out.push({ key: "visa", state: "todo", text: needs.join(" · "), who: [...who], nights: [], days: [] });
    else if (unknown || !input.travellers.length) out.push({ key: "visa", state: "unknown", text: "Entry rules need checking for this route.", who: [], nights: [], days: [] });
    else out.push({ key: "visa", state: "ok", text: "No visa needed.", who: [], nights: [], days: [] });
  }

  // Stays: every night between the first day and the last is covered, or "no stay needed".
  const nights = Math.max(0, input.days - 1);
  if (nights > 0) {
    const covered = new Set<number>();
    for (const it of input.items) {
      if (it.kind !== "stay" || it.day == null || !live(it.status)) continue;
      for (let n = 0; n < (it.nights ?? 1); n++) covered.add(it.day + n);
    }
    const gaps = Array.from({ length: nights }, (_, i) => i).filter((n) => !covered.has(n));
    const booked = input.items.filter((i) => i.kind === "stay" && (i.status === "booked" || i.status === "confirmed")).length;
    if (input.noStay) out.push({ key: "stays", state: "ok", text: "No stay needed.", who: [], nights: [], days: [] });
    else if (gaps.length) out.push({ key: "stays", state: "todo", text: `${gaps.length === 1 ? "Night" : "Nights"} ${ranges(gaps)}: no stay yet.`, who: [], nights: gaps, days: [] });
    else out.push({ key: "stays", state: booked ? "ok" : "todo", text: booked ? "Every night has a stay." : "Every night has a stay planned; none booked yet.", who: [], nights: [], days: [] });
  }

  // Car: the days with a drive that no car (rental or driver) covers.
  const driveDays = input.items.filter((i) => i.kind === "leg" && i.mode === "drive" && i.day != null && live(i.status)).map((i) => i.day!);
  if (driveDays.length) {
    const carDays = new Set<number>();
    for (const it of input.items) {
      if (it.kind !== "car" || it.day == null || !live(it.status)) continue;
      for (let d = it.day; d <= it.day + (it.nights ?? 0); d++) carDays.add(d);
    }
    const need = [...new Set(driveDays)].filter((d) => !carDays.has(d));
    out.push(need.length
      ? { key: "car", state: "todo", text: `Car needed ${need.length === 1 ? "day" : "days"} ${ranges(need)}.`, who: [], nights: [], days: need.sort((a, b) => a - b) }
      : { key: "car", state: "ok", text: "A car for every drive.", who: [], nights: [], days: [] });
  }

  // eSIM: abroad only; bought for this trip, installed, or not yet.
  if (foreign.length) {
    const live = input.esims.filter((e) => !["refunded", "expired", "used_up"].includes(e.status));
    const installed = live.some((e) => e.status === "installed" || e.status === "active");
    out.push(installed ? { key: "esim", state: "ok", text: "eSIM installed.", who: [], nights: [], days: [] }
      : live.length ? { key: "esim", state: "ok", text: "eSIM bought.", who: [], nights: [], days: [] }
      : { key: "esim", state: "none", text: "No eSIM yet.", who: [], nights: [], days: [] });
  }
  return out;
}
