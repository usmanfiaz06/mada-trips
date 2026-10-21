import "server-only";
import { DESTINATIONS, type PlaceInput } from "@mada/shared";
import { AIRPORTS } from "@/lib/travel-data";
import type { PlanPlaceJson } from "@/db/app-schema-plans";

/*
 * Places on a plan, resolved from what a caller sends ("JED", "Jeddah", «جدة») against the airports we know. A place we
 * can't match stays a named place with no code: nothing is guessed (no coordinates, no airport).
 */

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();

function airport(code: string) {
  return AIRPORTS.find((a) => a.code === code) ?? null;
}

function byName(name: string) {
  const f = fold(name);
  if (!f) return null;
  if (/^[a-z]{3}$/.test(f)) {
    const a = airport(f.toUpperCase());
    if (a) return a;
  }
  const hit = AIRPORTS.find((a) => fold(a.city) === f || (a.cityAr && fold(a.cityAr) === f) || fold(a.name) === f);
  if (hit) return hit;
  const dest = Object.values(DESTINATIONS).find((d) => d.words.test(name.toLowerCase()));
  return dest ? airport(dest.code) : null;
}

export function resolvePlace(input: PlaceInput | null | undefined): PlanPlaceJson | null {
  if (!input) return null;
  const a = (input.code ? airport(input.code.toUpperCase()) : null) ?? byName(input.name);
  if (!a) return { name: input.name.trim(), kind: input.kind ?? "place", code: input.code ?? null, city: null, country: null };
  const asAirport = input.kind === "airport" || (!!input.code && input.kind !== "city");
  return { name: a.city, kind: asAirport ? "airport" : "city", code: a.code, city: a.city, country: a.country };
}

/** The same city, whatever the place's kind ("Riyadh" the city and RUH the airport are one place for legs and titles). */
export const samePlace = (a: PlanPlaceJson | null | undefined, b: PlanPlaceJson | null | undefined) =>
  !!a && !!b && ((!!a.code && a.code === b.code) || fold(a.city || a.name) === fold(b.city || b.name));

/** A place said in free text ("Flies from Riyadh", "home airport JED"): the first airport code or city we know in it. */
export function placeInText(text: string): PlanPlaceJson | null {
  const code = text.match(/\b[A-Z]{3}\b/g)?.map((c) => airport(c)).find(Boolean);
  const a = code ?? AIRPORTS.find((x) => new RegExp(`\\b${x.city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text) || (x.cityAr && text.includes(x.cityAr)));
  return a ? { name: a.city, kind: "airport", code: a.code, city: a.city, country: a.country } : null;
}
