import { AIRPORT_NAMES, DESTINATIONS, MONTHS, MONTHS_AR, nameIn, rangeLabel, t, type AskIntent } from "@mada/shared";
import { redact } from "./guard";

/*
 * A chat's title (docs/app/ASK-INTEGRATED.md §2.3), written on the server after each turn in the chat's language until
 * the traveller renames it. Strongest first:
 *   trip   the attached trip: "AlUla · 20–22 Nov" (U2 adds the start: "Riyadh → AlUla · 20–22 Nov")
 *   route  start and destination read from the words: "Riyadh → Istanbul · 3–9 Dec"
 *   place  what it's about and where: "eSIM for Pakistan", "Flights to Istanbul"
 *   words  the first six words, redacted
 * A later turn only ever makes it stronger, so a chat about AlUla never turns into a chat about the hotel in its third
 * message. Only what was read or booked goes into a title: never a guess.
 */

export type TitleBy = "words" | "place" | "route" | "trip" | "traveller";
const RANK: Record<TitleBy, number> = { words: 1, place: 2, route: 3, trip: 4, traveller: 9 };

type Lang = "en" | "ar";
export type TitleTrip = { city: string; startDate: string; endDate: string | null };

const place = (name: string, lang: Lang) => nameIn(name, lang);

/** The destination's name as said, for a title. Null when nothing was named. */
export function placeOf(i: Pick<AskIntent, "destination" | "destinationName">): string | null {
  if (i.destinationName && i.destinationName.trim()) return i.destinationName.trim();
  if (i.destination && i.destination !== "other") return DESTINATIONS[i.destination]?.name ?? null;
  return null;
}

/** "20–22 Nov", "28 Nov – 3 Dec", "Dec" (a month only), or null. Digits follow the app's setting (ARABIC.md). */
export function datesOf(a: string | null, b: string | null, month: { month: number } | null, lang: Lang): string | null {
  if (a) return rangeLabel(a, b, lang);
  if (month) return (lang === "ar" ? MONTHS_AR : MONTHS)[month.month - 1] ?? null;
  return null;
}

const join = (main: string, dates: string | null) => (dates ? `${main} · ${dates}` : main);

/** The title this turn would give, and how strong it is. */
export function titleFrom(o: { intent: AskIntent | null; trip: TitleTrip | null; words: string; lang: Lang }): { title: string; by: TitleBy } | null {
  const { intent: i, trip, lang } = o;
  if (trip) return { title: join(place(trip.city, lang), datesOf(trip.startDate, trip.endDate, null, lang)), by: "trip" };
  const to = i ? placeOf(i) : null;
  if (i && to) {
    const dates = datesOf(i.depart, i.return, i.monthOnly, lang);
    const from = i.from ? AIRPORT_NAMES[i.from] ?? null : null;
    if (from && from !== to && (i.kind === "flight" || i.kind === "plan" || i.kind === "general")) {
      return { title: join(t("chat.title.route", { from: place(from, lang), to: place(to, lang) }, lang), dates), by: "route" };
    }
    const key = ({ flight: "chat.title.flight", stay: "chat.title.stay", plan: "chat.title.plan", esim: "chat.title.esim", visa: "chat.title.visa", car: "chat.title.car", food: "chat.title.food", todo: "chat.title.todo" } as const)[i.kind as "flight"];
    const main = key ? t(key, { place: place(to, lang) }, lang) : place(to, lang);
    return { title: join(main, i.kind === "esim" || i.kind === "visa" ? null : dates), by: "place" };
  }
  if (i?.kind === "umrah") return { title: join(t("chat.title.umrah", undefined, lang), datesOf(i.depart, i.return, i.monthOnly, lang)), by: "place" };
  const words = redact(o.words).text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return null;
  const head = words.slice(0, 6).join(" ").replace(/[.,!?؟،]+$/, "");
  return { title: words.length > 6 ? `${head}…` : head, by: "words" };
}

/** The new title, or null to keep what's there: never over a rename, never weaker or sideways. */
export function nextTitle(current: { title: string | null; by: string | null }, cand: { title: string; by: TitleBy } | null): { title: string; by: TitleBy } | null {
  if (!cand) return null;
  const was = (current.by ?? "") as TitleBy;
  if (was === "traveller") return null;
  if (!current.title) return cand;
  const before = RANK[was] ?? 0;
  // The trip's own title follows the trip (its dates can move); anything else only climbs.
  if (cand.by === "trip" && was === "trip") return cand.title === current.title ? null : cand;
  return RANK[cand.by] > before ? cand : null;
}

/** The list's preview: one line, redacted, ≤ 140 characters. */
export function previewOf(text: string): string | null {
  const one = redact(text).text.replace(/\s+/g, " ").trim();
  if (!one) return null;
  return one.length > 140 ? `${one.slice(0, 139)}…` : one;
}
