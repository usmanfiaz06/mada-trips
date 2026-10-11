import "server-only";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { WhatsOnInput, type WhatsOnInput as Input } from "@mada/shared";
import { db } from "@/db";
import { appRequests, appUsers } from "@/db/app-schema";
import { appWhatsOn } from "@/db/app-schema-activities";
import { appPlaces } from "@/db/app-schema-places";
import { activityOf } from "../activities/book";
import { hotelbedsActivitiesSupplier } from "../suppliers/activities";
import { HotelbedsError } from "../suppliers/hotelbeds/client";
import { assertCap, deskAudit, DeskError, shortRef, type DeskActor } from "./core";

/*
 * The desk's side of Things to do:
 *  - "What's on": the curated list of events for a city (Riyadh Season, Diriyah, AlUla's winter), shown in the app
 *    next to Ticketmaster's where it covers the city. Title, dates, city, photo with its credit, a link, en and ar.
 *  - "Book on Hotelbeds": a Hotelbeds activity request booked in one step from the request page, with a fresh rate
 *    key for the day and party asked for. Mock in mock mode; live only after Hotelbeds certification.
 */

export async function listWhatsOn(opts: { past?: boolean } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return db.select({ w: appWhatsOn, city: appPlaces.name, country: appPlaces.countryCode }).from(appWhatsOn).innerJoin(appPlaces, eq(appPlaces.id, appWhatsOn.placeId))
    .where(opts.past ? sql`${appWhatsOn.endsOn} < ${today}` : gte(appWhatsOn.endsOn, today))
    .orderBy(opts.past ? desc(appWhatsOn.endsOn) : asc(appWhatsOn.startsOn)).limit(200);
}

export async function saveWhatsOn(actor: DeskActor, id: string | null, input: Input) {
  assertCap(actor, "desk.act");
  const p = WhatsOnInput.safeParse(input);
  if (!p.success) throw new DeskError(p.error.issues[0]?.message ?? "Check the details");
  const v = p.data;
  const [place] = await db.select({ id: appPlaces.id, name: appPlaces.name }).from(appPlaces).where(eq(appPlaces.id, Number(v.placeId)));
  if (!place) throw new DeskError("Choose a city we know (its GeoNames id)");
  const values = { placeId: place.id, title: v.title, titleAr: v.titleAr || null, body: v.body || null, bodyAr: v.bodyAr || null, startsOn: v.startsOn, endsOn: v.endsOn, time: v.time, venue: v.venue || null, imageUrl: v.imageUrl, imageCredit: v.imageCredit || null, link: v.link, family: v.family, updatedAt: new Date() };
  return db.transaction(async (tx) => {
    let rowId = id;
    if (id) {
      const [r] = await tx.update(appWhatsOn).set(values).where(eq(appWhatsOn.id, id)).returning({ id: appWhatsOn.id });
      if (!r) throw new DeskError("Not found", "NOT_FOUND");
    } else {
      const [r] = await tx.insert(appWhatsOn).values({ ...values, createdBy: actor.name }).returning({ id: appWhatsOn.id });
      rowId = r!.id;
    }
    await deskAudit(tx, actor, { action: id ? "desk.whatson.updated" : "desk.whatson.added", entityType: "whats_on", entityId: rowId, ref: place.name, summary: `${id ? "Updated" : "Added"} “${v.title}” in ${place.name}, ${v.startsOn} to ${v.endsOn}` });
    return rowId!;
  });
}

export async function setWhatsOnActive(actor: DeskActor, id: string, active: boolean) {
  assertCap(actor, "desk.act");
  await db.transaction(async (tx) => {
    const [r] = await tx.update(appWhatsOn).set({ active, updatedAt: new Date() }).where(eq(appWhatsOn.id, id)).returning({ title: appWhatsOn.title });
    if (!r) throw new DeskError("Not found", "NOT_FOUND");
    await deskAudit(tx, actor, { action: active ? "desk.whatson.shown" : "desk.whatson.hidden", entityType: "whats_on", entityId: id, summary: `${active ? "Showed" : "Hid"} “${r.title}” in What's on` });
  });
}

/* ───────────── Book on Hotelbeds ───────────── */

export type HotelbedsBookingNote = { reference: string; status: string; total: { amount: number; currency: string }; rateKey: string; modality: string; at: string; by: string };

export async function bookOnHotelbeds(actor: DeskActor, requestId: string): Promise<HotelbedsBookingNote> {
  assertCap(actor, "desk.act");
  const [row] = await db.select({ r: appRequests, u: appUsers }).from(appRequests).innerJoin(appUsers, eq(appUsers.id, appRequests.ownerId)).where(eq(appRequests.id, requestId));
  if (!row) throw new DeskError("Not found", "NOT_FOUND");
  const a = activityOf(row.r.details);
  if (!a || a.supplier !== "hotelbeds" || !a.code) throw new DeskError("This isn't a Hotelbeds activity");
  const already = (row.r.details as { desk?: { hotelbeds?: HotelbedsBookingNote } }).desk?.hotelbeds;
  if (already) throw new DeskError(`Already booked on Hotelbeds: ${already.reference}`, "CONFLICT");
  if (!a.day) throw new DeskError("Ask them which day first, then book");
  const s = hotelbedsActivitiesSupplier();
  const ages = a.ages.length ? a.ages : [30, 30];
  let offers;
  try {
    offers = await s.offers!(a.code, { from: a.day, to: a.day, ages, language: "en", modality: a.modality });
  } catch (e) {
    throw new DeskError(e instanceof HotelbedsError && e.code === "NOT_CONFIGURED" ? "Hotelbeds Activities keys aren't set yet" : "Hotelbeds didn't answer. Try again in a minute.");
  }
  const offer = offers.find((o) => !a.modality || o.modality === a.modality) ?? offers[0];
  if (!offer) throw new DeskError("No availability on that day. Offer them another day.");
  const [given, ...rest] = (row.u.name || "Mada Traveller").trim().split(/\s+/);
  const holder = { name: given ?? "Mada", surname: rest.join(" ") || "Traveller", email: row.u.email ?? "bookings@madatrips.sa", country: "SA" };
  const paxes = ages.map((age, i) => ({ age, name: i === 0 ? holder.name : `Guest ${i + 1}`, surname: holder.surname, type: age < 18 ? "CHILD" as const : "ADULT" as const }));
  let booking;
  try {
    booking = await s.book!({ rateKey: offer.rateKey, from: offer.from, to: offer.to, clientReference: shortRef(requestId), holder, paxes, language: "en" });
  } catch (e) {
    throw new DeskError(e instanceof HotelbedsError && e.code === "PRICE_CHANGED" ? "The rate changed on Hotelbeds. Try again for a fresh price." : "Hotelbeds didn't confirm. Nothing was booked; try again.");
  }
  const note: HotelbedsBookingNote = { reference: booking.reference, status: booking.status, total: booking.total, rateKey: offer.rateKey, modality: offer.modality, at: new Date().toISOString(), by: actor.name };
  await db.transaction(async (tx) => {
    await tx.update(appRequests).set({ details: sql`jsonb_set(${appRequests.details}, '{desk}', coalesce(${appRequests.details}->'desk', '{}'::jsonb) || ${JSON.stringify({ hotelbeds: note })}::jsonb)`, updatedAt: new Date() })
      .where(and(eq(appRequests.id, requestId)));
    await deskAudit(tx, actor, { action: "desk.activity.booked", entityType: "request", entityId: requestId, ref: shortRef(requestId),
      summary: `Booked ${a.title} on Hotelbeds for ${a.day}: ${booking.reference}`, data: { supplier: "hotelbeds", code: a.code, modality: offer.modality, reference: booking.reference, total: booking.total } });
  });
  return note;
}
