import "server-only";
import { and, gte, ilike, notInArray, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { appOrderCosts } from "@/db/app-schema-finance";
import { esimBalance } from "@/lib/app/esim/ops";
import { esimVendor } from "@/lib/app/suppliers";
import { getSettings } from "@/lib/settings";
import { sarPerUnit } from "./costs";
import { APP_CHANNEL } from "./ops-posting";

/*
 * Supplier balances (DESK-PLAN U6, screen 10). One row per supplier the app buys from:
 *   eSIM Access  prepaid: the live balance (esim/ops.ts, read every 15 minutes, or now from this page), the owner's
 *                low-balance threshold, a day of orders from the last 7 days, and the days that leaves
 *   Hotelbeds    billed on credit: the credit line from Rules & limits; used = app sales with Hotelbeds still unpaid
 *   TBO          the same (TBO's own balance call isn't wired: shown as "not connected")
 *   Airalo       only when it is the eSIM supplier in use
 * Balances are SAR halalas; eSIM Access answers in USD and is shown in both.
 */

export type SupplierBalance = {
  key: string; name: string; kind: "prepaid" | "credit";
  state: "ok" | "low" | "not_connected" | "not_set" | "not_used";
  balance: number | null; // halalas left (prepaid balance, or credit line less used)
  balanceUsd?: number | null;
  line: number | null; used: number | null; threshold: number | null;
  burnPerDay: number; daysLeft: number | null; lastRead: string | null; error: string | null; console: string | null; note: string;
};

/** What a supplier cost us per day over the last 7 days of app sales (halalas). */
async function burnPerDay(supplier: string, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const [r] = await db.select({ s: sql<number>`coalesce(sum(${appOrderCosts.netSar}),0)::bigint`.mapWith(Number) }).from(appOrderCosts)
    .where(and(eq(appOrderCosts.supplier, supplier), gte(appOrderCosts.businessDate, since)));
  return Math.round((r?.s ?? 0) / 7);
}

/** App sales with this supplier whose cost we haven't paid yet (Ops Payables marks them paid). */
async function owedTo(supplier: string): Promise<number> {
  const [r] = await db.select({ s: sql<number>`coalesce(sum(${schema.bookings.netCost}),0)::bigint`.mapWith(Number) }).from(schema.bookings)
    .where(and(eq(schema.bookings.channel, APP_CHANNEL), ilike(schema.bookings.supplier, `%${supplier}%`), eq(schema.bookings.supplierPaid, false), notInArray(schema.bookings.status, ["void", "refunded", "draft"])));
  return r?.s ?? 0;
}

const days = (left: number | null, burn: number) => (left === null || burn <= 0 ? null : Math.max(0, Math.floor(left / burn)));

export async function supplierBalances(opts: { fresh?: boolean } = {}): Promise<SupplierBalance[]> {
  const s = await getSettings();
  const usd = sarPerUnit("USD") ?? 3.75;
  const vendor = esimVendor();
  const [esim, esimBurn, hbBurn, hbOwed, tboBurn, tboOwed] = await Promise.all([
    esimBalance({ fresh: opts.fresh }), burnPerDay(vendor === "mock" ? "mock" : "esimaccess"), burnPerDay("hotelbeds"), owedTo("hotelbeds"), burnPerDay("tbo"), owedTo("tbo"),
  ]);
  const esimLeft = esim.usd === null ? null : Math.round(esim.usd * usd * 100);
  const esimDayBurn = Math.max(esimBurn, Math.round(esim.dayUsd * usd * 100));
  const credit = (key: string, name: string, line: number, used: number, burn: number, consoleUrl: string, note: string): SupplierBalance => {
    const left = line > 0 ? line - used : null;
    return { key, name, kind: "credit", state: line <= 0 ? "not_set" : left !== null && (left < 0 || (burn > 0 && left < burn * 3)) ? "low" : "ok",
      balance: left, line: line || null, used, threshold: line > 0 ? burn * 3 : null, burnPerDay: burn, daysLeft: days(left, burn), lastRead: null, error: null, console: consoleUrl, note };
  };
  const rows: SupplierBalance[] = [
    {
      key: "esimaccess", name: "eSIM Access", kind: "prepaid",
      state: vendor === "airalo" ? "not_used" : esim.usd === null ? "not_connected" : esim.low ? "low" : "ok",
      balance: esimLeft, balanceUsd: esim.usd, line: null, used: null, threshold: Math.round(esim.thresholdUsd * usd * 100), burnPerDay: esimDayBurn, daysLeft: days(esimLeft, esimDayBurn),
      lastRead: esim.at, error: esim.error, console: "https://console.esimaccess.com", note: vendor === "mock" ? "Test supplier: the balance is the mock's" : "Prepaid. Top up in the eSIM Access console",
    },
    credit("hotelbeds", "Hotelbeds", s.appHotelbedsCreditLine, hbOwed, hbBurn, "https://www.hotelbeds.com/", "Billed on credit. Hotelbeds has no balance call: used is what Payables still owes them"),
    { ...credit("tbo", "TBO", s.appTboCreditLine, tboOwed, tboBurn, "https://www.tboair.com/", "Billed on credit. TBO's own balance call isn't connected yet: used is what Payables still owes them") },
  ];
  if (vendor === "airalo") rows.push({ key: "airalo", name: "Airalo", kind: "prepaid", state: "not_connected", balance: null, line: null, used: null, threshold: null, burnPerDay: await burnPerDay("airalo"), daysLeft: null, lastRead: null, error: null, console: "https://partners.airalo.com", note: "Airalo's balance isn't read yet" });
  return rows;
}
