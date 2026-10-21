/**
 * Demo data for the desk's customer pages (DESK-PLAN U3), on top of the desk seed (src/lib/app/desk/seed.ts):
 *   npx tsx --conditions=react-server src/lib/app/desk/seed-customers.ts
 * Gives Sara an eSIM (ICCID 8997212330012345678), an Ask conversation handed to the desk, what Mada remembers and
 * some goodwill credit; adds Yousef, who has nothing open, an Ask conversation that wasn't handed over, and an eSIM.
 * Runs once: it stops if Sara already has an Ask conversation. Local databases only.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as app from "../../../db/app-schema";
import { appOrders } from "../../../db/app-schema-booking";
import { appEsims } from "../../../db/app-schema-esim";
import { appAskMemory, appAskThreads } from "../../../db/app-schema-ask";

const url = process.env.DATABASE_URL ?? "postgres://mada:mada@localhost:5432/mada_ops";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && process.env.ALLOW_DESK_SEED !== "yes") throw new Error("The desk demo seed only runs against a local database");
const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const db = drizzle(client);
const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000);

const plan = (name: string, code: string, gb: number | null, days: number) => ({ id: `${code.toLowerCase()}-${days}d`, coverage: { kind: "country", code, name, countries: [code] }, gb, days, size: "m", fits: true, operator: "Turkcell", topup: true });

async function esim(ownerId: string, iccid: string, p: ReturnType<typeof plan>, status: string, min: number) {
  const [o] = await db.insert(appOrders).values({ ownerId, kind: "esim", status: "confirmed", idempotencyKey: `seed-esim:${iccid}`, draft: {}, snapshot: {}, lines: [{ key: "esim", icon: "sim", text: `${p.coverage.name} eSIM · ${p.gb ?? "∞"} GB`, amount: 7900 }],
    subtotal: 7900, total: 7900, paymentLabel: "Apple Pay", paymentMethod: { kind: "applepay" }, ref: `ES-${iccid.slice(-6)}`, confirmedAt: ago(min), createdAt: ago(min) }).returning();
  await db.insert(appEsims).values({ ownerId, orderId: o!.id, idx: 0, supplier: "mock", packageId: p.id, plan: p, netUsdCents: 1150, status, iccid, supplierRef: `T${iccid.slice(-8)}`, createdAt: ago(min) });
}

const turn = (who: "me" | "mada", text: string, cards?: string[]) => ({ who, text, ...(cards ? { cards } : {}) });

async function main() {
  const [sara] = await db.select().from(app.appUsers).where(eq(app.appUsers.phone, "+966500004127"));
  if (!sara) throw new Error("Run the desk seed first (src/lib/app/desk/seed.ts)");
  const has = await db.select({ id: appAskThreads.id }).from(appAskThreads).where(eq(appAskThreads.ownerId, sara.id)).limit(1);
  if (has.length) { console.log("Customer demo data already there. Nothing to do."); return; }

  await esim(sara.id, "8997212330012345678", plan("Türkiye", "TR", 10, 15), "installed", 60 * 24 * 2);
  await db.insert(appAskThreads).values({ ownerId: sara.id, lang: "en", turns: 3, createdAt: ago(95), updatedAt: ago(80),
    // The model-facing history keeps the tool call, which is how the desk knows it was handed over.
    messages: [{ role: "assistant", content: [{ type: "tool_use", id: "toolu_seed", name: "talk_to_human", input: { summary: "Wants seats together for the family on SV263", urgent: false } }] }],
    transcript: [
      turn("me", "Can the four of us sit together on the Istanbul flight?"),
      turn("mada", "Seats on Saudia SV263 are picked by the airline at check-in. I can ask the team to request seats together for the four of you."),
      turn("me", "Yes please, Layan is 11 and Fahad is 8"),
      turn("mada", "Handed to the desk: Faisal is on duty and has the summary. He'll confirm the seat numbers in your chat."),
    ] });
  await db.insert(appAskMemory).values([
    { ownerId: sara.id, kind: "seat", text: "Prefers aisle seats, children next to a parent", createdAt: ago(60 * 24 * 12), lastUsedAt: ago(90) },
    { ownerId: sara.id, kind: "home_airport", text: "Flies from Riyadh (RUH)", createdAt: ago(60 * 24 * 30) },
    { ownerId: sara.id, kind: "food", text: "Halal meals; Fahad is allergic to nuts", createdAt: ago(60 * 24 * 12) },
  ]);
  await db.insert(app.appCreditLedger).values({ userId: sara.id, amount: 15000, kind: "goodwill", note: "Sorry for the wait on your Istanbul booking", createdAt: ago(60 * 24 * 3) });

  const [yousef] = await db.insert(app.appUsers).values({ name: "Yousef Alenazi", phone: "+966500004140", email: "yousef.alenazi@example.com", emailVerified: true, phoneVerified: true, locale: "ar",
    onboardedAt: ago(60 * 24 * 9), createdAt: ago(60 * 24 * 10) }).returning();
  await db.insert(app.appPeople).values({ ownerId: yousef!.id, isSelf: true, givenNames: "Yousef", surname: "Alenazi", relation: "self", dateOfBirth: "1991-02-14", sex: "M", nationality: "SAU" });
  await esim(yousef!.id, "8997212330098765432", plan("United Arab Emirates", "AE", null, 5), "active", 60 * 24 * 4);
  await db.insert(appAskThreads).values({ ownerId: yousef!.id, lang: "ar", turns: 2, createdAt: ago(60 * 5), updatedAt: ago(60 * 5 - 3), messages: [],
    transcript: [turn("me", "كم سعر شريحة للإمارات خمسة أيام؟"), turn("mada", "عندنا باقة غير محدودة لخمسة أيام بـ 79 ريال.", ["esim_plans"]), turn("me", "تمام، اشتريتها"), turn("mada", "ممتاز، الشريحة جاهزة في رحلاتك.")] });
  await db.insert(appAskMemory).values({ ownerId: yousef!.id, kind: "home_airport", text: "يسافر من الرياض", createdAt: ago(60 * 5) });
  console.log("Customer demo data loaded: 2 eSIMs, 2 Ask conversations (one handed over), 4 remembered facts, SAR 150 goodwill, 1 traveller.");
}

main().then(() => client.end()).catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
