/*
 * Events from the Ticketmaster Discovery API v2 (free key from developer.ticketmaster.com, TICKETMASTER_KEY; 5,000
 * calls a day, 5 a second). Confirmed from the public docs: GET https://app.ticketmaster.com/discovery/v2/events.json
 * with apikey, latlong, radius, unit, startDateTime/endDateTime (ISO, Z), size, sort, locale; answers
 * _embedded.events[] with id, name, url, images[], dates.start.localDate/localTime, classifications[], and
 * _embedded.venues[]. Coverage is mostly North America, Europe, Australia and the UAE; Saudi events come from the
 * desk's list. Shown as "Events from Ticketmaster"; the event's page is linked as its source, never as checkout.
 * No server-only import: tests pass a fake fetch.
 */
import type { WhatsOn } from "@mada/shared";
import type { Fetch } from "../places/wiki";
import { getJson } from "./opendata";

export const TICKETMASTER_URL = "https://app.ticketmaster.com/discovery/v2/events.json";

export function ticketmasterUrl(key: string, lat: number, lon: number, from: string, to: string): string {
  const q = new URLSearchParams({
    apikey: key, latlong: `${lat.toFixed(4)},${lon.toFixed(4)}`, radius: "40", unit: "km", startDateTime: `${from}T00:00:00Z`, endDateTime: `${to}T23:59:59Z`,
    size: "20", sort: "date,asc", locale: "*",
  });
  return `${TICKETMASTER_URL}?${q.toString()}`;
}

type TmEvent = {
  id?: string; name?: string; url?: string; images?: { url?: string; ratio?: string; width?: number }[];
  dates?: { start?: { localDate?: string; localTime?: string }; end?: { localDate?: string } };
  classifications?: { segment?: { name?: string }; genre?: { name?: string }; family?: boolean }[];
  _embedded?: { venues?: { name?: string }[] };
};

export function parseTicketmaster(data: unknown, placeId: string): WhatsOn[] {
  const evs = (data as { _embedded?: { events?: TmEvent[] } })?._embedded?.events ?? [];
  const out: WhatsOn[] = [];
  const seen = new Set<string>();
  for (const e of evs) {
    const start = e.dates?.start?.localDate;
    if (!e.id || !e.name || !start || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^[\w-]{1,80}$/.test(e.id)) continue;
    // The same show on many nights comes back many times: keep the first of each name.
    const key = e.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const img = (e.images ?? []).filter((i) => i.url?.startsWith("https://")).sort((a, b) => (b.ratio === "16_9" ? 1 : 0) - (a.ratio === "16_9" ? 1 : 0) || (b.width ?? 0) - (a.width ?? 0))[0];
    const seg = e.classifications?.[0];
    out.push({
      id: `tm:${e.id}`, source: "ticketmaster", placeId, title: e.name.slice(0, 160), body: [seg?.segment?.name, seg?.genre?.name].filter((x) => x && x !== "Undefined").join(" · ") || null,
      startsOn: start, endsOn: e.dates?.end?.localDate && /^\d{4}-\d{2}-\d{2}$/.test(e.dates.end.localDate) ? e.dates.end.localDate : start,
      time: e.dates?.start?.localTime ? e.dates.start.localTime.slice(0, 5) : null, venue: e._embedded?.venues?.[0]?.name ?? null,
      image: img?.url ? { url: img.url, credit: "Ticketmaster" } : null, photo: null, link: e.url?.startsWith("https://") ? e.url : null,
      family: !!seg?.family || /family|kids|children/i.test(`${seg?.segment?.name ?? ""} ${seg?.genre?.name ?? ""}`),
    });
  }
  return out;
}

export async function fetchTicketmaster(f: Fetch, key: string, lat: number, lon: number, from: string, to: string, placeId: string): Promise<WhatsOn[] | null> {
  const r = await getJson(f, ticketmasterUrl(key, lat, lon, from, to), {}, 6000);
  return r.ok ? parseTicketmaster(r.data, placeId) : null;
}
