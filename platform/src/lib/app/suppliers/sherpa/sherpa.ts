import { requireEnv } from "../live/not-configured";
import { alpha3 } from "./countries";
import type { EntryKind, EntryQuery, EntryRequirement, EntryRulesSupplier } from "./types";

/*
 * Sherpa° Requirements API v3 (joinsherpa.com): one trip (nationality, from Saudi Arabia, to the destination, the dates)
 * → the procedures a traveller must follow; we keep the visa/authorisation one.
 *   SHERPA_API_KEY   the partner key (query parameter `key`)
 *   SHERPA_ENV       sandbox | live
 * Confirmed from Sherpa's public docs: the v3 trips resource in JSON:API form, ISO alpha-3 location codes, procedures in
 * `included`. Assumed until Sherpa issues access: the hosts, and the procedure fields we read (category, subCategory,
 * title, description, enforcement, durationStay, actions[].url, lastUpdatedAt). A procedure we can't read is ignored.
 */

const HOSTS = { sandbox: "https://requirements-api.sandbox.joinsherpa.com", live: "https://requirements-api.joinsherpa.com" };

export function tripBody(q: EntryQuery, dest3: string) {
  return {
    data: {
      type: "TRIP",
      attributes: {
        category: "TOURISM",
        travellers: [{ nationality: q.nationality, documents: [{ documentType: "PASSPORT", nationality: q.nationality }] }],
        travelNodes: [
          { type: "ORIGIN", locationCode: "SAU", departure: { date: q.depart, time: "10:00" } },
          { type: "DESTINATION", locationCode: dest3, arrival: { date: q.depart, time: "16:00" }, ...(q.return ? { departure: { date: q.return, time: "10:00" } } : {}) },
        ],
      },
    },
  };
}

type Proc = { type?: string; attributes?: { category?: string; subCategory?: string; title?: string; description?: string; enforcement?: string; durationStay?: { value?: number; unit?: string }; actions?: { url?: string }[]; lastUpdatedAt?: string; documentValidity?: { value?: number; unit?: string } } };

const SUB: [RegExp, EntryKind][] = [[/NOT_ALLOWED|ENTRY_BAN|RESTRICT/, "not_allowed"], [/EMBASSY|CONSULAR|VISA_REQUIRED|PAPER/, "visa_required"], [/EVISA|E_VISA|ONLINE/, "evisa"], [/ETA|ESTA|ETIAS|AUTHORI[SZ]ATION/, "eta"], [/ON_ARRIVAL|VOA/, "visa_on_arrival"], [/FREE|NOT_REQUIRED|EXEMPT/, "visa_free"]];
const RANK: Record<EntryKind, number> = { not_allowed: 6, visa_required: 5, evisa: 4, eta: 3, visa_on_arrival: 2, visa_free: 1, unknown: 0 };
const days = (d?: { value?: number; unit?: string }) => (d?.value ? Math.round(d.value * (/MONTH/i.test(d.unit ?? "") ? 30 : /YEAR/i.test(d.unit ?? "") ? 365 : 1)) : null);

/** The most demanding visa procedure as our requirement, or null when Sherpa says nothing about a visa. */
export function parseTrip(data: unknown, q: EntryQuery): EntryRequirement | null {
  const inc = ((data as { included?: Proc[] })?.included ?? []).filter((p) => p?.type === "PROCEDURE" && p.attributes);
  let best: { kind: EntryKind; p: Proc } | null = null;
  let passportDays: number | null = null;
  for (const p of inc) {
    const a = p.attributes!;
    const tag = `${a.category ?? ""} ${a.subCategory ?? ""}`.toUpperCase();
    if (/PASSPORT/.test(tag)) passportDays = days(a.documentValidity) ?? passportDays;
    if (!/VISA|ETA|ENTRY|AUTHORI/.test(tag)) continue;
    const kind = SUB.find(([re]) => re.test(a.subCategory?.toUpperCase() ?? ""))?.[1] ?? (/OPTIONAL|RECOMMENDED/i.test(a.enforcement ?? "") ? "visa_free" : "unknown");
    if (!best || RANK[kind] > RANK[best.kind]) best = { kind, p };
  }
  if (!best) return null;
  const a = best.p.attributes!;
  const needs = best.kind === "evisa" || best.kind === "eta" || best.kind === "visa_required";
  return {
    nationality: q.nationality, destination: q.destination, kind: best.kind, name: needs ? (a.title ?? "Visa").slice(0, 80) : null,
    text: (a.description ?? a.title ?? "").replace(/<[^>]+>/g, "").slice(0, 400), maxStayDays: days(a.durationStay), passportDays,
    applyUrl: a.actions?.find((x) => x.url?.startsWith("https://"))?.url ?? null, source: "sherpa", checkedAt: a.lastUpdatedAt ?? null,
  };
}

export const sherpa: EntryRulesSupplier = {
  name: "sherpa",
  async requirement(q) {
    const { SHERPA_API_KEY: key } = requireEnv("entry rules (Sherpa)", ["SHERPA_API_KEY"]);
    const dest3 = alpha3(q.destination);
    if (!dest3) return null;
    const host = HOSTS[process.env.SHERPA_ENV === "live" ? "live" : "sandbox"];
    const url = `${host}/v3/trips?${new URLSearchParams({ key, include: "procedure", language: q.language === "ar" ? "ar-SA" : "en-US" })}`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/vnd.api+json", Accept: "application/vnd.api+json" }, body: JSON.stringify(tripBody(q, dest3)), signal: AbortSignal.timeout(7000) });
    if (res.status >= 500) throw new Error(`sherpa answered ${res.status}`);
    if (!res.ok) { console.warn("[sherpa] refused", res.status); return null; }
    return parseTrip(await res.json(), q);
  },
};
