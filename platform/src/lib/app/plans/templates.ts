import "server-only";
import { PLANS } from "@mada/shared";
import type { PlanPlaceJson } from "@/db/app-schema-plans";

/*
 * The curated samples (PLANS in packages/shared booking-data.ts) as data a living plan is made from (ASK-INTEGRATED
 * §3.7). PLANS itself stays untouched: GET /plans keeps showing the discover cards from it. Here each stop has a kind,
 * a mode and a place, and the flights out and home are legs from and to whatever origin the plan gets: the template's
 * times and notes for those legs hold only when the trip starts where the template was written for.
 */

export type TemplateItem = {
  day: number;
  kind: "leg" | "stay" | "activity" | "meal" | "note";
  mode?: "flight" | "drive" | "ferry" | "transfer" | "walk";
  title: string;
  note?: string | null;
  at?: string | null;
  place?: PlanPlaceJson | null;
  from?: PlanPlaceJson | null;
  to?: PlanPlaceJson | null;
  nights?: number;
};

export type PlanTemplate = {
  id: string;
  title: string;
  destination: PlanPlaceJson;
  days: number;
  /** The airport the template's out and home flights were written for: their times and notes apply only from there. */
  writtenFrom: string;
  out: { at: string | null; note: string | null } | null;
  home: { day: number; at: string | null; note: string | null } | null;
  items: TemplateItem[];
};

const ALULA: PlanPlaceJson = { name: "AlUla", kind: "city", code: "ULH", city: "AlUla", country: "SA" };
const ISTANBUL: PlanPlaceJson = { name: "Istanbul", kind: "city", code: "IST", city: "Istanbul", country: "TR" };
const at = (name: string, city: PlanPlaceJson): PlanPlaceJson => ({ name, kind: "place", city: city.city, country: city.country });

/** A stop of the sample, by day and title, so the template keeps the sample's own words and times. */
function stop(id: keyof typeof PLANS & string, day: number, title: string) {
  const s = PLANS[id]!.plan[day]!.stops.find((x) => x.title === title);
  if (!s) throw new Error(`template ${id}: no stop "${title}" on day ${day + 1}`);
  return { title: s.title, note: s.note, at: s.time };
}

export const TEMPLATES: Record<string, PlanTemplate> = {
  alula2: {
    id: "alula2", title: PLANS.alula2!.title, destination: ALULA, days: 2, writtenFrom: "RUH",
    out: { at: stop("alula2", 0, "Riyadh → AlUla").at, note: stop("alula2", 0, "Riyadh → AlUla").note },
    home: { day: 1, at: stop("alula2", 1, "AlUla → Riyadh").at, note: stop("alula2", 1, "AlUla → Riyadh").note },
    items: [
      { day: 0, kind: "stay", ...stop("alula2", 0, "Check in at a desert resort"), place: at("Desert resort", ALULA), nights: 1 },
      { day: 0, kind: "activity", ...stop("alula2", 0, "AlUla Old Town"), place: at("AlUla Old Town", ALULA) },
      { day: 0, kind: "activity", ...stop("alula2", 0, "Elephant Rock at sunset"), place: at("Elephant Rock", ALULA) },
      { day: 0, kind: "meal", ...stop("alula2", 0, "Dinner under the stars"), place: null },
      { day: 1, kind: "activity", ...stop("alula2", 1, "Hegra guided tour"), place: at("Hegra", ALULA) },
      { day: 1, kind: "meal", ...stop("alula2", 1, "Lunch in the oasis"), place: null },
      { day: 1, kind: "activity", ...stop("alula2", 1, "Harrat Viewpoint"), place: at("Harrat Viewpoint", ALULA) },
    ],
  },
  istanbul3: {
    id: "istanbul3", title: PLANS.istanbul3!.title, destination: ISTANBUL, days: 3, writtenFrom: "RUH",
    // The sample has no flights: the legs come from the origin, with no time until a search finds one.
    out: { at: null, note: null },
    home: { day: 2, at: null, note: null },
    items: [
      { day: 0, kind: "stay", title: "Stay in Istanbul", note: null, at: null, place: at("Istanbul", ISTANBUL), nights: 2 },
      { day: 0, kind: "activity", ...stop("istanbul3", 0, "Topkapı Palace, skip the line"), place: at("Topkapı Palace", ISTANBUL) },
      { day: 0, kind: "meal", ...stop("istanbul3", 0, "Lunch in Sultanahmet"), place: at("Sultanahmet", ISTANBUL) },
      { day: 0, kind: "activity", ...stop("istanbul3", 0, "Bosphorus dinner cruise"), place: at("Kabataş pier", ISTANBUL) },
      { day: 1, kind: "leg", mode: "ferry", ...stop("istanbul3", 1, "Ferry to Kadıköy"), from: at("Eminönü", ISTANBUL), to: at("Kadıköy", ISTANBUL) },
      { day: 1, kind: "activity", ...stop("istanbul3", 1, "Kadıköy food walk"), place: at("Kadıköy", ISTANBUL) },
      { day: 2, kind: "activity", ...stop("istanbul3", 2, "Princes’ Islands day trip"), place: at("Princes’ Islands", ISTANBUL) },
      { day: 2, kind: "meal", ...stop("istanbul3", 2, "Künefe near Galata Tower"), place: at("Galata", ISTANBUL) },
    ],
  },
};

export const templateOf = (id: string | null | undefined): PlanTemplate | null => (id ? TEMPLATES[id] ?? null : null);
