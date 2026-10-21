/**
 * Demo data for the live board and drop-offs, on top of the desk seed (src/lib/app/desk/seed.ts):
 *   npx tsx --conditions=react-server src/lib/app/desk/seed-board.ts
 * Orders across the lifecycle (an eSIM in use, a trip under way, one back home, a bank check left pending, a friend's
 * share unpaid, ticketing failed), searches and pay sheets left behind, declined cards, and one drop-off already ignored.
 * Runs once: it stops if the search log has rows. Local databases only.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { asc } from "drizzle-orm";
import * as app from "../../../db/app-schema";
import * as booking from "../../../db/app-schema-booking";
import * as esim from "../../../db/app-schema-esim";
import * as drop from "../../../db/app-schema-dropoffs";

const url = process.env.DATABASE_URL ?? "postgres://mada:mada@localhost:5432/mada_ops";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && process.env.ALLOW_DESK_SEED !== "yes") throw new Error("The board demo seed only runs against a local database");
const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const db = drizzle(client);

const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000);
const day = (offsetDays = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(NOW + offsetDays * 86400_000));
const H = (sar: number) => Math.round(sar * 100);

async function main() {
  if ((await db.select({ id: drop.appSearchLog.id }).from(drop.appSearchLog).limit(1)).length) { console.log("Board demo data already there. Nothing to do."); return; }
  const users = await db.select().from(app.appUsers).orderBy(asc(app.appUsers.createdAt)).limit(8);
  if (users.length < 7) throw new Error("Run the desk demo seed first (src/lib/app/desk/seed.ts)");
  const [a, b, c, d, e, f, g] = [0, 1, 2, 3, 4, 5, 6].map((i) => users[i]!) as [typeof users[number], typeof users[number], typeof users[number], typeof users[number], typeof users[number], typeof users[number], typeof users[number]];
  let seq = 0;

  const order = async (o: { who: string; kind?: string; status: string; title: string; total: number; createdMin: number; updatedMin?: number; tripId?: string | null; ref?: string; supplierRef?: string; pay?: string; snapshot?: Record<string, unknown> }) => {
    seq += 1;
    const [p] = o.pay ? await db.insert(app.appPayments).values({ ownerId: o.who, method: "card", status: o.pay, amount: o.total, label: "Visa ending 41", provider: "mock", idempotencyKey: `board-seed:${seq}:${NOW}`, createdAt: ago(o.createdMin), updatedAt: ago(o.updatedMin ?? o.createdMin) }).returning() : [null];
    const [row] = await db.insert(booking.appOrders).values({
      ownerId: o.who, kind: o.kind ?? "trip", status: o.status, idempotencyKey: `board-seed:${seq}:${NOW}`, draft: {}, snapshot: { title: o.title, ...(o.snapshot ?? {}) },
      lines: [{ key: "x", icon: "plane", text: o.title, amount: o.total }], subtotal: o.total, total: o.total, paymentLabel: "Visa ending 41", paymentMethod: { method: "card" },
      paymentId: p?.id ?? null, tripId: o.tripId ?? null, ref: o.ref ?? `MT-${(4200 + seq).toString(36).toUpperCase()}`, supplierRef: o.supplierRef ?? null, createdAt: ago(o.createdMin), updatedAt: ago(o.updatedMin ?? o.createdMin),
    }).returning();
    return row!;
  };
  const trip = async (who: string, city: string, start: string, end: string) =>
    (await db.insert(app.appTrips).values({ ownerId: who, city, startDate: start, endDate: end, status: "booked" }).returning())[0]!.id;

  /* ── the board ── */
  const away = await trip(b.id, "Baku", day(-2), day(3));
  await order({ who: b.id, status: "confirmed", title: "Riyadh to Baku, 5 nights", total: H(6240), createdMin: 60 * 24 * 9, tripId: away, supplierRef: "K7Q2LM", pay: "captured" });
  const home = await trip(c.id, "Cairo", day(-12), day(-6));
  await order({ who: c.id, status: "confirmed", title: "Jeddah to Cairo, return", total: H(2180), createdMin: 60 * 24 * 20, tripId: home, supplierRef: "C4ZP9T", pay: "captured" });
  const next = await trip(d.id, "Tbilisi", day(16), day(21));
  await order({ who: d.id, kind: "package", status: "confirmed", title: "Tbilisi, flights and 5 nights", total: H(9870), createdMin: 60 * 26, tripId: next, supplierRef: "TB8812", pay: "captured", snapshot: { stay: { hotel: { supplier: "hotelbeds" } } } });
  const sim = await order({ who: e.id, kind: "esim", status: "confirmed", title: "Türkiye eSIM · 10 GB · 15 days", total: H(119), createdMin: 60 * 30, pay: "captured" });
  await db.insert(esim.appEsims).values({ ownerId: e.id, orderId: sim.id, idx: 0, supplier: "esimaccess", packageId: "TR-10-15", plan: { coverage: { name: "Türkiye", code: "TR" }, gb: 10, days: 15 }, status: "active", iccid: `8990011${NOW.toString().slice(-12)}` });
  await order({ who: f.id, status: "ticketing_failed", title: "Riyadh to Kuala Lumpur, 4 travellers", total: H(14320), createdMin: 50, updatedMin: 25, pay: "authorized" });
  await order({ who: a.id, status: "requires_action", title: "Riyadh to Istanbul, 2 travellers", total: H(4310), createdMin: 95, pay: "requires_action" });
  await order({ who: c.id, status: "payment_requested", title: "Dubai for four, Hessa pays", total: H(7600), createdMin: 60 * 3 });

  /* ── drop-offs ── */
  await db.insert(drop.appSearchLog).values([
    { userId: a.id, kind: "flight", summary: "RUH → Istanbul · 14 Nov – 19 Nov · 2 travellers · economy", value: H(2150), results: 14, at: ago(140) },
    { userId: d.id, kind: "flight", summary: "JED → London · 2 Dec – 12 Dec · 4 travellers · economy", value: H(13980), results: 9, at: ago(55) },
    { userId: e.id, kind: "stay", summary: "Stay in Dubai · 20 Nov · 3 nights · 2 travellers", value: H(2460), results: 22, at: ago(6 * 60) },
    { userId: f.id, kind: "flight", summary: "RUH → Baku · 28 Nov – 3 Dec · 1 traveller · economy", value: H(1390), results: 6, at: ago(8) },
    { userId: b.id, kind: "pay_sheet", summary: "Riyadh to Tbilisi, flights and 4 nights", value: H(8640), at: ago(42) },
    { userId: f.id, kind: "pay_sheet", summary: "Riyadh to Cairo, return", value: H(1960), at: ago(60 * 26) },
  ]);
  const declined = async (who: string, amount: number, min: number) => { seq += 1; await db.insert(app.appPayments).values({ ownerId: who, method: "card", status: "declined", amount, label: "Mastercard ending 09", provider: "mock", idempotencyKey: `board-seed:${seq}:${NOW}`, createdAt: ago(min), updatedAt: ago(min) }); };
  await declined(f.id, H(1960), 60 * 25);
  await declined(f.id, H(1960), 60 * 25 - 3);
  await declined(d.id, H(5420), 4);
  const [ignored] = await db.insert(drop.appSearchLog).values({ userId: g.id, kind: "flight", summary: "RUH → Male · 1 Jan – 8 Jan · 2 travellers · business", value: H(31200), results: 3, at: ago(60 * 30) }).returning();
  await db.insert(drop.appDropoffMarks).values({ key: `search:${ignored!.id}`, userId: g.id, status: "ignored", note: "Was comparing prices for a friend" });
  console.log("Board demo data loaded: 7 orders across the lifecycle, 7 searches and pay sheets, 3 declined cards, 1 drop-off ignored.");
}

main().then(() => client.end()).catch(async (err) => { console.error(err); await client.end(); process.exit(1); });
