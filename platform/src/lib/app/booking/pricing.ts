import "server-only";
import { and, eq, sql } from "drizzle-orm";
import {
  DESK_PRICES, DESTINATIONS, PLANS, PreviewBody, bundleFor, checkPromo, freeUntilLabel, instalments, money, rangeLabel, sarToHalalas, t, tn, roomsFor,
  type CopyKey, type FlightOption, type OrderLine, type OrderPreview, type StayOption, type Person, type PreviewBody as PreviewInput,
} from "@mada/shared";
import { db } from "@/db";
import { appCreditLedger, appQuotes, appRequests } from "@/db/app-schema";
import { AppError } from "../http";
import { householdOf, isUuid, today, travellersOf } from "./common";
import { ownOffer, repriceOffer, type OfferRow } from "./search";

/*
 * The order sheet: lines, the all-in total, promo code, Mada credit, instalments and the cancellation rule worked out
 * from this booking's own dates. The server prices; the app shows what comes back and sends the total it accepted.
 */

export type Priced = {
  preview: OrderPreview;
  /** What the order keeps: the offers it was priced from. */
  snapshot: Record<string, unknown>;
  travellers: Person[];
  offerRows: OfferRow[];
  place: string;
};

export async function creditBalance(userId: string): Promise<number> {
  const [r] = await db.select({ s: sql<string>`COALESCE(SUM(${appCreditLedger.amount}), 0)` }).from(appCreditLedger).where(eq(appCreditLedger.userId, userId));
  return Number(r?.s ?? 0);
}

const line = (key: string, icon: OrderLine["icon"], text: string, amount: number): OrderLine => ({ key, icon, text, amount });

export async function priceDraft(ownerId: string, input: PreviewInput, opts: { bump?: number } = {}): Promise<Priced> {
  const body = PreviewBody.parse(input);
  const d = body.draft;
  let lines: OrderLine[] = [];
  let title = "";
  let photo = "istanbul-galata";
  let rule = "";
  let agent = true;
  let hold: Date | null = null;
  let travellers: Person[] = [];
  let place = "";
  const offerRows: OfferRow[] = [];
  const snapshot: Record<string, unknown> = { draft: d };

  if (d.kind === "trip") {
    travellers = await travellersOf(ownerId, d.travellerIds);
    let row = await ownOffer(ownerId, d.flightOfferId);
    if (row.kind !== "flight") throw new AppError("NOT_FOUND");
    const before = row.payload as unknown as FlightOption;
    if (before.adults !== travellers.length) row = (await repriceOffer(ownerId, row.id, travellers.length)).row;
    const f = row.payload as unknown as FlightOption;
    const search = row.search as { destination: string; depart: string; return: string | null };
    const dest = DESTINATIONS[search.destination]!;
    const n = travellers.length;
    const oneway = !f.back;
    const how = f.stop ? t("pay.line.oneStop") : t("pay.line.direct");
    const suffix = `${f.cabin !== "economy" ? ` · ${t(`cal.cabin.${f.cabin}` as CopyKey)}` : ""}${oneway ? ` · ${t("pay.line.oneWay")}` : ""}`;
    lines.push(line("flight", "flight", `${tn("pay.line.flight", n, { airline: f.airline, how })}${suffix}`, f.pricePerPerson.amount * n + (opts.bump ?? 0)));
    if (f.infants) lines.push(line("infants", "flight", tn("pay.line.infants", f.infants), f.infantPrice.amount * f.infants));
    const bundle = d.bundle && dest.key === "istanbul" && !!f.back;
    if (bundle) {
      const b = bundleFor(n, f.out.date, f.back!.date);
      lines.push(line("stay", "stay", t("pay.line.stay", { rooms: n > 2 ? t("pay.line.connecting") : t("pay.line.aRoom"), count: b.nights }), sarToHalalas(b.staySar)));
      lines.push(line("pickup", "car", oneway ? t("pay.line.pickupOut") : t("pay.line.pickupBoth"), sarToHalalas(b.pickupSar)));
    }
    rule = (f.refundable ? t("pay.rule.refund", { fee: f.refundRule.replace(/^Refund minus /, "") }) : t("pay.rule.noRefund", { fee: f.changeRule }))
      + (bundle ? ` ${t("pay.rule.rooms", { date: freeUntilLabel(f.out.date) })}` : "");
    title = `${dest.name} · ${rangeLabel(f.out.date, f.back?.date ?? null)}`;
    photo = dest.photo;
    place = dest.name;
    hold = row.expiresAt;
    offerRows.push(row);
    snapshot.flight = f;
    snapshot.search = search;
    snapshot.bundle = bundle;
  } else if (d.kind === "stay") {
    travellers = await travellersOf(ownerId, d.travellerIds);
    let row = await ownOffer(ownerId, d.stayOfferId);
    if (row.kind !== "stay") throw new AppError("NOT_FOUND");
    const before = row.payload as unknown as StayOption;
    // Rooms are priced by party size (one room for two or fewer, connecting rooms for more).
    if (before.rooms !== roomsFor(travellers.length)) row = (await repriceOffer(ownerId, row.id, travellers.length)).row;
    const s = row.payload as unknown as StayOption;
    const end = new Date(Date.parse(`${s.checkIn}T00:00:00Z`) + s.nights * 86_400_000).toISOString().slice(0, 10);
    lines = [line("stay", "stay", t("pay.line.hotel", { rooms: s.roomsLabel, dates: rangeLabel(s.checkIn, end), count: s.nights }), s.total.amount)];
    rule = t("pay.rule.stay", { date: freeUntilLabel(s.checkIn) });
    title = s.name;
    photo = s.photo;
    place = DESTINATIONS[(row.search as { destination: string }).destination]?.name ?? "";
    hold = row.expiresAt;
    offerRows.push(row);
    snapshot.stay = s;
    snapshot.search = row.search;
  } else if (d.kind === "package") {
    const plan = PLANS[d.planId];
    if (!plan) throw new AppError("NOT_FOUND");
    travellers = await travellersOf(ownerId, d.travellerIds);
    const n = travellers.length;
    if (plan.price.flights) lines.push(line("flight", "flight", t("pay.line.planFlights", { count: n, city: plan.city }), sarToHalalas((plan.price.flights * n) / 2)));
    if (plan.price.stay) lines.push(line("stay", "stay", tn("pay.line.planStay", Math.max(1, plan.days - 1), { rooms: n > 2 ? t("pay.line.connecting") : t("pay.line.aRoom") }), sarToHalalas(plan.price.stay)));
    lines.push(line("tours", "star", t("pay.line.planTours", { count: n }), sarToHalalas((plan.price.experiences * n) / 4)));
    rule = t("pay.rule.package");
    title = plan.title;
    photo = plan.photo;
    place = plan.city;
    snapshot.plan = { id: plan.id, title: plan.title, city: plan.city, sub: plan.sub };
  } else if (d.kind === "quote") {
    if (!isUuid(d.requestId)) throw new AppError("NOT_FOUND");
    const [r] = await db.select().from(appRequests).where(and(eq(appRequests.id, d.requestId), eq(appRequests.ownerId, ownerId)));
    if (!r) throw new AppError("NOT_FOUND");
    const [q] = await db.select().from(appQuotes).where(and(eq(appQuotes.requestId, r.id), eq(appQuotes.status, "open"))).orderBy(sql`${appQuotes.createdAt} DESC`).limit(1);
    if (!q) throw new AppError("NOT_FOUND");
    const det = r.details as { askKind?: string; title?: string };
    lines = [line("quote", "doc", det.askKind === "visa" ? t("pay.line.quoteVisa") : t("pay.line.quote"), q.total)];
    rule = t("pay.rule.quote");
    title = det.title ?? r.summary;
    agent = false;
    photo = det.askKind === "umrah" ? "makkah-clock-tower" : det.askKind === "visa" ? "passport-boarding-pass" : "istanbul-galata";
    travellers = r.travellerIds.length ? await travellersOf(ownerId, r.travellerIds) : [];
    place = title;
    hold = q.expiresAt;
    snapshot.quote = { id: q.id, requestId: r.id, total: q.total };
  } else {
    lines = [line("esim", "globe", t("pay.line.esim", { count: d.count }), sarToHalalas(DESK_PRICES.esimEach * d.count))];
    rule = t("pay.rule.esim");
    title = t("pay.title.esim");
    agent = false;
    photo = "istanbul-galata";
    place = title;
  }

  const subtotal = lines.reduce((a, l) => a + l.amount, 0);
  const promo = checkPromo(body.promo, today(), subtotal);
  const discount = promo?.status === "applied" ? promo.discount : 0;
  const balance = await creditBalance(ownerId);
  const creditUsed = body.useCredit ? Math.max(0, Math.min(balance, subtotal - discount)) : 0;
  const total = subtotal - discount - creditUsed;
  const household = travellers.length ? await householdOf(ownerId) : [];
  const missing = travellers.filter((p) => !household.find((h) => h.id === p.id)?.passport).map((p) => p.id);
  const preview: OrderPreview = {
    kind: d.kind, title, photo, lines, subtotal: money(subtotal),
    promo: promo ? { code: promo.code, status: promo.status, message: promo.message, discount: money(discount) } : null,
    credit: { balance: money(balance), used: money(creditUsed) }, total: money(total), rule, agent,
    holdExpiresAt: hold ? hold.toISOString() : null,
    instalments: total >= 100_000 ? { tabby: money(instalments(total, 4)[0]!), tamara: money(instalments(total, 3)[0]!) } : null,
    travellerIds: travellers.map((p) => p.id),
    missingPassports: d.kind === "trip" || d.kind === "package" ? missing : [],
  };
  return { preview, snapshot, travellers, offerRows, place };
}
