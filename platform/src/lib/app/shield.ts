import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto";
import { pepper } from "./config";

/*
 * What a traveller's app never sees (docs/app/SUPPLIER-PRIVACY.md): which partners Mada books with, their codes and
 * references, their photo hosts, and what Mada pays. Three tools, used by the Core API (/api/app/v1) only:
 *
 *   seal / unseal   An opaque, stable id for a partner's id (a hotel code, an eSIM package, an experience): AES-256-GCM
 *                   with a synthetic IV (an HMAC of the value), so the same value always seals to the same id and
 *                   only this server can read it back. `m_` + base64url. Request bodies are unsealed in http.ts
 *                   body(), so handlers keep working with the partner's real id.
 *   imageProxyPath  A partner's photo, served from our own host: /img/<sealed url> (route img/[token]).
 *   scrubResponse   The safety net on every JSON answer (http.ts resilient()): partner photo URLs become our image
 *                   links and cost/partner fields are dropped, whatever a handler forgot.
 */

const PREFIX = "m_";
const key = () => createHash("sha256").update(`${pepper()}:shield:v1`).digest();

export function seal(kind: string, value: string): string {
  const k = key();
  const iv = createHmac("sha256", k).update(`${kind}\0${value}`).digest().subarray(0, 12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  c.setAAD(Buffer.from(kind));
  const ct = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, ct, c.getAuthTag()]).toString("base64url");
}

/** The partner's value behind a sealed id of this kind, or null (not ours, tampered, or another kind). */
export function unseal(kind: string, token: string): string | null {
  if (!isSealed(token)) return null;
  try {
    const raw = Buffer.from(token.slice(PREFIX.length), "base64url");
    if (raw.length < 29) return null;
    const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    d.setAAD(Buffer.from(kind));
    d.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const isSealed = (v: unknown): v is string => typeof v === "string" && v.startsWith(PREFIX) && /^m_[\w-]{38,1400}$/.test(v);

/** Kinds sealed into request-facing ids. Bodies are unsealed for these kinds only. */
export const SEALED_KINDS = ["hotel", "esim", "exp"] as const;
export type SealedKind = (typeof SEALED_KINDS)[number];

/** Any sealed id among the request-facing kinds, back to the partner's value; anything else unchanged. */
export function unsealAny(v: string): string {
  if (!isSealed(v)) return v;
  for (const k of SEALED_KINDS) {
    const got = unseal(k, v);
    if (got !== null) return got;
  }
  return v;
}

/** A JSON body with every sealed id put back (strings anywhere in it). */
export function unsealDeep<T>(v: T): T {
  if (typeof v === "string") return unsealAny(v) as T;
  if (Array.isArray(v)) return v.map(unsealDeep) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unsealDeep(x)])) as T;
  return v;
}

/* ───────────── partner photos ───────────── */

/**
 * Hosts whose photos we pass through our own image route. A URL on any other host is never fetched by the proxy, and
 * the scrub turns any URL on these hosts in an answer into our link.
 */
const PARTNER_IMAGE_HOSTS = [
  "hotelbeds.com", "hotelbeds.net", "hbg.com", "hbx.com", "activitiesbank.com", "giata.com", "giatamedia.com", "tboholidays.com", "tbo.com", "tboair.com",
  "esimaccess.com", "airalo.com", "airalo.net", "viator.com", "tripadvisor.com", "getyourguide.com", "gyg.com", "worldota.net", "ratehawk.com", "emergingtravel.com",
  "duffel.com", "cartrawler.com", "klook.com", "klookcdn.com", "joinsherpa.com", "sherpa.com", "xcover.com", "aerodatabox.com", "webbeds.com", "dotwconnect.com",
  // Google Places photos (CONNECT.md §32): not a hidden partner (the cards credit Google), but the media URL needs our
  // key, which only the image route adds on the server.
  "places.googleapis.com",
];
const hostIs = (host: string, base: string) => host === base || host.endsWith(`.${base}`);
export const isPartnerHost = (host: string) => PARTNER_IMAGE_HOSTS.some((b) => hostIs(host.toLowerCase(), b));

export function isPartnerUrl(u: string): boolean {
  if (!/^https?:\/\//i.test(u)) return false;
  try { return isPartnerHost(new URL(u).hostname); } catch { return false; }
}

/** Our path (under /api/app/v1) for a partner's photo. */
export const imageProxyPath = (url: string) => `/img/${seal("img", url)}`;

/** The partner URL behind an image token, only when it's still on a partner host and https. */
export function imageOf(token: string): string | null {
  const u = unseal("img", token);
  if (!u) return null;
  try {
    const p = new URL(u);
    return p.protocol === "https:" && isPartnerHost(p.hostname) ? p.toString() : null;
  } catch {
    return null;
  }
}

/* ───────────── the safety net on answers ───────────── */

/**
 * Fields that never reach the app, by name (exact, any depth): what Mada pays and earns, and partner identities.
 * `payableThrough` (the hotel voucher's contract line) is the one partner name that stays (docs/app/HOTELBEDS.md §4).
 */
const DROP = new Set([
  "supplier", "supplierName", "supplierCode", "supplierRef", "supplierReference", "supplierOfferId", "supplierFee", "supplierBookingRef", "supplierStatus",
  "rateKey", "rateKeys", "netUsd", "netPrice", "netCost", "netTotal", "netAmount", "netHalalas", "costUsd", "costHalalas", "costPrice", "wholesale",
  "markup", "markupBps", "markupPct", "margin", "marginBps", "marginPct", "marginHalalas", "profit", "commission", "commissionBps", "commissionPct",
  "vendor", "hotelbedsRef", "tboRef", "traceId", "modality", "rateCommentsId",
]);

/** A partner experience id as the adapters make it ("hotelbeds:E-E10-IST-BOSDIN", "viator:5513P12"). */
const EXPERIENCE_ID = /^(?:hotelbeds|getyourguide|viator|klook|gyg|hb):[\w.~-]{1,80}$/;
const digits = (v: unknown): v is number | string => (typeof v === "number" && Number.isInteger(v) && v > 0) || (typeof v === "string" && /^\d{1,12}$/.test(v));

/**
 * Partner brand names, as a traveller might read them in free text from upstream (an error, a policy, a remark). Bare
 * "TBO" and "HBG" are left alone here: they are also airports (Tabora, Hattiesburg).
 */
export const PARTNER_NAMES = /\b(?:hotel\s?beds(?: professional services[^,.;]*)?|hbx(?: group)?|tbo\s?(?:holidays|air|tek)|tbo\.com|tboholidays|e-?sim\s?access|airalo|aero\s?data\s?box|worldota|rate\s?hawk|emerging travel|duffel|cartrawler|klook|sherpa°?|xcover|viator|get\s?your\s?guide|webbeds|dotw)\b/gi;

/** Keys whose text is the voucher's contract line and stays as written. */
const KEEP_TEXT = new Set(["payableThrough"]);

/** "Go to the Hotelbeds desk": where to meet stays findable without the name. */
const PARTNER_PLACE = /\b(?:the\s+)?(?:hotel\s?beds|hbx(?:\s+group)?)(?:\s+transfers?)?\s+(desk|counter|stand|booth|representative|rep|sign|staff|office|meeting point)/gi;

export function scrubText(s: string): string {
  return s.replace(PARTNER_PLACE, "the transfer $1").replace(PARTNER_NAMES, "our partner");
}

/**
 * The app's view of an answer: partner photos through our image route (absolute, on `origin`), cost and partner
 * fields gone, partner names in free text replaced. Ids are left as they are (they are sealed where they're made).
 */
export function scrubResponse(v: unknown, origin: string, base = "/api/app/v1"): unknown {
  const walk = (x: unknown, key: string | null): unknown => {
    // Partner ids, sealed wherever they turn up (unsealed again in http.ts body()).
    if (key === "hotelCode" && digits(x)) return seal("hotel", String(x));
    if (key === "packageId" && typeof x === "string" && x && !isSealed(x)) return seal("esim", x);
    if (typeof x === "string" && EXPERIENCE_ID.test(x)) return seal("exp", x);
    if (typeof x === "string") {
      if (isPartnerUrl(x)) return `${origin}${base}${imageProxyPath(x)}`;
      if (key && KEEP_TEXT.has(key)) return x;
      // Free text only (it has a space), or a string that is just a partner's name ("Hotelbeds" as a photo credit):
      // tokens, ids and codes never have spaces and are left alone.
      PARTNER_NAMES.lastIndex = 0;
      if (!/\s/.test(x) && !new RegExp(`^(?:${PARTNER_NAMES.source})$`, "i").test(x)) return x;
      PARTNER_NAMES.lastIndex = 0;
      return PARTNER_NAMES.test(x) ? scrubText(x) : x;
    }
    if (Array.isArray(x)) return x.map((y) => walk(y, key));
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      // A hotel's partner code (the stay card's and hotel page's `hotel.code`).
      const hotel = key === "hotel" && digits(o.code);
      // An eSIM plan (EsimPlan, EsimView.plan): its id is the partner's package id.
      const plan = typeof o.id === "string" && !!o.coverage && typeof o.days === "number" && "gb" in o;
      // An experience: its partner's product code goes.
      const experience = !!o.priceFrom && "durationMin" in o;
      for (const [k, y] of Object.entries(o)) {
        if (hotel && k === "code") { out.code = seal("hotel", String(y)); continue; }
        if (plan && k === "id") { out.id = isSealed(y) ? y : seal("esim", y as string); continue; }
        if (experience && k === "code") continue;
        // `net` is the VAT-exclusive amount on an invoice (beside its `vat`); anywhere else it is what Mada pays.
        if (k === "net" && !("vat" in o)) continue;
        // The plan list's pick (EsimPlansResponse.recommended) is a plan id too.
        if (k === "recommended" && typeof y === "string" && Array.isArray(o.plans) && !isSealed(y)) { out.recommended = seal("esim", y); continue; }
        // A ride's `supplier` says "mock" (a demo car) or "none" (found by hand): not a partner's name.
        if (DROP.has(k) && !(k === "supplier" && (y === "mock" || y === "none"))) continue;
        out[k] = walk(y, k);
      }
      return out;
    }
    return x;
  };
  return walk(v, null);
}

/** A hotel's partner code from the sealed id in a path (/hotels/{id}); null when it isn't one of ours. */
export function hotelCodeOf(id: string): number | null {
  const v = unseal("hotel", decodeURIComponent(id));
  const n = v === null ? NaN : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Partner-named supplier slots (config.ts KEYED_SUPPLIERS) as public answers name them: the kind of service. */
const SLOTS: Record<string, string> = { klook: "activities", duffel: "flights", ratehawk: "hotels", sherpa: "entry", tabby: "payments", tamara: "payments", carHire: "cars", insurance: "insurance", routes: "maps" };
export const publicSlot = (name: string) => SLOTS[name] ?? name;

/** A slot → value map with partner-named slots folded into their kind (the first non-"mock"/"off" value wins). */
export function publicSlots<V extends string>(m: Record<string, V>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of Object.entries(m)) {
    const s = publicSlot(k);
    if (!(s in out) || out[s] === "mock" || out[s] === "off") out[s] = v;
  }
  return out;
}
