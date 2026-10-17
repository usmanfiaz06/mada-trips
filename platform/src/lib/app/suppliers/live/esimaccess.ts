import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { iosInstallLink, lpaOf, lpaParts, type EsimCoverageKind, type EsimPackage, type EsimUsage } from "@mada/shared";
import { requireEnv } from "./not-configured";
import { EsimRefused, type EsimSim, type EsimSupplier, type EsimSupplierOrder } from "../esim-types";

/*
 * eSIM Access Open API v1 (docs.esimaccess.com, read 2026-10-17). Production only: there is no sandbox (an unused
 * eSIM can be cancelled for its money back to the balance).
 *
 *   Base        https://api.esimaccess.com/api/v1/open (ESIMACCESS_BASE_URL to override). Every call is a POST with a
 *               JSON body, and every answer is HTTP 200 with { success, errorCode, errorMsg|errorMessage, obj }.
 *   Auth        RT-AccessCode, RT-RequestID (uuid v4), RT-Timestamp (ms) and RT-Signature = lowercase hex
 *               HMAC-SHA256(timestamp + requestId + accessCode + body, secretKey), over the exact body sent (sign()).
 *   Units       price, retailPrice (suggested retail), amount, balance: USD × 10,000 (10000 = $1.00). volume and usage in
 *               bytes (1 GB = 2^30). duration + durationUnit DAY. dataType 1 total; 2, 3, 4 daily (4 unlimited a day),
 *               ordered for `periodNum` days. supportTopUpType 1 = no top-up.
 *   Packages    package/list { locationCode: "TR" | "!RG" | "!GL", type: BASE | TOPUP, iccid } → obj.packageList[];
 *               { locationCode: "" } is the whole catalogue (the daily sync). Cached here for an hour.
 *   Order       esim/order { transactionId (≤ 50, our reference), packageInfoList: [{ packageCode, count, periodNum }] }
 *               → obj.orderNo. A repeated transactionId "is identified as the same request": never a second purchase.
 *               Profiles come a few seconds later: esim/query { orderNo, pager } answers 200010 until then. We look
 *               for up to ~15 s, then leave it pending; the ORDER_STATUS webhook (or the cron) finishes it.
 *   eSIM        esim/query → esimList[] { esimTranNo, iccid, ac "LPA:1$smdp$code", qrCodeUrl, shortUrl, apn,
 *               esimStatus, smdpStatus, totalVolume, orderUsage, expiredTime, transactionId }. esimTranNo is the id to
 *               use (ICCIDs are reused), kept as the eSIM's `ref`.
 *   Top-ups     package/list { type: TOPUP, iccid }; esim/topup { esimTranNo, packageCode, transactionId, periodNum }.
 *   Cancel      esim/cancel { esimTranNo }: only while GOT_RESOURCE + RELEASED (never installed); money back to balance.
 *   Balance     balance/query → obj.balance.
 *   Webhooks    { notifyType, notifyId, eventGenerateTime, content } for ORDER_STATUS, ESIM_STATUS, SMDP_EVENT,
 *               DATA_USAGE (remain in bytes), VALIDITY_USAGE (remain in days), CHECK_HEALTH. Not signed: we put a
 *               secret in the URL (ESIMACCESS_WEBHOOK_SECRET) and/or check their sender IPs, then read the eSIM back
 *               from the API before acting (esimAccessWebhookAllowed).
 *   Errors      200007 low balance; 200010 still allocating; 310241/310243 package gone; 200011 no profiles left;
 *               900001 busy (retry); 101xxx auth. 8 requests a second.
 */

const ENV = ["ESIMACCESS_ACCESS_CODE", "ESIMACCESS_SECRET_KEY"];
const base = () => (process.env.ESIMACCESS_BASE_URL?.trim() || "https://api.esimaccess.com").replace(/\/+$/, "");
const GB = 1024 ** 3;
const MB = 1024 ** 2;
/** USD × 10,000 → USD. */
export const fromE4 = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? 0 : Math.round(Number(v)) / 10_000);
export const toE4 = (usd: number) => Math.round(usd * 10_000);

const g = globalThis as unknown as { __madaEaPackages?: Map<string, { at: number; value: EsimPackage[] }> };
const packageCache: Map<string, { at: number; value: EsimPackage[] }> = (g.__madaEaPackages ??= new Map());
export const PACKAGES_TTL_MS = 60 * 60_000;
export function resetEsimAccessCache() { packageCache.clear(); }
/** Tests: how long to wait for profiles after an order, and between looks. */
export const EA_WAIT = { totalMs: 15_000, everyMs: 2_000 };

/** The headers for one call: the signature covers the exact body string sent. */
export function sign(body: string, accessCode: string, secret: string, now = Date.now(), requestId = randomUUID().replace(/-/g, "")): Record<string, string> {
  const ts = String(now);
  const signature = createHmac("sha256", secret).update(ts + requestId + accessCode + body).digest("hex").toLowerCase();
  return { "RT-AccessCode": accessCode, "RT-RequestID": requestId, "RT-Timestamp": ts, "RT-Signature": signature };
}

type Envelope<T> = { success?: boolean | string; errorCode?: string | number | null; errorMsg?: string | null; errorMessage?: string | null; obj?: T | null };

const LOW_BALANCE = "200007";
const ALLOCATING = "200010";
const RETRY_LATER = new Set(["200011", "900001"]);

async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const env = requireEnv("esimaccess", ENV);
  const raw = JSON.stringify(body);
  const res = await fetch(`${base()}/api/v1/open/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", ...sign(raw, env.ESIMACCESS_ACCESS_CODE!, env.ESIMACCESS_SECRET_KEY!) }, body: raw, signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`eSIM Access ${path} answered ${res.status}`);
  const j = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!j) throw new Error(`eSIM Access ${path}: no answer`);
  const code = j.errorCode === null || j.errorCode === undefined ? "0" : String(j.errorCode);
  const ok = (j.success === true || j.success === "true") && (code === "0" || code === "");
  if (ok) return (j.obj ?? {}) as T;
  const reason = j.errorMsg ?? j.errorMessage ?? "refused";
  // Signature, timestamp, a busy system: an outage as far as the breaker goes. Everything else is a business "no".
  if (code === "900001" || code.startsWith("101") || code.startsWith("0001") || code === "000001") throw new Error(`eSIM Access ${path}: ${code} ${reason}`);
  throw new EsimRefused(code, reason, RETRY_LATER.has(code) || code === LOW_BALANCE, false, code === LOW_BALANCE);
}

/* ───────────── reading eSIM Access's shapes ───────────── */

type EaOperator = { operatorName?: string; networkType?: string };
export type EaPackage = {
  packageCode: string; slug?: string; name?: string; price?: number; retailPrice?: number; currencyCode?: string; volume?: number; dataType?: number;
  duration?: number; durationUnit?: string; location?: string; locationCode?: string; supportTopUpType?: number; ipExport?: string;
  locationNetworkList?: { locationName?: string; locationCode?: string; operatorList?: EaOperator[] }[];
};
export type EaEsim = {
  esimTranNo?: string; orderNo?: string; transactionId?: string; iccid?: string; ac?: string; qrCodeUrl?: string; shortUrl?: string; apn?: string | null;
  smdpStatus?: string; esimStatus?: string; totalVolume?: number; orderUsage?: number; expiredTime?: string | null; dataType?: number;
  packageList?: { packageCode?: string; slug?: string; volume?: number; duration?: number }[];
};

const titleOf = (p: EaPackage) => (p.name ?? p.slug ?? p.packageCode).replace(/\s*\(?\d+(\.\d+)?\s*(GB|MB)\b.*$/i, "").replace(/\s+\d+\s*Days?$/i, "").trim();

export function packageFrom(p: EaPackage, scope: "local" | "regional" | "global" | null = null): EsimPackage | null {
  const countries = (p.location ?? "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x));
  if (!countries.length) return null;
  const kind: EsimCoverageKind = scope ?? (countries.length === 1 && /^[A-Z]{2}$/.test(p.locationCode ?? countries[0]!) ? "local" : countries.length > 60 ? "global" : "regional");
  const daily = (p.dataType ?? 1) !== 1;
  const unlimited = p.dataType === 4;
  // Regions and global plans differ in their countries (EU-30, EU-42, GL-139): each keeps its own code.
  const group = (p.locationCode && !p.locationCode.startsWith("!") ? p.locationCode : p.slug?.split("_")[0] || p.packageCode).toUpperCase();
  const code = kind === "local" ? countries[0]! : group;
  const days = daily ? 1 : (p.durationUnit ?? "DAY").toUpperCase() === "DAY" ? Number(p.duration ?? 0) : Number(p.duration ?? 0) * 30;
  const netUsd = fromE4(p.price);
  if (!(days > 0) || !(netUsd > 0)) return null;
  const op = p.locationNetworkList?.[0]?.operatorList?.[0]?.operatorName ?? "";
  return {
    id: p.slug || p.packageCode, coverage: { kind, code, name: kind === "global" ? "Global" : kind === "local" ? p.locationNetworkList?.[0]?.locationName ?? titleOf(p) : titleOf(p), countries },
    gb: unlimited ? null : Math.round(((p.volume ?? 0) / GB) * 10) / 10, days, netUsd, operator: op, apn: { type: "automatic", value: null },
    roaming: true, topup: (p.supportTopUpType ?? 2) !== 1, retailUsd: p.retailPrice ? fromE4(p.retailPrice) : null, ...(daily ? { daily: true } : {}),
  };
}

export function simFrom(e: EaEsim): EsimSim {
  const parts = e.ac ? lpaParts(e.ac) : null;
  const smdp = parts?.smdp ?? "";
  const matchingId = parts?.matchingId ?? "";
  const lpa = e.ac?.startsWith("LPA:") ? e.ac : lpaOf(smdp, matchingId);
  return {
    iccid: e.iccid ?? "", ref: e.esimTranNo ?? null, lpa, smdp, matchingId, iosLink: iosInstallLink(lpa),
    // eSIM Access profiles set the APN themselves; the value is still worth knowing when it doesn't connect.
    apn: { type: "automatic", value: e.apn || null }, roaming: true,
  };
}

const STATE: Record<string, EsimUsage["state"]> = {
  GOT_RESOURCE: "not_active", IN_USE: "active", USED_UP: "finished", UNUSED_EXPIRED: "expired", USED_EXPIRED: "expired", CANCEL: "expired", REVOKE: "expired", REVOKED: "expired",
};
/** "2025-09-23T14:21:37+0000" → ISO. */
const iso = (s: string | null | undefined) => { if (!s) return null; const d = new Date(s.replace(/([+-]\d\d)(\d\d)$/, "$1:$2")); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

export function usageFrom(e: EaEsim): EsimUsage {
  const unlimited = e.dataType === 4;
  const total = e.totalVolume ? Math.round(e.totalVolume / MB) : null;
  const used = e.orderUsage ? Math.round(e.orderUsage / MB) : 0;
  return { totalMb: unlimited ? null : total, leftMb: unlimited || total === null ? null : Math.max(0, total - used), unlimited, expiresAt: iso(e.expiredTime), state: STATE[e.esimStatus ?? ""] ?? "unknown", checkedAt: new Date().toISOString() };
}

async function esimsOf(q: { orderNo?: string; esimTranNo?: string; iccid?: string; startTime?: string; endTime?: string }, page = 1): Promise<{ list: EaEsim[]; total: number }> {
  const r = await call<{ esimList?: EaEsim[]; pager?: { total?: number } }>("esim/query", { orderNo: "", iccid: "", esimTranNo: "", ...q, pager: { pageNum: page, pageSize: 50 } });
  return { list: r.esimList ?? [], total: Number(r.pager?.total ?? r.esimList?.length ?? 0) };
}

async function oneEsim(iccid: string, ref?: string | null): Promise<EaEsim> {
  const { list } = await esimsOf(ref ? { esimTranNo: ref } : { iccid });
  const e = list.find((x) => (ref ? x.esimTranNo === ref : x.iccid === iccid)) ?? list[0];
  if (!e) throw new EsimRefused(404, "not found");
  return e;
}

/** The order's eSIMs, or null while eSIM Access is still making them. */
async function profilesOf(orderNo: string): Promise<EaEsim[] | null> {
  try {
    const { list } = await esimsOf({ orderNo });
    return list.length && list.every((e) => e.iccid && e.ac) ? list : null;
  } catch (e) {
    if (e instanceof EsimRefused && String(e.supplierCode) === ALLOCATING) return null;
    throw e;
  }
}

const orderOf = (o: { orderNo: string; transactionId: string; packageId: string; quantity: number }, list: EaEsim[] | null): EsimSupplierOrder => ({
  id: o.orderNo, code: o.orderNo, packageId: o.packageId, quantity: o.quantity, description: o.transactionId, netUsd: null,
  sims: (list ?? []).map(simFrom), pending: !list,
});

async function waitForProfiles(orderNo: string): Promise<EaEsim[] | null> {
  const until = Date.now() + EA_WAIT.totalMs;
  for (;;) {
    const list = await profilesOf(orderNo);
    if (list || Date.now() + EA_WAIT.everyMs > until) return list;
    await new Promise((r) => setTimeout(r, EA_WAIT.everyMs));
  }
}

async function list(body: Record<string, unknown>, scope: "local" | "regional" | "global" | null): Promise<EsimPackage[]> {
  const r = await call<{ packageList?: EaPackage[] }>("package/list", { locationCode: "", type: "BASE", packageCode: "", slug: "", iccid: "", ...body });
  return (r.packageList ?? []).map((p) => packageFrom(p, scope)).filter((p): p is EsimPackage => !!p);
}

async function cached(key: string, load: () => Promise<EsimPackage[]>) {
  const hit = packageCache.get(key);
  if (hit && Date.now() - hit.at < PACKAGES_TTL_MS) return hit.value;
  const value = await load();
  packageCache.set(key, { at: Date.now(), value });
  return value;
}

export const esimAccess: EsimSupplier = {
  name: "esimaccess",
  async packages(q) {
    if ("global" in q) {
      return cached("global", async () => {
        const [rg, gl] = await Promise.all([list({ locationCode: "!RG" }, "regional"), list({ locationCode: "!GL" }, "global")]);
        return [...rg, ...gl];
      });
    }
    return cached(`local:${q.country}`, () => list({ locationCode: q.country }, "local"));
  },
  async catalogue() {
    return list({ locationCode: "" }, null);
  },
  async topupPackages(iccid) {
    const r = await call<{ packageList?: EaPackage[] }>("package/list", { locationCode: "", type: "TOPUP", packageCode: "", slug: "", iccid });
    // A top-up is bought by its own code (TOPUP_…): its slug can be the base plan's.
    return (r.packageList ?? []).map((p) => packageFrom({ ...p, slug: undefined }, "local")).filter((p): p is EsimPackage => !!p);
  },
  async order({ packageId, quantity, description, days }) {
    const info: Record<string, unknown> = { packageCode: packageId, count: quantity };
    if (days && days > 0) info.periodNum = days;
    const r = await call<{ orderNo?: string; transactionId?: string }>("esim/order", { transactionId: description.slice(0, 50), packageInfoList: [info] });
    if (!r.orderNo) throw new Error("eSIM Access order: no orderNo");
    return orderOf({ orderNo: r.orderNo, transactionId: description, packageId, quantity }, await waitForProfiles(r.orderNo));
  },
  async findOrder(description, orderId) {
    if (orderId) {
      const profiles = await profilesOf(orderId);
      return orderOf({ orderNo: orderId, transactionId: description, packageId: "", quantity: profiles?.length ?? 0 }, profiles);
    }
    // No look-up by transactionId: read the last three days' eSIMs and match it exactly.
    const end = new Date();
    const start = new Date(end.getTime() - 3 * 86_400_000);
    const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "+0000");
    const mine: EaEsim[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const { list: l, total } = await esimsOf({ startTime: fmt(start), endTime: fmt(end) }, page);
      mine.push(...l.filter((e) => e.transactionId === description));
      if (page * 50 >= total || !l.length) break;
    }
    if (!mine.length) return null;
    const orderNo = mine[0]!.orderNo ?? "";
    return orderOf({ orderNo, transactionId: description, packageId: mine[0]!.packageList?.at(-1)?.slug ?? "", quantity: mine.length }, mine.every((e) => e.iccid && e.ac) ? mine : null);
  },
  async sim(iccid, ref) {
    return simFrom(await oneEsim(iccid, ref));
  },
  async usage(iccid, ref) {
    return usageFrom(await oneEsim(iccid, ref));
  },
  async topup({ iccid, ref, packageId, description, days }) {
    const body: Record<string, unknown> = { esimTranNo: ref ?? "", iccid: ref ? "" : iccid, packageCode: packageId, transactionId: description.slice(0, 50) };
    if (days && days > 0) body.periodNum = String(days);
    const r = await call<{ topUpEsimTranNo?: string; transactionId?: string }>("esim/topup", body);
    return { id: r.topUpEsimTranNo ?? r.transactionId ?? description };
  },
  async refund({ iccids, refs }) {
    // eSIM Access cancels an eSIM that was never installed, at once, back to our balance; anything else it refuses.
    for (const [i, iccid] of iccids.entries()) {
      const ref = refs?.[i] ?? (await oneEsim(iccid)).esimTranNo ?? null;
      await call("esim/cancel", ref ? { esimTranNo: ref } : { iccid });
    }
    return { id: `cancel:${(refs?.[0] ?? iccids[0]) || ""}` };
  },
  async balance() {
    const r = await call<{ balance?: number }>("balance/query", {});
    return { usd: fromE4(r.balance) };
  },
};

/* ───────────── webhooks ───────────── */

/** eSIM Access's sender addresses (docs: "whitelist the following sender IPs"). */
export const ESIMACCESS_WEBHOOK_IPS = ["3.1.131.226", "54.254.74.88", "18.136.190.97", "18.136.60.197", "18.136.19.137", "54.151.164.206", "52.76.129.149", "18.142.83.98"] as const;

/**
 * Whether a webhook call may be believed: with ESIMACCESS_WEBHOOK_SECRET set, the URL's `key` must match it; without
 * it, the caller must be one of eSIM Access's addresses. Either way we read the eSIM back before acting on it.
 */
export function esimAccessWebhookAllowed(key: string | null, ip: string | null): boolean {
  const secret = process.env.ESIMACCESS_WEBHOOK_SECRET?.trim();
  if (secret) {
    if (!key) return false;
    const a = Buffer.from(key);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  return !!ip && (ESIMACCESS_WEBHOOK_IPS as readonly string[]).includes(ip.split(",")[0]!.trim());
}

export const esimAccessConfigured = () => ENV.every((k) => !!process.env[k]);
