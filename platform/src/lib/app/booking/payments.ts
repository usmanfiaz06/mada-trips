import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { PaymentWebhookBody, t, type DemoFlag, type PaymentChoice, type PayPlan } from "@mada/shared";
import { db, type Tx } from "@/db";
import { appPayments } from "@/db/app-schema";
import { appCards } from "@/db/app-schema-wallet";
import { appOrders, appPaymentWebhooks } from "@/db/app-schema-booking";
import { cardLabel, ownCard } from "../account/cards";
import { appAuditLog } from "../audit";
import { isProductionDeploy, supplierMode } from "../config";
import { decryptField } from "../crypto";
import { AppError } from "../http";
import { bookingSuppliers } from "./common";

/*
 * Money for orders: authorise when the order is made (captured on issue in desk.ts, voided if issuing fails),
 * 3-D Secure, Tabby/Tamara, Mada credit, and the provider's webhook (idempotent by event id, signature checked).
 * Card numbers never reach us: a saved card is the provider's token (app_cards, encrypted); a new card is a token the
 * app got from the provider's SDK on the phone.
 */

export type Charge = { method: string; provider: string; token: string | null; label: string; instalments: number };

/** What the traveller chose, as the provider will see it. */
export async function chargeFor(ownerId: string, choice: PaymentChoice, plan: PayPlan, total: number, demo: Set<DemoFlag>): Promise<Charge> {
  const mock = supplierMode("payments") === "mock";
  if (total === 0 || choice.method === "credit") return { method: "credit", provider: "mada_credit", token: null, label: t("pay.paidCredit"), instalments: 1 };
  if (plan !== "full" && choice.method !== "applepay" && total >= 100_000) {
    if (!mock) throw new AppError("NOT_CONFIGURED");
    return { method: plan, provider: plan, token: `${plan}_session`, label: plan === "tabby" ? "Tabby" : "Tamara", instalments: plan === "tabby" ? 4 : 3 };
  }
  if (choice.method === "applepay") return { method: "applepay", provider: "myfatoorah", token: choice.token, label: "Apple Pay", instalments: 1 };
  if (choice.method === "new_card") {
    if (!mock && /^tok_mock_/.test(choice.token)) throw new AppError("VALIDATION", { fields: { token: "mock" } });
    // A card that's new to the bank's records asks for a code first (3-D Secure).
    return { method: choice.brand === "mada" ? "mada" : "card", provider: "myfatoorah", token: mock ? `${choice.token}_3ds` : choice.token, label: cardLabel(choice), instalments: 1 };
  }
  const c = await ownCard(ownerId, choice.cardId);
  let token = decryptField(c.tokenEnc, `app_cards:${c.id}:token`);
  if (mock) {
    const [first] = await db.select({ id: appCards.id }).from(appCards).where(and(eq(appCards.userId, ownerId), isNull(appCards.deletedAt))).orderBy(asc(appCards.createdAt)).limit(1);
    if (demo.has("decline") && first?.id === c.id) token = "tok_decline";
    else if (demo.has("needs3ds")) token = `${token}_3ds`;
  }
  return { method: c.brand === "mada" ? "mada" : "card", provider: "myfatoorah", token, label: cardLabel(c), instalments: 1 };
}

const providerName = (provider: string) => (provider === "myfatoorah" ? (supplierMode("payments") === "live" ? "myfatoorah" : "mock") : provider);

/** Authorise now; returns the payment row. Declines and 3-D Secure come back as the row's status. */
export async function authorize(tx: Tx, ownerId: string, c: Charge, amount: number, key: string, description: string, requestId: string | null) {
  let status: string = "authorized";
  let providerRef: string | null = null;
  if (c.provider === "myfatoorah") {
    const r = await bookingSuppliers.payments().authorize({ amount, method: c.method === "mada" ? "mada" : c.method === "applepay" ? "applepay" : "card", token: c.token ?? "", idempotencyKey: key, description, instalments: 1 });
    status = r.status;
    providerRef = r.providerRef;
  } else if (c.provider === "tabby" || c.provider === "tamara") {
    providerRef = `${c.provider}_${key.slice(0, 24)}`;
  } else {
    providerRef = null;
  }
  const [p] = await tx.insert(appPayments).values({
    ownerId, requestId, method: c.method, status, amount, label: c.label, instalments: c.instalments, provider: providerName(c.provider), providerRef, idempotencyKey: key,
  }).returning();
  await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: `payment.${status}`, entityType: "app_payment", entityId: p!.id, summary: `${c.label}: ${status} for ${amount} halalas` });
  return p!;
}

/** The same method again, for a new amount (fare accepted) or a second try by phone. */
export async function reauthorize(tx: Tx, o: typeof appOrders.$inferSelect, amount: number): Promise<string | null> {
  const m = o.paymentMethod as { method?: string; cardId?: string; plan?: PayPlan; provider?: string; label?: string };
  if (!o.paymentId && m.method === "credit") return null;
  let token = "tok_mock_reauth";
  if (m.method === "card" && m.cardId) {
    const c = await ownCard(o.ownerId, m.cardId);
    token = decryptField(c.tokenEnc, `app_cards:${c.id}:token`);
  } else if (supplierMode("payments") === "live" && m.provider === "myfatoorah") {
    // A one-time token (Apple Pay, a card not saved) can't be charged again without the traveller: the desk calls.
    throw new AppError("NOT_CONFIGURED");
  }
  const c: Charge = { method: m.method === "applepay" ? "applepay" : "card", provider: m.provider ?? "myfatoorah", token, label: o.paymentLabel, instalments: m.plan === "tabby" ? 4 : m.plan === "tamara" ? 3 : 1 };
  const p = await authorize(tx, o.ownerId, c, amount, `${o.idempotencyKey}:re:${Date.now()}`, `Booking ${o.id}`, o.requestId);
  if (p.status !== "authorized") throw new AppError("VALIDATION", { message: t("pay.declined.title") });
  return p.id;
}

/* ───────────── webhook ───────────── */

const DEV_WEBHOOK_SECRET = "dev-only-myfatoorah-webhook-secret";
export function webhookSecret(): string {
  const s = process.env.MYFATOORAH_WEBHOOK_SECRET;
  if (s) return s;
  if (isProductionDeploy()) throw new AppError("NOT_CONFIGURED");
  return DEV_WEBHOOK_SECRET;
}
export const signWebhook = (raw: string, secret = webhookSecret()) => createHmac("sha256", secret).update(raw).digest("hex");

const ORDER = ["initiated", "requires_action", "authorized", "captured", "partially_refunded", "refunded"];

/** POST /payments/webhook. A repeated event id is answered without moving anything (idempotent). */
export async function handleWebhook(raw: string, signature: string | null): Promise<{ duplicate: boolean; result: string }> {
  const expected = Buffer.from(signWebhook(raw), "hex");
  const got = Buffer.from((signature ?? "").replace(/^sha256=/, ""), "hex");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new AppError("UNAUTHORIZED");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new AppError("VALIDATION"); }
  const ev = PaymentWebhookBody.safeParse(parsed);
  if (!ev.success) throw new AppError("VALIDATION");
  const e = ev.data;
  return db.transaction(async (tx) => {
    const [pay] = await tx.select().from(appPayments).where(eq(appPayments.providerRef, e.providerRef)).for("update");
    const [rec] = await tx.insert(appPaymentWebhooks).values({
      provider: "myfatoorah", eventId: e.eventId, type: e.type, providerRef: e.providerRef, payloadSha256: createHash("sha256").update(raw).digest("hex"),
      result: pay ? "applied" : "unknown_payment",
    }).onConflictDoNothing().returning({ id: appPaymentWebhooks.id });
    if (!rec) return { duplicate: true, result: "duplicate" };
    if (!pay) return { duplicate: false, result: "unknown_payment" };
    const next = { "payment.authorized": "authorized", "payment.captured": "captured", "payment.voided": "voided", "payment.declined": "declined", "payment.refunded": "refunded" }[e.type];
    const forward = next === "voided" || next === "declined" ? ["initiated", "requires_action", "authorized"].includes(pay.status) : ORDER.indexOf(next) > ORDER.indexOf(pay.status);
    if (!forward) return { duplicate: false, result: "ignored" };
    await tx.update(appPayments).set({ status: next, updatedAt: new Date() }).where(eq(appPayments.id, pay.id));
    await appAuditLog(tx, { actorKind: "system", actorId: "myfatoorah", action: `payment.${next}`, entityType: "app_payment", entityId: pay.id, summary: `Provider reported ${next}`, data: { eventId: e.eventId } });
    // 3-D Secure finished on the bank's page: the order goes to the desk.
    if (next === "authorized") await tx.update(appOrders).set({ status: "pending_agent", updatedAt: new Date() }).where(and(eq(appOrders.paymentId, pay.id), eq(appOrders.status, "requires_action")));
    if (next === "declined") await tx.update(appOrders).set({ status: "declined", updatedAt: new Date() }).where(and(eq(appOrders.paymentId, pay.id), eq(appOrders.status, "requires_action")));
    return { duplicate: false, result: "applied" };
  });
}
