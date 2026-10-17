import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { iosInstallLink, lpaOf, lpaParts, type EsimCoverageKind, type EsimPackage, type EsimUsage } from "@mada/shared";
import { requireEnv } from "./not-configured";
import { EsimRefused, type EsimSim, type EsimSupplier, type EsimSupplierOrder } from "../esim-types";

/*
 * Airalo Partner API v2 (developers.partners.airalo.com, read 2026-10-17).
 *
 *   Base        https://partners-api.airalo.com/v2 (AIRALO_BASE_URL to override). Sandbox and production are the same host:
 *               the partner account's mode decides (AIRALO_ENV records which keys these are: sandbox | live). Sandbox
 *               orders return ICCIDs that can't be installed and cost nothing.
 *   Token       POST /token, form-urlencoded client_id, client_secret, grant_type=client_credentials → data.access_token,
 *               expires_in. 3 requests a minute: cached here per client id, refreshed at min(expires_in, 24 h) less 5 min,
 *               one request in flight at a time. A 401 drops it and asks once more.
 *   Packages    GET /packages?filter[type]=local&filter[country]=TR (or filter[type]=global for regions and the world),
 *               data[] country/region → operators[] → packages[] (type sim; amount in MB, day, is_unlimited, net_price).
 *               Cached for an hour (Airalo asks partners to sync hourly). Page 2+ may come back as an object: both read.
 *   Order       POST /orders, multipart: quantity, package_id, type=sim, description (our reference) → data.sims[] with
 *               iccid, lpa, matching_id, qrcode ("LPA:1$…"), direct_apple_installation_url, apn_type/apn_value, apn.ios/android,
 *               is_roaming. No idempotency key: an identical payload within a second is refused with code 83, and
 *               GET /orders?filter[description]=… finds what was bought (findOrder), so the caller looks before retrying.
 *   eSIM        GET /sims/{iccid}; usage GET /sims/{iccid}/usage (MB remaining/total, expired_at, is_unlimited, status
 *               NOT_ACTIVE|ACTIVE|FINISHED|UNKNOWN|EXPIRED; cached 20 min by Airalo, 10 a minute per ICCID).
 *   Top-ups     GET /sims/{iccid}/topups; POST /orders/topups multipart package_id, iccid, description.
 *   Refund      POST /refund multipart iccids[], reason, notes (reviewed by Airalo, paid back as Airalo credit).
 *   Webhooks    low data: { level, package_name, remaining_percentage, iccid }; header airalo-signature = hex
 *               HMAC-SHA512 of the raw body keyed with the client secret (verifyAiraloSignature).
 *   Errors      422 { data: { field: message } } or { code, reason }; codes 13/33/53 retry later, 34 package gone, 83 duplicate.
 */

const ENV = ["AIRALO_CLIENT_ID", "AIRALO_CLIENT_SECRET"];
const base = () => (process.env.AIRALO_BASE_URL?.trim() || "https://partners-api.airalo.com").replace(/\/+$/, "");
const DAY = 86_400_000;

type Token = { value: string; until: number };
const g = globalThis as unknown as { __madaAiraloToken?: Map<string, Token>; __madaAiraloInflight?: Map<string, Promise<Token>>; __madaAiraloPackages?: Map<string, { at: number; value: EsimPackage[] }> };
const tokens: Map<string, Token> = (g.__madaAiraloToken ??= new Map<string, Token>());
const inflight: Map<string, Promise<Token>> = (g.__madaAiraloInflight ??= new Map<string, Promise<Token>>());
const packageCache: Map<string, { at: number; value: EsimPackage[] }> = (g.__madaAiraloPackages ??= new Map());
export const PACKAGES_TTL_MS = 60 * 60_000;
/** Tests: forget the token and the package list. */
export function resetAiraloCache() { tokens.clear(); inflight.clear(); packageCache.clear(); }

async function fetchToken(id: string, secret: string): Promise<Token> {
  const res = await fetch(`${base()}/v2/token`, {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" }).toString(), signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => null)) as { data?: { access_token?: string; expires_in?: number } } | null;
  if (!res.ok || !json?.data?.access_token) throw new Error(`Airalo token: ${res.status}`);
  const life = Math.min((json.data.expires_in ?? 86_400) * 1000, DAY);
  return { value: json.data.access_token, until: Date.now() + life - 5 * 60_000 };
}

/** The cached access token, fetched once however many calls ask at the same time. */
export async function airaloToken(): Promise<string> {
  const env = requireEnv("airalo", ENV);
  const id = env.AIRALO_CLIENT_ID!;
  const cur = tokens.get(id);
  if (cur && cur.until > Date.now()) return cur.value;
  let p = inflight.get(id);
  if (!p) {
    p = fetchToken(id, env.AIRALO_CLIENT_SECRET!).then((tk) => { tokens.set(id, tk); return tk; }).finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return (await p).value;
}

type Body = { kind: "form"; fields: [string, string][] } | null;

async function call<T>(method: "GET" | "POST", path: string, body: Body = null, retried = false): Promise<T> {
  const token = await airaloToken();
  let payload: BodyInit | undefined;
  if (body) { const fd = new FormData(); for (const [k, v] of body.fields) fd.append(k, v); payload = fd; }
  const res = await fetch(`${base()}/v2${path}`, { method, headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, body: payload, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text) as unknown; } catch { return null; } })() : null;
  if (res.status === 401 && !retried) { tokens.delete(process.env.AIRALO_CLIENT_ID ?? ""); return call<T>(method, path, body, true); }
  if (res.ok) return json as T;
  const j = (json ?? {}) as { code?: number; reason?: string; data?: unknown; meta?: { message?: string } };
  if (res.status === 422 || res.status === 403) {
    const code = j.code ?? "validation";
    const reason = j.reason ?? (j.data && typeof j.data === "object" && !Array.isArray(j.data) ? Object.values(j.data as Record<string, string>).join(" ") : j.meta?.message) ?? "refused";
    throw new EsimRefused(code, reason, code === 13 || code === 33 || code === 53, code === 83);
  }
  if (res.status === 404) throw new EsimRefused(404, j.meta?.message ?? "not found");
  // 429, 5xx: an outage as far as the breaker is concerned.
  throw new Error(`Airalo ${method} ${path} answered ${res.status}`);
}

/* ───────────── reading Airalo's shapes ───────────── */

type AOperator = { title?: string; is_roaming?: boolean; rechargeability?: boolean; apn_type?: string; apn_value?: string | null; apn?: { ios?: { apn_type?: string; apn_value?: string | null }; android?: { apn_type?: string; apn_value?: string | null } }; countries?: { country_code?: string }[]; packages?: APackage[] };
type APackage = { id: string; type?: string; net_price?: number; price?: number; amount?: number; day?: number; is_unlimited?: boolean };
type ACountry = { slug: string; country_code?: string | null; title?: string; operators?: AOperator[] };
type ASim = { iccid: string; lpa?: string; matching_id?: string; qrcode?: string; direct_apple_installation_url?: string | null; apn_type?: string; apn_value?: string | null; is_roaming?: boolean; apn?: AOperator["apn"] };
type AOrder = { id: number | string; code?: string; package_id?: string; quantity?: number | string; description?: string | null; net_price?: number | null; sims?: ASim[] };

const asList = <T>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : d && typeof d === "object" ? (Object.values(d) as T[]) : []);

function apnOf(x: { apn_type?: string; apn_value?: string | null; apn?: AOperator["apn"] }): EsimPackage["apn"] {
  // Either phone saying "manual" means there is a value to type; show that one.
  const opts = [x.apn?.android, x.apn?.ios, { apn_type: x.apn_type, apn_value: x.apn_value }].filter(Boolean) as { apn_type?: string; apn_value?: string | null }[];
  const manual = opts.find((o) => o.apn_type === "manual" && o.apn_value);
  return manual ? { type: "manual", value: manual.apn_value ?? null } : { type: "automatic", value: null };
}

export function packagesFrom(data: unknown): EsimPackage[] {
  const out: EsimPackage[] = [];
  for (const c of asList<ACountry>(data)) {
    const kind: EsimCoverageKind = c.country_code ? "local" : /world|global/i.test(c.slug) ? "global" : "regional";
    const code = c.country_code || (kind === "global" ? "world" : c.slug);
    for (const op of c.operators ?? []) {
      const countries = (op.countries ?? []).map((x) => x.country_code).filter((x): x is string => !!x);
      for (const p of op.packages ?? []) {
        if (p.type && p.type !== "sim" && p.type !== "topup") continue;
        out.push({
          id: p.id, coverage: { kind, code, name: c.title ?? code, countries: countries.length ? countries : c.country_code ? [c.country_code] : [] },
          gb: p.is_unlimited ? null : Math.round(((p.amount ?? 0) / 1024) * 10) / 10, days: p.day ?? 0, netUsd: Number(p.net_price ?? p.price ?? 0),
          operator: op.title ?? "", apn: apnOf(op), roaming: !!op.is_roaming, topup: op.rechargeability !== false,
        });
      }
    }
  }
  return out.filter((p) => p.days > 0 && p.netUsd > 0);
}

export function simFrom(s: ASim): EsimSim {
  const parts = s.qrcode ? lpaParts(s.qrcode) : null;
  const smdp = parts?.smdp ?? s.lpa ?? "";
  const matchingId = parts?.matchingId ?? s.matching_id ?? "";
  const lpa = s.qrcode?.startsWith("LPA:") ? s.qrcode : lpaOf(smdp, matchingId);
  return { iccid: s.iccid, lpa, smdp, matchingId, iosLink: s.direct_apple_installation_url || iosInstallLink(lpa), apn: apnOf(s), roaming: s.is_roaming !== false };
}

const orderFrom = (o: AOrder): EsimSupplierOrder => ({
  id: String(o.id), code: o.code ?? null, packageId: o.package_id ?? "", quantity: Number(o.quantity ?? 1), description: o.description ?? "",
  netUsd: o.net_price ?? null, sims: (o.sims ?? []).map(simFrom),
});

const STATE: Record<string, EsimUsage["state"]> = { NOT_ACTIVE: "not_active", ACTIVE: "active", FINISHED: "finished", EXPIRED: "expired" };
/** Airalo's "2026-10-20 09:00:00" (UTC) as ISO. */
const utc = (s: string | null | undefined) => (s ? new Date(`${s.replace(" ", "T")}${/Z|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"}`).toISOString() : null);

export const airaloEsim: EsimSupplier = {
  name: "airalo",
  async packages(q) {
    const key = "global" in q ? "global" : `local:${q.country}`;
    const hit = packageCache.get(key);
    if (hit && Date.now() - hit.at < PACKAGES_TTL_MS) return hit.value;
    const qs = "global" in q ? "filter[type]=global" : `filter[type]=local&filter[country]=${encodeURIComponent(q.country)}`;
    const r = await call<{ data?: unknown }>("GET", `/packages?${qs}`);
    const value = packagesFrom(r.data);
    packageCache.set(key, { at: Date.now(), value });
    return value;
  },
  async topupPackages(iccid) {
    const r = await call<{ data?: APackage[] }>("GET", `/sims/${encodeURIComponent(iccid)}/topups`);
    return asList<APackage>(r.data).filter((p) => (p.day ?? 0) > 0).map((p) => ({
      id: p.id, coverage: { kind: "local", code: "", name: "", countries: [] }, gb: p.is_unlimited ? null : Math.round(((p.amount ?? 0) / 1024) * 10) / 10,
      days: p.day ?? 0, netUsd: Number(p.net_price ?? p.price ?? 0), operator: "", apn: { type: "automatic", value: null }, roaming: true, topup: true,
    }));
  },
  async order({ packageId, quantity, description }) {
    const r = await call<{ data: AOrder }>("POST", "/orders", { kind: "form", fields: [["quantity", String(quantity)], ["package_id", packageId], ["type", "sim"], ["description", description]] });
    return orderFrom(r.data);
  },
  async findOrder(description) {
    const r = await call<{ data?: unknown }>("GET", `/orders?filter[description]=${encodeURIComponent(description)}&include=sims&limit=10`);
    // The filter is a LIKE search: only an exact description counts.
    const hit = asList<AOrder>(r.data).find((o) => (o.description ?? "") === description);
    return hit ? orderFrom(hit) : null;
  },
  async sim(iccid) {
    const r = await call<{ data: ASim }>("GET", `/sims/${encodeURIComponent(iccid)}`);
    return simFrom(r.data);
  },
  async usage(iccid) {
    const r = await call<{ data: { remaining?: number; total?: number; expired_at?: string | null; is_unlimited?: boolean | null; status?: string } }>("GET", `/sims/${encodeURIComponent(iccid)}/usage`);
    const d = r.data ?? {};
    const unlimited = !!d.is_unlimited;
    return {
      totalMb: unlimited ? null : d.total ?? null, leftMb: unlimited ? null : d.remaining ?? null, unlimited, expiresAt: utc(d.expired_at),
      state: STATE[d.status ?? ""] ?? "unknown", checkedAt: new Date().toISOString(),
    };
  },
  async topup({ iccid, packageId, description }) {
    const r = await call<{ data: { id: number | string } }>("POST", "/orders/topups", { kind: "form", fields: [["package_id", packageId], ["iccid", iccid], ["description", description]] });
    return { id: String(r.data.id) };
  },
  async refund({ iccids, reason, notes }) {
    const fields: [string, string][] = [...iccids.slice(0, 5).map((i): [string, string] => ["iccids[]", i]), ["reason", reason]];
    if (notes || reason === "OTHERS") fields.push(["notes", (notes ?? "Refunded to the traveller").slice(0, 500)]);
    const r = await call<{ data: { refund_id: string | number } }>("POST", "/refund", { kind: "form", fields });
    return { id: String(r.data.refund_id) };
  },
};

/** A webhook from Airalo: hex HMAC-SHA512 of the raw body, keyed with our client secret. False when not configured. */
export function verifyAiraloSignature(raw: string, signature: string | null): boolean {
  const secret = process.env.AIRALO_CLIENT_SECRET;
  if (!secret || !signature) return false;
  const want = Buffer.from(createHmac("sha512", secret).update(raw).digest("hex"));
  const got = Buffer.from(signature.trim().toLowerCase());
  return want.length === got.length && timingSafeEqual(want, got);
}

export const airaloConfigured = () => ENV.every((k) => !!process.env[k]);
export const airaloEnv = (): "sandbox" | "live" => (process.env.AIRALO_ENV?.toLowerCase() === "live" ? "live" : "sandbox");
