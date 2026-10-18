import "server-only";
import { and, eq, sql } from "drizzle-orm";
import {
  DESK_PRICES, DESTINATIONS, PLANS, childSeats, fareToFlightOption, PreviewBody, bundleFor, checkPromo, freeUntilLabel, instalments, money, rangeLabel, sarToHalalas, t, tn, roomsFor,
  BookingPrefs, airlineRequests, bookingPrefsOf, formatSar, hotelRemarks, loyaltyToAttach, maskLoyalty, prefScope, prefsSummary, programmeFor, programmeName, seatsTogetherOffer,
  type AppliedPrefs, type BookingLoyalty, type CopyKey, type FlightOption, type OrderLine, type OrderPreview, type StayOption, type Person, type PreviewBody as PreviewInput,
  type DemoFlag, demoPassportTarget, entryChecks, familyLines, renewalsOf,
} from "@mada/shared";
import { db } from "@/db";
import { appMessages, appQuotes, appRequests } from "@/db/app-schema";
import { appCircleSplitShares } from "@/db/app-schema-circles";
import { membership } from "../circles/circles";
import { getBalance } from "../credit";
import { AppError } from "../http";
import { householdOf, isUuid, renewalsAsked, today, travellersOf } from "./common";
import { getAccount } from "../account";
import { ownOffer, repriceOffer, type OfferRow } from "./search";
import { hotelbedsRule, withHotelbedsEssentials } from "./hotelbeds-stays";
import { cityOf, flightQuoteOf, pickOption, type FlightSearch } from "./flight-requests";
import { priceEsim } from "../esim/service";

/*
 * The order sheet: lines, the all-in total, promo code, Mada credit, instalments and the cancellation rule worked out
 * from this booking's own dates. The server prices; the app shows what comes back and sends the total it accepted.
 */

/** What the order keeps of the preferences: the prefs as applied, the numbers in full, and what each supplier gets. */
export type AppliedSnapshot = {
  prefs: BookingPrefs; loyalty: BookingLoyalty[]; ssr: string[]; remarks: string[]; hotelRemarks: string[]; summary: string[];
  extras: { seatsTogether: { count: number; legs: number; perPerson: number; total: number } | null };
};

export type Priced = {
  preview: OrderPreview;
  /** What the order keeps: the offers it was priced from. */
  snapshot: Record<string, unknown>;
  travellers: Person[];
  offerRows: OfferRow[];
  place: string;
};

export const creditBalance = (userId: string) => getBalance(userId);

const line = (key: string, icon: OrderLine["icon"], text: string, amount: number): OrderLine => ({ key, icon, text, amount });

/** The short passports on this booking, as the order sheet shows them (OrderPreview.renewals). */
export async function renewalsFor(ownerId: string, search: unknown, travellers: Person[], demo?: Set<DemoFlag>, household?: Promise<Person[]>) {
  const s = search as { destination?: string; depart?: string; checkIn?: string; return?: string | null } | undefined;
  if (!s?.destination || !DESTINATIONS[s.destination] || !travellers.length) return { renewals: [], checks: null };
  const [asked, people] = await Promise.all([renewalsAsked(ownerId), demo?.has("passportProblem") ? household ?? householdOf(ownerId) : Promise.resolve(null)]);
  const checks = entryChecks({
    destination: s.destination, travellers, depart: s.depart ?? s.checkIn ?? today(), return: s.return ?? null, answers: asked, today: today(),
    demo: { passportProblemFor: people ? demoPassportTarget(people) : null },
  });
  return { renewals: renewalsOf(checks), checks };
}

/**
 * The seats on a flight, priced as the airline prices them: one line for everyone when nobody is on a child fare,
 * else the adults and the child fares on their own lines (FareBreakdown in the app shows the same amounts).
 */
function seatLines(f: FlightOption, n: number, how: string, suffix: string, bump: number): OrderLine[] {
  const kids = Math.min(f.children ?? 0, n);
  const child = (f.childPrice ?? f.pricePerPerson).amount;
  if (!kids || kids === n) return [line("flight", "flight", `${tn("pay.line.flight", n, { airline: f.airline, how })}${suffix}`, (kids ? child : f.pricePerPerson.amount) * n + bump)];
  return [
    line("flight", "flight", `${tn("pay.line.adults", n - kids, { airline: f.airline, how })}${suffix}`, f.pricePerPerson.amount * (n - kids) + bump),
    line("children", "flight", tn("pay.line.children", kids), child * kids),
  ];
}

export async function priceDraft(ownerId: string, input: PreviewInput, opts: { bump?: number; demo?: Set<DemoFlag> } = {}): Promise<Priced> {
  const body = PreviewBody.parse(input);
  const d = body.draft;
  // Read up front, alongside whatever the draft needs (each query is a round trip): the household and the credit.
  const household = householdOf(ownerId);
  const balanceP = creditBalance(ownerId);
  const accountP = getAccount(ownerId);
  household.catch(() => {});
  balanceP.catch(() => {});
  accountP.catch(() => {});
  let lines: OrderLine[] = [];
  let title = "";
  let photo = "istanbul-galata";
  let rule = "";
  let agent = true;
  let hold: Date | null = null;
  let travellers: Person[] = [];
  let stayFacts: OrderPreview["stay"] = null;
  let place = "";
  let kind: OrderPreview["kind"] = d.kind;
  const offerRows: OfferRow[] = [];
  const snapshot: Record<string, unknown> = { draft: d };

  if (d.kind === "trip") {
    let row: OfferRow;
    [travellers, row] = await Promise.all([travellersOf(ownerId, d.travellerIds, household), ownOffer(ownerId, d.flightOfferId)]);
    if (row.kind !== "flight") throw new AppError("NOT_FOUND");
    const before = row.payload as unknown as FlightOption;
    // Children 2 to 11 and babies with a seat on the child fare, by their age on the day out.
    const kids = childSeats(travellers, before.out.date);
    if (before.adults !== travellers.length || (before.children ?? 0) !== kids) row = (await repriceOffer(ownerId, row.id, travellers.length, kids)).row;
    const f = row.payload as unknown as FlightOption;
    const search = row.search as { destination: string; depart: string; return: string | null };
    const dest = DESTINATIONS[search.destination]!;
    const n = travellers.length;
    const oneway = !f.back;
    const how = f.stop ? t("pay.line.oneStop") : t("pay.line.direct");
    const suffix = `${f.cabin !== "economy" ? ` · ${t(`cal.cabin.${f.cabin}` as CopyKey)}` : ""}${oneway ? ` · ${t("pay.line.oneWay")}` : ""}`;
    lines.push(...seatLines(f, n, how, suffix, opts.bump ?? 0));
    if (f.infants) lines.push(line("infants", "flight", tn("pay.line.infants", f.infants), f.infantPrice.amount * f.infants));
    const bundle = d.bundle && dest.key === "istanbul" && !!f.back;
    if (bundle) {
      const b = bundleFor(n, f.out.date, f.back!.date);
      lines.push(line("stay", "stay", t("pay.line.stay", { hotel: b.hotel.name, rooms: n > 2 ? t("pay.line.connecting") : t("pay.line.aRoom"), count: b.nights }), sarToHalalas(b.staySar)));
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
    let row: OfferRow;
    [travellers, row] = await Promise.all([travellersOf(ownerId, d.travellerIds, household), ownOffer(ownerId, d.stayOfferId)]);
    if (row.kind !== "stay") throw new AppError("NOT_FOUND");
    const before = row.payload as unknown as StayOption;
    // Rooms are priced by party size (one room for two or fewer, connecting rooms for more).
    if (before.rooms !== roomsFor(travellers.length)) row = (await repriceOffer(ownerId, row.id, travellers.length)).row;
    // Hotelbeds: checkrates for a RECHECK rate, and the rate's essential information, before the traveller pays.
    if (row.supplier === "hotelbeds") row = await withHotelbedsEssentials(ownerId, row);
    const s = row.payload as unknown as StayOption;
    const end = new Date(Date.parse(`${s.checkIn}T00:00:00Z`) + s.nights * 86_400_000).toISOString().slice(0, 10);
    lines = [line("stay", "stay", t("pay.line.hotel", { rooms: s.roomsLabel, dates: rangeLabel(s.checkIn, end), count: s.nights }), s.total.amount)];
    // A Hotelbeds room carries the hotel's own rule (worked out from its cancellation policies); the catalogue uses ours.
    rule = row.supplier === "hotelbeds" ? hotelbedsRule(s) : t("pay.rule.stay", { date: freeUntilLabel(s.checkIn) });
    stayFacts = {
      name: s.name, checkIn: s.checkIn, nights: s.nights, freeCancelUntil: s.freeCancelUntil, refundable: s.facts ? s.facts.refundable : !!s.freeCancelUntil,
      payAtHotel: s.facts?.payAtHotel ? money(s.facts.payAtHotel) : null, essentials: s.hotel?.rateComments?.trim() || null, facts: s.facts ?? null,
    };
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
    travellers = await travellersOf(ownerId, d.travellerIds, household);
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
    const det = r.details as { askKind?: string; title?: string; search?: FlightSearch | null };
    const fq = flightQuoteOf(q.offerSnapshot);
    if (fq) {
      // A fare the desk is holding (flights by request): an agent issues the tickets, so it's authorised now and
      // captured when they do, like any flight booking.
      const o = pickOption(fq, d.optionId);
      if (!o) throw new AppError("NOT_FOUND");
      travellers = r.travellerIds.length ? await travellersOf(ownerId, r.travellerIds, household) : [];
      const search = det.search ?? { destination: null, destinationName: null, from: null, depart: null, return: null, cabin: null, carrier: null };
      const f = fareToFlightOption(o, (q.expiresAt ?? new Date(Date.now() + 3600_000)).toISOString(), q.id);
      const infants = o.prices.filter((p) => p.type === "infant");
      const how = f.stop ? t("pay.line.oneStop") : t("pay.line.direct");
      const suffix = `${o.cabin !== "economy" ? ` · ${t(`cal.cabin.${o.cabin}` as CopyKey)}` : ""}${f.back ? "" : ` · ${t("pay.line.oneWay")}`}`;
      // The desk's own price per passenger: adults and children each at what the airline quoted.
      const sum = (type: string) => o.prices.filter((p) => p.type === type).reduce((a, p) => a + p.amount.amount, 0);
      const kidsN = o.prices.filter((p) => p.type === "child").length;
      const adultsN = o.prices.filter((p) => p.type === "adult").length;
      lines = kidsN && adultsN
        ? [line("flight", "flight", `${tn("pay.line.adults", adultsN, { airline: o.airline, how })}${suffix}`, sum("adult")), line("children", "flight", tn("pay.line.children", kidsN), sum("child"))]
        : [line("flight", "flight", `${tn("pay.line.flight", adultsN + kidsN, { airline: o.airline, how })}${suffix}`, sum("adult") + sum("child"))];
      if (infants.length) lines.push(line("infants", "flight", tn("pay.line.infants", infants.length), infants.reduce((a, p) => a + p.amount.amount, 0)));
      rule = o.refundable ? t("pay.rule.refund", { fee: o.refundRule.replace(/^Refund minus /, "") }) : t("pay.rule.noRefund", { fee: o.changeRule });
      const dest = search.destination ? DESTINATIONS[search.destination] ?? null : null;
      place = cityOf(search) || o.legs[0]!.to;
      title = `${place} · ${rangeLabel(f.out.date, f.back?.date ?? null)}`;
      photo = dest?.photo ?? "riyadh-kingdom-centre";
      hold = q.expiresAt;
      kind = "trip";
      snapshot.flight = f;
      snapshot.quotedFlight = o;
      snapshot.search = { ...search, destination: search.destination ?? "", depart: f.out.date, return: f.back?.date ?? null };
      snapshot.quote = { id: q.id, requestId: r.id, optionId: o.id, total: o.total.amount, pnr: (q.offerSnapshot as { pnr?: string | null } | null)?.pnr ?? null };
    } else {
    lines = [line("quote", "doc", det.askKind === "visa" ? t("pay.line.quoteVisa") : t("pay.line.quote"), q.total)];
    rule = t("pay.rule.quote");
    title = det.title ?? r.summary;
    agent = false;
    photo = det.askKind === "umrah" ? "makkah-clock-tower" : det.askKind === "visa" ? "passport-boarding-pass" : "istanbul-galata";
    travellers = r.travellerIds.length ? await travellersOf(ownerId, r.travellerIds, household) : [];
    place = title;
    hold = q.expiresAt;
    snapshot.quote = { id: q.id, requestId: r.id, total: q.total };
    }
  } else if (d.kind === "share") {
    // Your share of a circle's split: you must be in the circle, the share must be yours, and not yet settled.
    if (!isUuid(d.circleId) || !isUuid(d.messageId)) throw new AppError("NOT_FOUND");
    const circle = await membership(d.circleId, ownerId);
    const [m] = await db.select({ card: appMessages.card }).from(appMessages)
      .where(and(eq(appMessages.id, d.messageId), eq(appMessages.threadKind, "circle"), eq(appMessages.threadId, d.circleId)));
    const card = m?.card as { t?: string; what?: string; cancelled?: boolean } | null | undefined;
    if (!card || card.t !== "split") throw new AppError("NOT_FOUND");
    // A booking a friend was asked to pay, cancelled by its owner since: nothing to pay any more.
    if (card.cancelled) throw new AppError("VALIDATION", { message: t("pay.shareGone") });
    const [share] = await db.select().from(appCircleSplitShares).where(and(eq(appCircleSplitShares.messageId, d.messageId), eq(appCircleSplitShares.key, d.shareKey)));
    if (!share || !share.userIds.includes(ownerId)) throw new AppError("NOT_FOUND");
    if (share.paidAt) throw new AppError("VALIDATION", { message: t("pay.shareGone") });
    lines = [line("share", "doc", t("pay.line.share", { what: card.what ?? "" }), Number(share.amount))];
    rule = t("pay.rule.share");
    title = t("pay.title.share", { circle: circle.name });
    agent = false;
    photo = "riyadh-kingdom-centre";
    place = circle.name;
    snapshot.share = { circleId: d.circleId, messageId: d.messageId, key: d.shareKey, amount: Number(share.amount) };
  } else if (d.packageId || d.topupOf) {
    // A plan from the eSIM supplier (esim/service.ts), priced from its own package; ordered once the card is captured.
    const e = await priceEsim(ownerId, d);
    lines = e.lines;
    rule = e.rule;
    title = e.title;
    agent = false;
    photo = "inflight-window";
    place = e.place;
    travellers = e.travellerIds.length ? await travellersOf(ownerId, e.travellerIds, household) : [];
    snapshot.esim = e.snapshot;
  } else {
    lines = [line("esim", "globe", t("pay.line.esim", { count: d.count }), sarToHalalas(DESK_PRICES.esimEach * d.count))];
    rule = t("pay.rule.esim");
    title = t("pay.title.esim");
    agent = false;
    photo = "istanbul-galata";
    place = title;
  }

  // Preferences and loyalty applied (owner audit items 5, 6): the saved ones unless this booking says otherwise.
  // A paid extra the fare prices (seats together on flynas) is a line only when the traveller added it this time.
  let applied: AppliedPrefs | null = null;
  if (kind === "trip" || kind === "stay" || kind === "package") {
    const account = await accountP;
    const prefs = body.prefs ? BookingPrefs.parse(body.prefs) : bookingPrefsOf(account.prefs);
    const f = snapshot.flight as FlightOption | undefined;
    const s = snapshot.stay as StayOption | undefined;
    const carrier = f?.carrier ?? null;
    const hotelName = s?.name ?? (snapshot.bundle ? t("pay.line.aRoom") : null);
    const scope = snapshot.bundle ? "both" : prefScope(kind);
    const n = Math.max(1, travellers.length);
    const offer = f ? seatsTogetherOffer(prefs, body.extras, { carrier, travellers: n, legs: f.back ? 2 : 1 }) : null;
    if (offer?.added) lines.push(line("seats", "flight", t("bp.extra.line", { count: offer.count * offer.legs, price: formatSar(offer.perPerson.amount) }), offer.total.amount));
    const programmes = programmeFor({ carrier, hotelName: s?.name ?? null });
    const people = travellers.length ? await household : [];
    const selfId = people.find((p) => p.isSelf)?.id ?? null;
    const ids = travellers.map((p) => p.id);
    const loyalty = (body.loyalty ?? loyaltyToAttach(account.prefs.loyalty, programmes, selfId, ids)).filter((l) => ids.includes(l.personId) && programmes.includes(l.program));
    const summary = prefsSummary(prefs, scope, n);
    applied = {
      prefs, summary, scope, programmes, loyalty: loyalty.map((l) => ({ ...l, programName: programmeName(l.program), masked: maskLoyalty(l.number) })),
      extrasOffer: offer ? { key: "seatsTogether", carrier: carrier ?? undefined, airline: f?.airline, perPerson: offer.perPerson, count: offer.count, legs: offer.legs, total: offer.total, added: offer.added } : null,
    };
    const air = scope !== "stay" ? airlineRequests(prefs, { carrier, travellers: n }) : { ssr: [], remarks: [] };
    // A bassinet for each baby on a lap and a child meal for each child: asked of the airline with the booking.
    if (f && scope !== "stay") {
      const fam = familyLines(f, travellers, f.out.date);
      if (fam.bassinets) air.ssr.push("BSCT");
      if (fam.childMeals) air.ssr.push("CHML");
    }
    const appliedSnap: AppliedSnapshot = {
      prefs, loyalty, ssr: air.ssr, remarks: air.remarks, hotelRemarks: scope !== "flight" ? hotelRemarks(prefs) : [], summary,
      extras: { seatsTogether: offer?.added ? { count: offer.count, legs: offer.legs, perPerson: offer.perPerson.amount, total: offer.total.amount } : null },
    };
    snapshot.applied = appliedSnap;
  }

  const subtotal = lines.reduce((a, l) => a + l.amount, 0);
  // Promo codes and Mada credit are for travel; a share between friends is paid as it is.
  const travel = d.kind !== "share";
  const promo = travel ? checkPromo(body.promo, today(), subtotal) : null;
  const discount = promo?.status === "applied" ? promo.discount : 0;
  const balance = await balanceP;
  const creditUsed = travel && body.useCredit ? Math.max(0, Math.min(balance, subtotal - discount)) : 0;
  const total = subtotal - discount - creditUsed;
  const people = travellers.length ? await household : [];
  const missing = travellers.filter((p) => !people.find((h) => h.id === p.id)?.passport).map((p) => p.id);
  const flight = snapshot.flight as FlightOption | undefined;
  const { renewals } = kind === "trip" || kind === "stay" ? await renewalsFor(ownerId, snapshot.search, travellers, opts.demo, household) : { renewals: [] };
  const fam = flight && (kind === "trip" || snapshot.quotedFlight) ? familyLines(flight, travellers, flight.out.date) : null;
  const preview: OrderPreview = {
    kind, title, photo, lines, subtotal: money(subtotal),
    promo: promo ? { code: promo.code, status: promo.status, message: promo.message, discount: money(discount) } : null,
    credit: { balance: money(balance), used: money(creditUsed) }, total: money(total), rule, agent,
    holdExpiresAt: hold ? hold.toISOString() : null,
    instalments: travel && total >= 100_000 ? { tabby: money(instalments(total, 4)[0]!), tamara: money(instalments(total, 3)[0]!) } : null,
    travellerIds: travellers.map((p) => p.id),
    missingPassports: kind === "trip" || kind === "package" ? missing : [],
    stay: stayFacts,
    applied,
    renewals,
    family: fam ? { bags: fam.bags, bassinets: fam.bassinets, childMeals: fam.childMeals, adultFares: fam.adultFares } : null,
  };
  return { preview, snapshot, travellers, offerRows, place };
}
