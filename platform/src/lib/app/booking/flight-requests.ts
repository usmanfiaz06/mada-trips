import "server-only";
import {
  AIRPORT_NAMES, DESTINATIONS, FlightQuote, rangeLabel, t, tn,
  type BagsWanted, type FareOption, type FlightPref, type FlightQuote as FlightQuoteT,
} from "@mada/shared";

/*
 * Flights by request (APP_FLIGHTS_MODE=request, switches.ts): the request's own words, in the reader's language, and
 * the fare options a quote carries. The desk side (sending fares) is lib/app/desk/flight-quotes.ts; paying for one is
 * booking/pricing.ts (draft kind "quote" with an optionId) and booking/orders.ts; the trip is written by
 * booking/desk.ts when the desk records the PNR and ticket numbers.
 */

export type FlightSearch = {
  destination: string | null; destinationName: string | null; from: string | null; depart: string | null; return: string | null;
  cabin: "economy" | "premium" | "business" | "first" | null; carrier: string | null; flexDays?: number; bags?: BagsWanted; prefs?: FlightPref[];
};

type Details = { source?: string; askKind?: string; search?: FlightSearch | null; flightRequest?: boolean; service?: string | null };

/** A flight request from Ask (by hand or by request), as opposed to an order the booking engine made. */
export const isFlightAsk = (d: unknown): boolean => {
  const x = (d ?? {}) as Details;
  return x.source === "ask" && x.askKind === "flight" && !!x.search;
};

/** Made while flights went by request (or with the request form's answers): the desk sends fare options. */
export const isFlightRequest = (d: unknown): boolean => isFlightAsk(d) && !!(d as Details).flightRequest;

export const cityOf = (s: Pick<FlightSearch, "destination" | "destinationName">) => (s.destination && DESTINATIONS[s.destination]?.name) || s.destinationName || "";

/** "Flights to Istanbul · 10–14 Mar", in the language of whoever is reading. */
export function flightTitle(s: FlightSearch): string {
  const dates = s.depart ? (s.return ? rangeLabel(s.depart, s.return) : t("beta.fr.oneWay", { date: rangeLabel(s.depart) })) : t("request.datesLater");
  const city = cityOf(s);
  return s.carrier ? t("request.title.airlineByHand", { airline: s.carrier === "SV" ? "Saudia" : s.carrier, city, dates }) : t("request.title.flightsTo", { city, dates });
}

/** "Riyadh to Istanbul · Economy · ±3 days · One checked bag · Direct only". */
export function flightSummary(s: FlightSearch, travellers: number): string {
  const to = (s.destination && DESTINATIONS[s.destination]?.code) || s.destinationName || "";
  const parts = [t("beta.fr.route", { from: AIRPORT_NAMES[s.from ?? "RUH"] ?? s.from ?? "RUH", to: cityOf(s) || to })];
  if (travellers) parts.push(tn("beta.fr.travellers", travellers));
  if (s.cabin) parts.push(t(`cal.cabin.${s.cabin}` as never));
  if (s.flexDays !== undefined) parts.push(s.flexDays ? t("beta.fr.sum.flex", { count: s.flexDays }) : t("beta.fr.sum.exact"));
  if (s.bags) parts.push(t(`beta.fr.bags.${s.bags}` as never));
  for (const p of s.prefs ?? []) parts.push(t(`beta.fr.pref.${p}` as never));
  return parts.join(" · ");
}

/** The fare options in a quote's snapshot, checked against the shared schema (null for any other quote). */
export function flightQuoteOf(snapshot: unknown): FlightQuoteT | null {
  const s = (snapshot ?? {}) as { kind?: string; options?: unknown };
  if (s.kind !== "flight") return null;
  const p = FlightQuote.safeParse({ options: s.options });
  return p.success ? p.data : null;
}

/** The option a payment is for: the one asked for, else the first (an app that doesn't choose pays the first). */
export function pickOption(q: FlightQuoteT, optionId: string | undefined | null): FareOption | null {
  if (optionId) return q.options.find((o) => o.id === optionId) ?? null;
  return q.options[0] ?? null;
}
