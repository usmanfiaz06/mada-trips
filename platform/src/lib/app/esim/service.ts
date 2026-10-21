import "server-only";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  ESIM_MARKUP_BPS, EsimPlansQuery, addDays, esimCountriesOf, esimCoverageFor, esimDays, esimDestinationOf, esimNearest, esimPlaceName, esimPlacesOf, esimRegionCoverage, type EsimPlace, esimStatusOf, esimWhereKey, formatSar, money, personName, suggestEsimPlans,
  localeOr, t, tn, todayIn, topupPlans, type CopyKey, type EsimPackage, type EsimPlan, type EsimPlansResponse, type EsimUsage, type EsimView, type OrderLine, type RequestResult,
} from "@mada/shared";
import { db } from "@/db";
import { appPayments, appRefunds, appTrips, appUsers } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appEsimCatalogue, appEsimWebhooks, appEsims } from "@/db/app-schema-esim";
import { appAuditLog } from "../audit";
import { isProductionDeploy, supplierMode } from "../config";
import { addCredit } from "../credit";
import { AppError } from "../http";
import { esimVendor, suppliers } from "../suppliers";
import { EsimRefused, type EsimSim, type EsimSupplierOrder, type EsimVendor } from "../suppliers/esim-types";
import { airaloEnv, verifyAiraloSignature } from "../suppliers/live/airalo";
import { esimPricing, heldPrice, holdPrices, visible } from "./pricing";
import { lowBalanceAfterPayment } from "./ops";
import { markMockEsimInstalled } from "../suppliers/mock/esim";
import { bookingSuppliers, householdOf, isUuid, travellersOf } from "../booking/common";
import { orderEvent } from "../booking/desk";
import { notify } from "../trips/notify";
import { emit as emitPlanEvent } from "../plans/events";

/*
 * eSIMs (eSIM Access or Airalo), docs in docs/app/ESIM.md, platform/src/lib/app/suppliers/README.md and the shared
 * rules in schemas/esim.ts.
 *
 *   plans      GET /esim/plans: 2–3 sizes for the trip's country (or region) and days (the owner's picks first), the
 *              rest under "See all", priced by the owner's rules (esim/pricing.ts), and who on the trip already has one.
 *              The prices shown are held for the traveller for the rules' hold window.
 *   pricing    priceEsim: the order sheet's line, from the supplier's own package (never a price from the app), at the
 *              held price when the traveller saw a lower one.
 *   fulfil     after the payment is captured (orders.ts → confirmOrder → fulfilEsimOrder): one supplier order for all
 *              the eSIMs, our order id as its description. Before buying it looks that description up, so a retry, a
 *              second server or the desk's "order again" never buys twice. A definite no → the payment is refunded at
 *              once and the order closes with a refund outcome. No answer at all → 'stuck' until the desk looks.
 *   on trip    usage read through the supplier at most every 20 minutes (Airalo caches that long), top-ups, installed.
 */

type Row = typeof appEsims.$inferSelect;
type OrderRow = typeof appOrders.$inferSelect;
type Coverage = EsimPackage["coverage"];
export type EsimSnapshot = {
  packageId: string; coverage: Coverage; gb: number | null; days: number; netUsd: number; operator: string; topup: boolean;
  unit: number; count: number; travellerIds: string[]; tripId: string | null; topupOf: string | null; apn: EsimPackage["apn"]; roaming: boolean;
  /** A daily plan: `gb` a day, bought for `days`. */
  daily?: boolean;
};

const USAGE_TTL_MS = 20 * 60_000;
const CLAIM_MS = 90_000;

export function markupBps(): number {
  const n = Number(process.env.APP_ESIM_MARKUP_BPS);
  return Number.isFinite(n) && n >= 0 && n <= 20_000 ? Math.round(n) : ESIM_MARKUP_BPS;
}
const sup = () => suppliers.esim();
const supplierName = (): EsimVendor => esimVendor();
/** A daily plan is held and priced per number of days. */
const holdKey = (id: string, daily: boolean | undefined, days: number) => (daily ? `${id}@${days}` : id);
/** A package as bought for `days` (a daily plan: the day's price times the days). */
const forDays = <T extends EsimPackage>(p: T, days: number): T => (p.daily ? { ...p, days, netUsd: p.netUsd * days, retailUsd: p.retailUsd ? p.retailUsd * days : p.retailUsd } : p);

/**
 * Whether a real eSIM may be bought here. Sandbox keys on a production deployment would sell an eSIM that can't be
 * installed; live keys outside production would spend real money on tests (unless AIRALO_ALLOW_LIVE_OUTSIDE_PRODUCTION=yes).
 */
export function esimOrderingAllowed(): { ok: true } | { ok: false; why: string } {
  const vendor = esimVendor();
  if (vendor === "mock") return { ok: true };
  if (vendor === "esimaccess") {
    // eSIM Access has no sandbox: every order spends the prepaid balance (an uninstalled eSIM can be cancelled back).
    if (!isProductionDeploy() && process.env.ESIMACCESS_ALLOW_OUTSIDE_PRODUCTION !== "yes") return { ok: false, why: "eSIM Access keys outside production spend real balance. Set ESIMACCESS_ALLOW_OUTSIDE_PRODUCTION=yes on staging to test with real eSIMs." };
    return { ok: true };
  }
  const env = airaloEnv();
  if (env === "sandbox" && isProductionDeploy()) return { ok: false, why: "AIRALO_ENV=sandbox on a production deployment: sandbox eSIMs can't be installed." };
  if (env === "live" && !isProductionDeploy() && process.env.AIRALO_ALLOW_LIVE_OUTSIDE_PRODUCTION !== "yes") return { ok: false, why: "Live Airalo keys outside production. Use the sandbox here." };
  return { ok: true };
}

/** "Türkiye", "Europe", in the reader's language when Mada writes the name; the supplier's title otherwise. */
export const whereName = (c: Pick<Coverage, "code" | "name">, locale?: "en" | "ar") => { const k = esimWhereKey(c.code); return k ? t(k as CopyKey, undefined, locale) : (/^[A-Z]{2}$/.test(c.code) ? esimPlaceName(c.code, localeOr(locale)) : null) ?? c.name; };
const whereRef = (c: Pick<Coverage, "code" | "name">) => { const k = esimWhereKey(c.code); return k ? { k: k as CopyKey } : c.name; };
const sizeText = (gb: number | null, days: number, daily?: boolean) => (gb === null ? t("es.size.unlimited", { days }) : daily ? t("es.size.daily", { gb, days }) : t("es.size.gb", { gb, days }));

/** Local packages for one country plus the regional and global ones, without the ones the owner hid. */
async function packagesFor(countries: string[], hidden: readonly string[] = []): Promise<EsimPackage[]> {
  const global = sup().packages({ global: true });
  global.catch(() => {});
  const local = countries.length === 1 ? await sup().packages({ country: countries[0]! }) : [];
  const all = [...local, ...(await global)];
  return hidden.length ? all.filter((p) => !hidden.includes(p.id)) : all;
}

/* ───────────── plans ───────────── */

export async function esimPlans(ownerId: string, raw: Record<string, string | undefined>): Promise<EsimPlansResponse> {
  const q = EsimPlansQuery.parse(raw);
  let countries: string[] = [];
  let days = q.days ?? 7;
  let start: string | null = null;
  let tripId: string | null = null;
  let travellerIds: string[] | null = null;
  if (q.tripId) {
    const [trip] = await db.select().from(appTrips).where(and(eq(appTrips.id, q.tripId), eq(appTrips.ownerId, ownerId)));
    if (!trip) throw new AppError("NOT_FOUND");
    countries = esimCountriesOf({ city: trip.city, country: trip.country });
    days = q.days ?? esimDays(trip.startDate, trip.endDate);
    start = trip.startDate;
    tripId = trip.id;
    travellerIds = trip.travellerIds;
  } else if (q.countries) countries = q.countries.split(",");
  let region = q.tripId || q.countries ? null : q.region ?? null;
  if (!q.tripId && !q.countries && !region && q.destination) {
    // A DESTINATIONS key, an ISO code, or any country, city or region by name ("Pakistan", "لاهور", "Europe").
    const d = esimDestinationOf(q.destination);
    countries = d.countries;
    region = d.region;
  }
  const household = await householdOf(ownerId);
  const onTrip = travellerIds?.length ? household.filter((p) => travellerIds!.includes(p.id)) : household;
  const has = tripId
    ? new Set((await db.select({ p: appEsims.travellerId }).from(appEsims).where(and(eq(appEsims.ownerId, ownerId), eq(appEsims.tripId, tripId), sql`${appEsims.status} <> 'refunded'`))).map((r) => r.p))
    : new Set<string | null>();
  const people = (onTrip.length ? onTrip : household).map((p) => ({ id: p.id, name: personName(p) || t("es.list.forYou"), has: has.has(p.id) }));
  const base = { days, start, tripId, people, supplier: supplierName(), more: [] };
  if (!countries.length && !region) return { ...base, outcome: "none", where: null, plans: [], recommended: null, alt: null };
  const pricing = await esimPricing();
  let list = visible(pricing.rules, await packagesFor(countries));
  if (region) {
    // One region, as its own choice: only its plans.
    const rc = esimRegionCoverage(list, region);
    if (!rc) return { ...base, outcome: "none", where: null, plans: [], recommended: null, alt: null };
    list = list.filter((p) => p.coverage.code === rc.code && p.coverage.kind === rc.kind);
    countries = [...rc.countries];
  }
  const cov = esimCoverageFor(list, countries);
  const s = suggestEsimPlans(list, { countries, days, price: pricing.price, picks: cov ? pricing.rules.recommended[cov.code] : undefined });
  if (!s.coverage || !s.plans.length) {
    const near = countries.length === 1 ? esimNearest(list, countries[0]!) : null;
    return { ...base, outcome: "none", where: { countries, code: countries[0]!, kind: "local" }, plans: [], recommended: null, alt: near ? { code: near.code, kind: near.kind, name: near.name } : null };
  }
  // The prices shown are the traveller's for the hold window; a lower one already held stands.
  const shown = [...s.plans, ...s.more];
  await holdPrices(ownerId, shown.map((p) => ({ packageId: holdKey(p.id, p.daily, p.days), price: p.price.amount })), pricing.rules.holdMinutes).catch((e) => console.warn("[esim] price hold not kept", e instanceof Error ? e.message : e));
  const held = await Promise.all(shown.map((p) => heldPrice(ownerId, holdKey(p.id, p.daily, p.days)).catch(() => null)));
  const withHeld = shown.map((p, i) => (held[i] !== null && held[i]! < p.price.amount ? { ...p, price: { ...p.price, amount: held[i]! } } : p));
  return { ...base, outcome: "ok", where: { countries, code: s.coverage.code, kind: s.coverage.kind }, plans: withHeld.slice(0, s.plans.length), recommended: s.recommended, more: withHeld.slice(s.plans.length) };
}

/* ───────────── places ───────────── */

const PLACES_TTL_MS = 60 * 60_000;
let placesCache: { at: number; vendor: string; places: EsimPlace[] } | null = null;

/**
 * GET /esim/places: every country and region the supplier sells, from the catalogue synced each day (esim/catalogue.ts);
 * before the first sync, from the supplier's own full list. Kept for an hour.
 */
export async function esimPlaces(): Promise<EsimPlace[]> {
  const vendor = supplierName();
  if (placesCache && placesCache.vendor === vendor && Date.now() - placesCache.at < PLACES_TTL_MS) return placesCache.places;
  const pricing = await esimPricing();
  let pkgs: EsimPackage[] = [];
  try {
    const rows = await db.select({ pkg: appEsimCatalogue.pkg }).from(appEsimCatalogue).where(and(eq(appEsimCatalogue.supplier, vendor), isNull(appEsimCatalogue.goneAt)));
    pkgs = rows.map((r) => r.pkg as unknown as EsimPackage);
  } catch (e) { console.warn("[esim] catalogue not read for places", e instanceof Error ? e.message : e); }
  if (!pkgs.length) {
    const s = sup();
    pkgs = s.catalogue ? await s.catalogue() : await s.packages({ global: true });
  }
  const places = esimPlacesOf(visible(pricing.rules, pkgs));
  placesCache = { at: Date.now(), vendor, places };
  return places;
}
export const resetEsimPlacesCache = () => { placesCache = null; };

/* ───────────── the order sheet ───────────── */

type EsimDraft = { kind: "esim"; count: number; packageId?: string; where?: string; tripId?: string | null; travellerIds?: string[]; topupOf?: string; days?: number };

/** The price for this traveller: the one they were shown while its hold lasts, if lower than today's. */
async function unitPrice(ownerId: string, p: EsimPackage, price: (p: EsimPackage) => number): Promise<number> {
  const now = price(p);
  const held = await heldPrice(ownerId, holdKey(p.id, p.daily, p.days)).catch(() => null);
  return held !== null && held < now ? held : now;
}

/** The line, title and rule for an eSIM on the order sheet, priced from the supplier's own package. */
export async function priceEsim(ownerId: string, d: EsimDraft): Promise<{ lines: OrderLine[]; title: string; rule: string; place: string; snapshot: EsimSnapshot; travellerIds: string[] }> {
  const allowed = esimOrderingAllowed();
  if (!allowed.ok) { console.warn("[esim]", allowed.why); throw new AppError("NOT_CONFIGURED"); }
  const pricing = await esimPricing();
  if (d.topupOf) {
    const row = await ownEsim(ownerId, d.topupOf);
    if (!row.iccid || ["refunded", "ordering", "stuck"].includes(row.status)) throw new AppError("VALIDATION");
    const plan = row.plan as unknown as EsimPlan;
    const found = (await sup().topupPackages(row.iccid, row.supplierRef)).find((x) => x.id === d.packageId);
    if (!found) throw new AppError("NOT_FOUND");
    const p = forDays({ ...found, coverage: plan.coverage }, d.days ?? row.plan.days as number ?? 1);
    const unit = await unitPrice(ownerId, p, pricing.price);
    const where = whereName(plan.coverage);
    return {
      lines: [{ key: "esim", icon: "globe", text: t("pay.line.esimTopup", { size: sizeText(p.gb, p.days, p.daily) }), amount: unit }],
      title: t("pay.title.esimTopup", { where }), rule: t("pay.rule.esimPlan"), place: where, travellerIds: row.travellerId ? [row.travellerId] : [],
      snapshot: { packageId: p.id, coverage: plan.coverage, gb: p.gb, days: p.days, netUsd: p.netUsd, operator: plan.operator, topup: true, unit, count: 1, travellerIds: [], tripId: row.tripId, topupOf: row.id, apn: p.apn, roaming: p.roaming, daily: !!p.daily },
    };
  }
  if (!d.packageId) throw new AppError("VALIDATION");
  const code = d.where ?? "";
  const list = /^[A-Z]{2}$/.test(code) ? await packagesFor([code], pricing.rules.hidden) : visible(pricing.rules, await sup().packages({ global: true }));
  const found = list.find((x) => x.id === d.packageId);
  if (!found) throw new AppError("NOT_FOUND");
  const p = forDays(found, Math.max(1, Math.min(365, d.days ?? 7)));
  const travellers = d.travellerIds?.length ? await travellersOf(ownerId, d.travellerIds) : [];
  const count = travellers.length || d.count;
  let tripId: string | null = null;
  if (d.tripId && isUuid(d.tripId)) {
    const [trip] = await db.select({ id: appTrips.id }).from(appTrips).where(and(eq(appTrips.id, d.tripId), eq(appTrips.ownerId, ownerId)));
    tripId = trip?.id ?? null;
  }
  const unit = await unitPrice(ownerId, p, pricing.price);
  const where = whereName(p.coverage);
  return {
    lines: [{ key: "esim", icon: "globe", text: tn("pay.line.esimPlan", count, { where, size: sizeText(p.gb, p.days, p.daily) }), amount: unit * count }],
    title: t("pay.title.esimFor", { where }), rule: t("pay.rule.esimPlan"), place: where, travellerIds: travellers.map((x) => x.id),
    snapshot: { packageId: p.id, coverage: p.coverage, gb: p.gb, days: p.days, netUsd: p.netUsd, operator: p.operator, topup: p.topup, unit, count, travellerIds: travellers.map((x) => x.id), tripId, topupOf: null, apn: p.apn, roaming: p.roaming, daily: !!p.daily },
  };
}

/* ───────────── after the payment is captured ───────────── */

const descriptionOf = (o: Pick<OrderRow, "id">, topup: boolean) => `mada:${o.id}${topup ? ":topup" : ""}`;
const snapOf = (o: OrderRow) => (o.snapshot as { esim?: EsimSnapshot }).esim ?? null;

/** Ordered once the card is captured (or credit covered it). Safe to call again: it never buys twice. */
export async function fulfilEsimOrder(orderId: string, opts: { demoFail?: boolean; actor?: string } = {}): Promise<void> {
  const [o] = await db.select().from(appOrders).where(eq(appOrders.id, orderId));
  if (!o || o.kind !== "esim" || o.status !== "confirmed") return;
  const s = snapOf(o);
  if (!s) return;
  if (s.topupOf) return fulfilTopup(o, s, opts);
  // One row per eSIM, written before anything is bought (idempotent by order and index).
  const rows = Array.from({ length: s.count }, (_, i) => ({
    ownerId: o.ownerId, orderId: o.id, idx: i, tripId: s.tripId, travellerId: s.travellerIds[i] ?? null, supplier: supplierName(), packageId: s.packageId,
    plan: { id: s.packageId, coverage: s.coverage, gb: s.gb, days: s.days, operator: s.operator, topup: s.topup, ...(s.daily ? { daily: true } : {}) }, netUsdCents: Math.round(s.netUsd * 100), status: "ordering",
  }));
  await db.insert(appEsims).values(rows).onConflictDoNothing();
  if (s.tripId) await emitPlanEvent({ kind: "esim.bought", tripId: s.tripId, ownerId: o.ownerId });
  // Claim the purchase: one caller at a time; a claim older than CLAIM_MS (a crashed call) can be taken over.
  const claimed = await db.update(appEsims).set({ problem: "ordering", updatedAt: new Date() })
    .where(and(eq(appEsims.orderId, o.id), eq(appEsims.idx, 0), isNull(appEsims.iccid), inArray(appEsims.status, ["ordering", "stuck"]),
      or(isNull(appEsims.problem), sql`${appEsims.problem} <> 'ordering'`, lt(appEsims.updatedAt, new Date(Date.now() - CLAIM_MS))))).returning({ id: appEsims.id });
  if (!claimed.length) return;
  const description = descriptionOf(o, false);
  const [first] = await db.select({ supplierOrderId: appEsims.supplierOrderId }).from(appEsims).where(and(eq(appEsims.orderId, o.id), eq(appEsims.idx, 0)));
  let bought: EsimSupplierOrder | null = null;
  let refused: EsimRefused | null = null;
  try {
    bought = await sup().findOrder(description, first?.supplierOrderId ?? null);
    if (!bought) {
      try {
        bought = await sup().order({ packageId: s.packageId, quantity: s.count, description, days: s.daily ? s.days : undefined, demoFail: opts.demoFail });
      } catch (e) {
        if (!(e instanceof EsimRefused) || !e.duplicate) throw e;
        // Airalo saw the same order a second ago: it may have gone through. Look before anything else.
        await new Promise((r) => setTimeout(r, 1500));
        bought = await sup().findOrder(description, first?.supplierOrderId ?? null);
      }
    }
  } catch (e) {
    if (e instanceof EsimRefused) refused = e;
    else {
      // No answer: it may or may not have been bought. Look once more; otherwise the desk sorts it out (never a second buy).
      bought = await sup().findOrder(description, first?.supplierOrderId ?? null).catch(() => null);
      if (!bought) {
        await db.update(appEsims).set({ status: "stuck", problem: e instanceof Error ? e.message.slice(0, 200) : "no answer", updatedAt: new Date() }).where(eq(appEsims.orderId, o.id));
        await db.transaction(async (tx) => {
          await orderEvent(tx, o.id, "esim_stuck", { kind: "system" });
          await appAuditLog(tx, { actorKind: "system", actorId: null, action: "esim.stuck", entityType: "app_order", entityId: o.id, summary: "eSIM supplier didn't answer; nothing bought twice. Check on the desk." });
        });
        return;
      }
    }
  }
  if (refused?.lowBalance) {
    // Our balance at the supplier ran out: the traveller paid and is not the one to wait on a refund. Mada promises a
    // time, tops the balance up and orders again (esim/ops.ts); if the time passes first, the money goes back.
    await lowBalanceAfterPayment(o, s.count);
    return;
  }
  if (bought?.pending) {
    // Bought; the supplier is still making the eSIMs. Its webhook (or the cron) comes back here for them.
    await db.update(appEsims).set({ supplierOrderId: bought.id, problem: "waiting for the supplier", updatedAt: new Date() }).where(eq(appEsims.orderId, o.id));
    return;
  }
  if (!bought || bought.sims.length < s.count) {
    await refundOrder(o, s, { why: refused?.reason ?? "no eSIM came back", actor: opts.actor ?? null, rows: "all" });
    return;
  }
  await db.transaction(async (tx) => {
    for (const [i, sim] of bought!.sims.slice(0, s.count).entries()) {
      await tx.update(appEsims).set({ status: "ready", supplierOrderId: bought!.id, iccid: sim.iccid, supplierRef: sim.ref ?? null, install: installOf(sim), problem: null, dueAt: null, updatedAt: new Date() })
        .where(and(eq(appEsims.orderId, o.id), eq(appEsims.idx, i)));
    }
    await orderEvent(tx, o.id, "esim_ordered", { kind: "system" }, { supplierOrderId: bought!.id, count: s.count });
    await appAuditLog(tx, { actorKind: "system", actorId: null, action: "esim.ordered", entityType: "app_order", entityId: o.id, summary: `Bought ${s.count} eSIM(s) ${s.packageId} (supplier order ${bought!.id})` });
  });
}

const installOf = (s: EsimSim) => ({ lpa: s.lpa, smdp: s.smdp, matchingId: s.matchingId, iosLink: s.iosLink, apn: s.apn, roaming: s.roaming });

async function fulfilTopup(o: OrderRow, s: EsimSnapshot, opts: { demoFail?: boolean; actor?: string }) {
  const [row] = await db.select().from(appEsims).where(eq(appEsims.id, s.topupOf!));
  if (!row?.iccid) return;
  if ((row.topups ?? []).some((x) => (x as { orderId?: string }).orderId === o.id)) return;
  const description = descriptionOf(o, true);
  try {
    const found = await sup().findOrder(description);
    const r = found ? { id: found.id } : await sup().topup({ iccid: row.iccid, ref: row.supplierRef, packageId: s.packageId, description, days: s.daily ? s.days : undefined });
    await db.update(appEsims).set({
      topups: sql`${appEsims.topups} || ${JSON.stringify([{ orderId: o.id, supplierOrderId: r.id, packageId: s.packageId, gb: s.gb, days: s.days, at: new Date().toISOString() }])}::jsonb`,
      usageCheckedAt: null, status: row.status === "used_up" || row.status === "expired" ? "active" : row.status, updatedAt: new Date(),
    }).where(eq(appEsims.id, row.id));
  } catch (e) {
    if (!(e instanceof EsimRefused)) {
      const again = await sup().findOrder(description).catch(() => null);
      if (again) return fulfilTopup(o, s, opts);
    }
    await refundOrder(o, s, { why: e instanceof Error ? e.message : "top-up refused", actor: opts.actor ?? null, rows: "none" });
  }
}

/**
 * Money back for eSIMs we couldn't give (or the desk refunds): the card refund at once (or Mada credit back), recorded
 * in app_refunds, the eSIMs marked refunded with the outcome, the order closed with it, and a line to the traveller.
 */
async function refundOrder(o: OrderRow, s: EsimSnapshot, how: { why: string; actor: string | null; rows: "all" | "none" | string[]; amount?: number }) {
  const amount = how.amount ?? o.total;
  const credit = how.amount === undefined ? o.creditUsed : 0;
  const by = addDays(todayIn(), 10);
  let refunded = false;
  if (amount > 0 && o.paymentId) {
    const [p] = await db.select().from(appPayments).where(eq(appPayments.id, o.paymentId));
    if (p?.providerRef && ["captured", "partially_refunded"].includes(p.status)) {
      const r = await bookingSuppliers.payments().refund(p.providerRef, amount, `esim-refund:${o.id}:${how.rows === "all" || how.rows === "none" ? "order" : how.rows.join(",")}`).catch(() => null);
      refunded = !!r && (r.status === "refunded" || r.status === "partially_refunded");
      await db.insert(appRefunds).values({ paymentId: p.id, amount, stage: refunded ? "approved" : "requested", destination: "original", reason: `eSIM not delivered: ${how.why}`.slice(0, 200), expectedBy: new Date(Date.parse(`${by}T12:00:00Z`)), providerRef: r?.providerRef ?? null });
      if (refunded) await db.update(appPayments).set({ status: amount >= p.amount ? "refunded" : "partially_refunded", updatedAt: new Date() }).where(eq(appPayments.id, p.id));
    }
  }
  const result: RequestResult = {
    kind: "refused", reason: "sold_out", with: null, note: null,
    money: amount > 0 ? { kind: "refund", amount: money(amount), by } : credit > 0 ? { kind: "credit", amount: money(credit), by: null } : { kind: "none", amount: null, by: null },
    next: ["talk"], by: how.actor, at: new Date().toISOString(),
  };
  await db.transaction(async (tx) => {
    if (credit > 0) await addCredit(tx, { userId: o.ownerId, amount: credit, kind: "adjustment", note: "eSIM not delivered: credit back", actor: { kind: "system", id: null } });
    if (how.rows === "all") await tx.update(appEsims).set({ status: "refunded", result, problem: how.why.slice(0, 200), updatedAt: new Date() }).where(eq(appEsims.orderId, o.id));
    else if (Array.isArray(how.rows)) await tx.update(appEsims).set({ status: "refunded", result, problem: how.why.slice(0, 200), updatedAt: new Date() }).where(inArray(appEsims.id, how.rows));
    const whole = how.rows === "all" || how.rows === "none";
    if (whole) await tx.update(appOrders).set({ status: "cancelled", snapshot: { ...(o.snapshot as Record<string, unknown>), result }, updatedAt: new Date() }).where(eq(appOrders.id, o.id));
    await orderEvent(tx, o.id, "esim_refunded", how.actor ? { kind: "agent", name: how.actor } : { kind: "system" }, { amount, credit, why: how.why, cardRefunded: refunded });
    await appAuditLog(tx, { actorKind: how.actor ? "agent" : "system", actorId: how.actor, action: "esim.refunded", entityType: "app_order", entityId: o.id, summary: `eSIM refund of ${amount + credit} halalas (${how.why})${amount > 0 && !refunded ? "; card refund to do by hand" : ""}` });
  });
  await notify(o.ownerId, { kind: "refund_moved", level: "active", copy: "notify.esim.refund", vars: { amount: formatSar(amount + credit) }, href: s.topupOf ? `/esim/${s.topupOf}` : `/esims?order=${o.id}` }).catch(() => {});
}

/* ───────────── what the traveller sees ───────────── */

export async function ownEsim(ownerId: string, id: string): Promise<Row> {
  if (!isUuid(id)) throw new AppError("NOT_FOUND");
  const [r] = await db.select().from(appEsims).where(and(eq(appEsims.id, id), eq(appEsims.ownerId, ownerId)));
  if (!r) throw new AppError("NOT_FOUND");
  return r;
}

export function esimView(r: Row, names: Map<string, string> = new Map()): EsimView {
  const plan = r.plan as unknown as EsimView["plan"];
  return {
    id: r.id, orderId: r.orderId, tripId: r.tripId, travellerId: r.travellerId, travellerName: r.travellerId ? names.get(r.travellerId) ?? null : null,
    status: r.status as EsimView["status"], plan, where: whereName(plan.coverage), iccid: r.iccid, install: (r.install as EsimView["install"]) ?? null,
    usage: (r.usage as EsimUsage | null) ?? null,
    topups: (r.topups ?? []).map((x) => { const y = x as { gb: number | null; days: number; at: string }; return { gb: y.gb, days: y.days, at: y.at }; }),
    result: (r.result as RequestResult | null) ?? null, installedAt: r.installedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
    readyBy: r.status === "stuck" && r.dueAt ? r.dueAt.toISOString() : null,
  };
}

async function namesOf(ownerId: string): Promise<Map<string, string>> {
  return new Map((await householdOf(ownerId)).map((p) => [p.id, personName(p)]));
}

/** Usage from the supplier, at most every 20 minutes, and the status it implies. Never throws: the last read stands. */
async function refreshed(r: Row): Promise<Row> {
  if (!r.iccid || ["ordering", "refunded", "stuck"].includes(r.status)) return r;
  if (r.usageCheckedAt && Date.now() - r.usageCheckedAt.getTime() < USAGE_TTL_MS) return r;
  try {
    const u = await sup().usage(r.iccid, r.supplierRef);
    const status = esimStatusOf(r.status as EsimView["status"], u, !!r.installedAt);
    const [x] = await db.update(appEsims).set({ usage: u, usageCheckedAt: new Date(), status, updatedAt: new Date() }).where(eq(appEsims.id, r.id)).returning();
    return x ?? r;
  } catch {
    return r;
  }
}

export async function listEsims(ownerId: string, f: { orderId?: string | null; tripId?: string | null } = {}): Promise<EsimView[]> {
  const where = [eq(appEsims.ownerId, ownerId)];
  if (f.orderId) { if (!isUuid(f.orderId)) return []; where.push(eq(appEsims.orderId, f.orderId)); }
  if (f.tripId) { if (!isUuid(f.tripId)) return []; where.push(eq(appEsims.tripId, f.tripId)); }
  const rows = await db.select().from(appEsims).where(and(...where)).orderBy(desc(appEsims.createdAt), appEsims.idx).limit(50);
  const names = await namesOf(ownerId);
  const fresh = await Promise.all(rows.map(refreshed));
  return fresh.map((r) => esimView(r, names));
}

export async function getEsim(ownerId: string, id: string): Promise<EsimView> {
  return esimView(await refreshed(await ownEsim(ownerId, id)), await namesOf(ownerId));
}

/** The traveller says it's installed: it switches on when they land (the mock supplier starts counting from now). */
export async function markInstalled(ownerId: string, id: string): Promise<EsimView> {
  const r = await ownEsim(ownerId, id);
  if (!r.iccid || ["ordering", "refunded", "stuck"].includes(r.status)) throw new AppError("VALIDATION");
  if (!r.installedAt) {
    const now = new Date();
    if (r.supplier === "mock") markMockEsimInstalled(r.iccid, now.toISOString());
    await db.update(appEsims).set({ installedAt: now, status: r.status === "ready" ? "installed" : r.status, usageCheckedAt: null, updatedAt: now }).where(eq(appEsims.id, r.id));
  }
  return getEsim(ownerId, id);
}

export async function esimTopups(ownerId: string, id: string): Promise<{ esim: EsimView; plans: EsimPlan[] }> {
  const esim = await getEsim(ownerId, id);
  if (!esim.iccid || ["ordering", "refunded", "stuck"].includes(esim.status)) return { esim, plans: [] };
  const row = await ownEsim(ownerId, id);
  const [list, pricing] = await Promise.all([sup().topupPackages(esim.iccid, row.supplierRef).catch((e) => { if (e instanceof EsimRefused) return []; throw e; }), esimPricing()]);
  return { esim, plans: topupPlans(visible(pricing.rules, list).map((p) => ({ ...p, coverage: esim.plan.coverage })), undefined, pricing.price) };
}

/* ───────────── Airalo's webhook ───────────── */

/** Low data or near the end: a line to the traveller with Top up. Signed with our client secret. */
export async function airaloWebhook(raw: string, signature: string | null): Promise<{ ok: boolean }> {
  if (supplierMode("esim") === "live" && !verifyAiraloSignature(raw, signature)) throw new AppError("UNAUTHORIZED");
  const body = (() => { try { return JSON.parse(raw) as { level?: string; iccid?: string; remaining_percentage?: number }; } catch { return null; } })();
  if (!body?.iccid || !body.level) return { ok: true };
  const [r] = await db.select().from(appEsims).where(eq(appEsims.iccid, body.iccid));
  if (!r) return { ok: true };
  const plan = r.plan as unknown as { coverage: Coverage };
  const days = /^(\d+)days?$/.exec(body.level)?.[1];
  await db.update(appEsims).set({ usageCheckedAt: null }).where(eq(appEsims.id, r.id));
  await notify(r.ownerId, days
    ? { kind: "other", level: "active", copy: "notify.esim.ends", vars: { where: whereRef(plan.coverage), days: Number(days) }, href: `/esim/${r.id}` }
    : { kind: "other", level: "active", copy: "notify.esim.low", vars: { where: whereRef(plan.coverage), percent: Math.max(0, Math.round(body.remaining_percentage ?? (100 - Number(body.level.replace("%", "")) || 10))) }, href: `/esim/${r.id}` });
  return { ok: true };
}

/* ───────────── eSIM Access's webhook ───────────── */

type EaNotice = { notifyType?: string; notifyId?: string; content?: Record<string, unknown> };
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/**
 * eSIM Access's notices. They aren't signed: the URL's secret (or their sender IP) lets one in, each notifyId is
 * handled once, and nothing in the body is believed on its own: an order is looked up, an eSIM's usage read back.
 */
export async function esimAccessWebhook(raw: string, opts: { allowed: boolean }): Promise<{ ok: boolean }> {
  if (esimVendor() !== "mock" && !opts.allowed) throw new AppError("UNAUTHORIZED");
  const body = (() => { try { return JSON.parse(raw) as EaNotice; } catch { return null; } })();
  const type = body?.notifyType ?? "";
  const c = body?.content ?? {};
  if (!body || type === "CHECK_HEALTH" || !type) return { ok: true };
  if (body.notifyId) {
    const fresh = await db.insert(appEsimWebhooks).values({ notifyId: body.notifyId.slice(0, 80), type: type.slice(0, 40) }).onConflictDoNothing().returning({ id: appEsimWebhooks.notifyId });
    if (!fresh.length) return { ok: true };
  }
  if (type === "ORDER_STATUS") {
    const orderNo = str(c.orderNo);
    const tx = str(c.transactionId);
    const ours = tx?.startsWith("mada:") ? tx.slice(5).split(":")[0]! : null;
    const [row] = orderNo ? await db.select({ orderId: appEsims.orderId }).from(appEsims).where(eq(appEsims.supplierOrderId, orderNo)).limit(1) : [];
    const orderId = row?.orderId ?? (ours && isUuid(ours) ? ours : null);
    if (orderId) await fulfilEsimOrder(orderId);
    return { ok: true };
  }
  const ref = str(c.esimTranNo);
  const iccid = str(c.iccid);
  const [r] = ref ? await db.select().from(appEsims).where(eq(appEsims.supplierRef, ref)) : iccid ? await db.select().from(appEsims).where(eq(appEsims.iccid, iccid)) : [];
  if (!r) return { ok: true };
  const plan = r.plan as unknown as { coverage: Coverage };
  if (type === "ESIM_STATUS" || type === "SMDP_EVENT") {
    // On the phone now (or used up, ended): read it back, and mark it installed the first time the network sees it.
    const onPhone = ["INSTALLATION", "ENABLED", "DISABLED"].includes(String(c.smdpStatus ?? "")) || c.esimStatus === "IN_USE";
    await db.update(appEsims).set({ usageCheckedAt: null, ...(onPhone && !r.installedAt ? { installedAt: new Date(), status: r.status === "ready" ? "installed" : r.status } : {}), updatedAt: new Date() }).where(eq(appEsims.id, r.id));
    const [again] = await db.select().from(appEsims).where(eq(appEsims.id, r.id));
    if (again) await refreshed(again);
    return { ok: true };
  }
  if (type === "DATA_USAGE") {
    await db.update(appEsims).set({ usageCheckedAt: null }).where(eq(appEsims.id, r.id));
    const [again] = await db.select().from(appEsims).where(eq(appEsims.id, r.id));
    const u = (again ? await refreshed(again) : r).usage as EsimUsage | null;
    const left = u && !u.unlimited && u.totalMb ? u.leftMb ?? 0 : null;
    const percent = left !== null && u?.totalMb ? Math.round((left / u.totalMb) * 100) : null;
    // A notice at half left is too early to bother anyone; a quarter or less gets the line with Top up.
    if (percent !== null && percent <= 25) await notify(r.ownerId, { kind: "other", level: "active", copy: "notify.esim.low", vars: { where: whereRef(plan.coverage), percent: Math.max(0, percent) }, href: `/esim/${r.id}` });
    return { ok: true };
  }
  if (type === "VALIDITY_USAGE") {
    const days = Number(c.remain);
    if (Number.isFinite(days) && days >= 0 && days <= 3) await notify(r.ownerId, { kind: "other", level: "active", copy: "notify.esim.ends", vars: { where: whereRef(plan.coverage), days: Math.max(1, Math.round(days)) }, href: `/esim/${r.id}` });
    return { ok: true };
  }
  return { ok: true };
}

/* ───────────── the desk ───────────── */

export type DeskEsim = Row & { ref: string | null; ownerName: string | null; total: number; orderStatus: string };

export async function deskEsims(limit = 200): Promise<DeskEsim[]> {
  const rows = await db.select({ e: appEsims, ref: appOrders.ref, total: appOrders.total, orderStatus: appOrders.status, name: appUsers.name })
    .from(appEsims).innerJoin(appOrders, eq(appOrders.id, appEsims.orderId)).innerJoin(appUsers, eq(appUsers.id, appEsims.ownerId))
    .orderBy(desc(appEsims.createdAt)).limit(limit);
  return rows.map((x) => ({ ...x.e, ref: x.ref, ownerName: x.name, total: x.total, orderStatus: x.orderStatus }));
}

/** The install details again: a line in the traveller's inbox and a push that opens the install screen. */
export async function resendEsim(id: string, actor: { name: string; opsUserId?: string | null }): Promise<void> {
  const [r] = await db.select().from(appEsims).where(eq(appEsims.id, id));
  if (!r) throw new AppError("NOT_FOUND");
  if (!r.iccid || r.status === "refunded") throw new AppError("VALIDATION", { message: "This eSIM has no install codes to send." });
  const plan = r.plan as unknown as { coverage: Coverage };
  await notify(r.ownerId, { kind: "other", level: "active", copy: "notify.esim.resend", vars: { where: whereRef(plan.coverage) }, href: `/esim/${r.id}` });
  await db.transaction(async (tx) => {
    await orderEvent(tx, r.orderId, "esim_resent", { kind: "agent", name: actor.name }, { esimId: r.id });
    await appAuditLog(tx, { actorKind: "agent", actorId: actor.opsUserId ?? actor.name, action: "esim.resent", entityType: "app_esim", entityId: r.id, summary: `${actor.name} sent the install details again (${r.iccid})` });
  });
}

/** The desk refunds one eSIM: its share of the order back to the traveller; Airalo is asked for its money if never installed. */
export async function deskRefundEsim(id: string, actor: { name: string; opsUserId?: string | null }, reason: "INSTALLATION_FAILURE" | "NO_COVERAGE" | "TRIP_CANCELLATION" | "WRONG_PURCHASE" | "INCOMPATIBLE_DEVICE" | "OTHERS" = "OTHERS"): Promise<void> {
  const [r] = await db.select().from(appEsims).where(eq(appEsims.id, id));
  if (!r) throw new AppError("NOT_FOUND");
  if (r.status === "refunded") throw new AppError("VALIDATION", { message: "Already refunded." });
  const [o] = await db.select().from(appOrders).where(eq(appOrders.id, r.orderId));
  const s = o ? snapOf(o) : null;
  if (!o || !s) throw new AppError("NOT_FOUND");
  if (r.iccid) await sup().refund({ iccids: [r.iccid!], refs: [r.supplierRef], reason, notes: `Mada order ${o.ref ?? o.id}` }).catch((e) => console.warn("[esim] supplier refund not requested", e instanceof Error ? e.message : e));
  const unit = s.unit || Math.round(o.total / Math.max(1, s.count));
  await refundOrder(o, s, { why: `refunded by ${actor.name}`, actor: actor.name, rows: [r.id], amount: Math.min(unit, o.total) });
}

/** The desk tries a stuck order again: looks it up at the supplier first, so it never buys twice. */
export async function deskRetryEsim(orderId: string, actor: { name: string }): Promise<void> {
  await db.update(appEsims).set({ problem: null, status: "ordering", dueAt: null }).where(and(eq(appEsims.orderId, orderId), eq(appEsims.status, "stuck")));
  await fulfilEsimOrder(orderId, { actor: actor.name });
}

/** One eSIM for the desk's order view: the row, its order and owner, usage read fresh (at most every 20 minutes). */
export async function deskEsim(id: string): Promise<(DeskEsim & { topupPlans: EsimPackage[] }) | null> {
  if (!isUuid(id)) return null;
  const [x] = await db.select({ e: appEsims, ref: appOrders.ref, total: appOrders.total, orderStatus: appOrders.status, name: appUsers.name })
    .from(appEsims).innerJoin(appOrders, eq(appOrders.id, appEsims.orderId)).innerJoin(appUsers, eq(appUsers.id, appEsims.ownerId)).where(eq(appEsims.id, id));
  if (!x) return null;
  const e = await refreshed(x.e);
  const live = e.iccid && !["refunded", "ordering", "stuck", "expired"].includes(e.status);
  const topupPlans = live ? await sup().topupPackages(e.iccid!, e.supplierRef).catch(() => [] as EsimPackage[]) : [];
  return { ...e, ref: x.ref, ownerName: x.name, total: x.total, orderStatus: x.orderStatus, topupPlans };
}

/** The traveller's eSIMs, for the desk's chat thread (newest first). */
export async function deskEsimsOf(userId: string, limit = 5): Promise<Row[]> {
  if (!isUuid(userId)) return [];
  return db.select().from(appEsims).where(eq(appEsims.ownerId, userId)).orderBy(desc(appEsims.createdAt)).limit(limit);
}

/** The desk tops an eSIM up on the traveller's behalf (Mada pays: a goodwill gesture or a fix), never twice for one ask. */
export async function deskTopupEsim(id: string, packageId: string, actor: { name: string; opsUserId?: string | null }, askId: string): Promise<void> {
  const [r] = await db.select().from(appEsims).where(eq(appEsims.id, id));
  if (!r?.iccid || ["refunded", "ordering", "stuck"].includes(r.status)) throw new AppError("VALIDATION", { message: "This eSIM can't take a top-up." });
  const p = (await sup().topupPackages(r.iccid, r.supplierRef)).find((x) => x.id === packageId);
  if (!p) throw new AppError("NOT_FOUND");
  const description = `mada:desk:${askId}`.slice(0, 50);
  if ((r.topups ?? []).some((x) => (x as { description?: string }).description === description)) return;
  const done = await sup().findOrder(description).catch(() => null);
  const t1 = done ? { id: done.id } : await sup().topup({ iccid: r.iccid, ref: r.supplierRef, packageId, description, days: p.daily ? 1 : undefined });
  const plan = r.plan as unknown as { coverage: Coverage };
  await db.transaction(async (tx) => {
    await tx.update(appEsims).set({
      topups: sql`${appEsims.topups} || ${JSON.stringify([{ description, supplierOrderId: t1.id, packageId, gb: p.gb, days: p.days, at: new Date().toISOString(), by: actor.name }])}::jsonb`,
      usageCheckedAt: null, status: r.status === "used_up" || r.status === "expired" ? "active" : r.status, updatedAt: new Date(),
    }).where(eq(appEsims.id, r.id));
    await orderEvent(tx, r.orderId, "esim_topped_up", { kind: "agent", name: actor.name }, { esimId: r.id, packageId });
    await appAuditLog(tx, { actorKind: "agent", actorId: actor.opsUserId ?? actor.name, action: "esim.desk_topup", entityType: "app_esim", entityId: r.id, summary: `${actor.name} topped up ${r.iccid} with ${packageId} (${p.netUsd} USD, on Mada)` });
  });
  await notify(r.ownerId, { kind: "other", level: "active", copy: "notify.esim.topped", vars: { where: whereRef(plan.coverage), size: sizeText(p.gb, p.days, p.daily) }, href: `/esim/${r.id}` }).catch(() => {});
}

/** A line from the desk to the traveller about this eSIM, in the agent's own words. */
export async function deskNoteEsim(id: string, note: string, actor: { name: string; opsUserId?: string | null }): Promise<void> {
  const [r] = await db.select().from(appEsims).where(eq(appEsims.id, id));
  if (!r) throw new AppError("NOT_FOUND");
  const text = note.trim().slice(0, 300);
  if (!text) throw new AppError("VALIDATION", { message: "Write the note first." });
  const plan = r.plan as unknown as { coverage: Coverage };
  await notify(r.ownerId, { kind: "other", level: "active", copy: "notify.esim.note", vars: { where: whereRef(plan.coverage), name: actor.name, note: text }, href: `/esim/${r.id}` });
  await db.transaction(async (tx) => {
    await orderEvent(tx, r.orderId, "esim_note", { kind: "agent", name: actor.name }, { esimId: r.id, note: text });
    await appAuditLog(tx, { actorKind: "agent", actorId: actor.opsUserId ?? actor.name, action: "esim.note", entityType: "app_esim", entityId: r.id, summary: `${actor.name} wrote to the traveller about ${r.iccid ?? "an eSIM"}` });
  });
}

/** Money back for an order whose eSIMs never came (ops: the promised time passed). */
export async function refundUndelivered(orderId: string, why: string): Promise<void> {
  const [o] = await db.select().from(appOrders).where(eq(appOrders.id, orderId));
  const s = o ? snapOf(o) : null;
  if (!o || !s || o.status !== "confirmed") return;
  const rows = await db.select().from(appEsims).where(eq(appEsims.orderId, orderId));
  if (rows.some((r) => r.iccid)) return;
  await refundOrder(o, s, { why, actor: null, rows: "all" });
}
