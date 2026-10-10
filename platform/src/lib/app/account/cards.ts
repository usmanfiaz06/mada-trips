import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { AddCardRequest, CardsResponse, SavedCard } from "@mada/shared";
import { db } from "@/db";
import { appAccounts, appCards } from "@/db/app-schema-wallet";
import { appAuditLog } from "../audit";
import { encryptField } from "../crypto";
import { AppError } from "../http";
import { supplierMode } from "../config";
import { accountRow } from "./index";

/*
 * Saved cards (Profile → Paying, Wallet → Cards and Apple Pay, FLOWS.md §9). Card numbers never reach Mada: the app
 * tokenises with the payment provider's SDK and sends the token plus what's printed on the front. The token is
 * encrypted at rest and only the payments code reads it. The default is a card or Apple Pay.
 */

type CardRow = typeof appCards.$inferSelect;
const BRAND_NAME = { visa: "Visa", mastercard: "Mastercard", mada: "mada" } as const;
const tokenAad = (cardId: string) => `app_cards:${cardId}:token`;

export const cardLabel = (c: Pick<CardRow, "brand" | "last4">) => `${BRAND_NAME[c.brand as keyof typeof BRAND_NAME] ?? "Card"} ending ${c.last4.slice(-2)}`;

function toCard(c: CardRow): SavedCard {
  return { id: c.id, brand: c.brand as SavedCard["brand"], label: cardLabel(c), last4: c.last4, exp: c.exp, createdAt: c.createdAt.toISOString() };
}

async function liveCards(userId: string) {
  return db.select().from(appCards).where(and(eq(appCards.userId, userId), isNull(appCards.deletedAt))).orderBy(asc(appCards.createdAt));
}

export async function listCards(userId: string): Promise<CardsResponse> {
  const [cards, acc] = await Promise.all([liveCards(userId), accountRow(userId)]);
  const defaultId = cards.some((c) => c.id === acc.defaultCard) ? acc.defaultCard : "applepay";
  return { cards: cards.map(toCard), defaultId };
}

export async function ownCard(userId: string, id: string): Promise<CardRow> {
  const [c] = await db.select().from(appCards).where(and(eq(appCards.id, id), eq(appCards.userId, userId), isNull(appCards.deletedAt)));
  if (!c) throw new AppError("NOT_FOUND");
  return c;
}

function expired(exp: string, now = new Date()) {
  const [mm, yy] = exp.split("/").map(Number) as [number, number];
  const y = 2000 + yy;
  return mm < 1 || mm > 12 || y < now.getUTCFullYear() || (y === now.getUTCFullYear() && mm < now.getUTCMonth() + 1);
}

export async function addCard(userId: string, input: AddCardRequest, ipHash: string | null): Promise<CardsResponse> {
  if (expired(input.exp)) throw new AppError("VALIDATION", { copy: "cards.problem.expired", fields: { exp: "expired" } });
  // A live provider token looks nothing like a mock one; never store a mock token against live payments.
  if (supplierMode("payments") === "live" && /^tok_mock_/.test(input.token)) throw new AppError("VALIDATION", { fields: { token: "mock" } });
  await db.transaction(async (tx) => {
    await accountRow(userId, tx);
    const [c] = await tx.insert(appCards).values({ userId, brand: input.brand, last4: input.last4, exp: input.exp, provider: supplierMode("payments") === "live" ? "myfatoorah" : "mock", tokenEnc: "pending" }).returning();
    await tx.update(appCards).set({ tokenEnc: encryptField(input.token, tokenAad(c!.id)) }).where(eq(appCards.id, c!.id));
    if (input.makeDefault !== false) await tx.update(appAccounts).set({ defaultCard: c!.id, updatedAt: new Date() }).where(eq(appAccounts.userId, userId));
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "card.added", entityType: "app_card", entityId: c!.id, summary: `Saved ${cardLabel(c!)}`, ipHash });
  });
  return listCards(userId);
}

export async function setDefault(userId: string, id: string, ipHash: string | null): Promise<CardsResponse> {
  if (id !== "applepay") await ownCard(userId, id);
  await accountRow(userId);
  await db.update(appAccounts).set({ defaultCard: id, updatedAt: new Date() }).where(eq(appAccounts.userId, userId));
  await appAuditLog(db, { actorKind: "user", actorId: userId, action: "card.default_set", entityType: "app_card", entityId: id === "applepay" ? null : id, summary: id === "applepay" ? "Apple Pay is the default" : "Changed the default card", ipHash });
  return listCards(userId);
}

/** Remove a card. Removing the default needs the new default first, unless it's the only card (then Apple Pay). */
export async function removeCard(userId: string, id: string, newDefault: string | null, ipHash: string | null): Promise<CardsResponse> {
  const c = await ownCard(userId, id);
  const { cards, defaultId } = await listCards(userId);
  const others = cards.filter((x) => x.id !== id);
  let next: string | null = null;
  if (defaultId === id) {
    if (others.length && !newDefault) throw new AppError("VALIDATION", { copy: "error.defaultCard", fields: { newDefault: "required" } });
    next = newDefault ?? "applepay";
    if (next === id || (next !== "applepay" && !others.some((x) => x.id === next))) throw new AppError("VALIDATION", { fields: { newDefault: "Not one of your cards" } });
  }
  await db.transaction(async (tx) => {
    await tx.update(appCards).set({ deletedAt: new Date(), tokenEnc: "removed" }).where(eq(appCards.id, id));
    if (next) await tx.update(appAccounts).set({ defaultCard: next, updatedAt: new Date() }).where(eq(appAccounts.userId, userId));
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "card.removed", entityType: "app_card", entityId: id, summary: `Removed ${cardLabel(c)}`, ipHash });
  });
  return listCards(userId);
}
