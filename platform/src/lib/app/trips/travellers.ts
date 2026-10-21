import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  AddTravellerRequest, TripInviteRequest, maskPhone, nameKey, planTitle, t,
  type PeopleMatch, type SharedTripCard, type SharedTripView, type TravellerRole, type TripInviteResponse, type TripCompanion, type TripTravellersResponse,
} from "@mada/shared";
import { db, type Tx } from "@/db";
import { appCircleMembers, appCircles, appPeople, appTrips, appUsers } from "@/db/app-schema";
import { appCircleInvites } from "@/db/app-schema-circles";
import { appPlanChangeRequests, appTripSharing, appTripTravellers } from "@/db/app-schema-trips";
import { AppError } from "../http";
import { localeOfUser } from "../locale";
import { graphOf, peopleByIds } from "../circles/common";
import { inviteToTripByPhone, inviteToTripInApp } from "../circles/invites";
import { planRowOf, readPlan, titleOf, liveItems, ownTrip, type TripRow } from "../plans/plans";
import { notify } from "./notify";

/*
 * Who goes on a trip (docs/app/ASK-INTEGRATED.md §5, U5). One row per traveller in app_trip_travellers: a household
 * person, a Mada user from the circle (with a household row linked to him, so the plan, searches and the pay sheet
 * count him), or a pending invite. `app_trips.traveller_ids` stays as the cache of the household people going, written
 * here in the same transaction, so every older reader keeps working; a trip whose cache was written by an older writer
 * gets its rows on the next read (syncRows).
 *
 * Matching a name (§5.1) never guesses: the household and the circle are searched by nameKey (Abdullah = Abdallah =
 * عبدالله), and anything but one household match goes back as a choice for the traveller to tap. Adding someone is free
 * and reversible; telling them (an invite, the plan) only happens on a tap.
 */

type Exec = typeof db | Tx;
type Row = typeof appTripTravellers.$inferSelect;
const ROLES: readonly TravellerRole[] = ["view", "suggest", "edit"];
const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();
const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/** "Riyadh → AlUla" (the plan's title when it has one), for invites, notifications and the cards. */
export async function tripName(trip: TripRow, q: Exec = db): Promise<string> {
  const plan = await planRowOf(trip.id, q);
  if (plan) return titleOf(trip, plan.origin as never, await liveItems(plan.id, q));
  return trip.title ?? planTitle(trip.origin ?? null, [{ name: trip.city }]);
}

/* ───────────── the rows and the cache ───────────── */

/**
 * Rows for the trip's cached travellers that have none yet (a trip booked before U5, or an older writer that changed
 * traveller_ids), and rows dropped for household people an older writer took off. Owner: the account holder.
 */
export async function syncRows(trip: TripRow, q: Exec = db): Promise<Row[]> {
  const rows = await q.select().from(appTripTravellers).where(eq(appTripTravellers.tripId, trip.id)).orderBy(asc(appTripTravellers.createdAt));
  const have = new Set(rows.map((r) => r.personId).filter(Boolean));
  const missing = trip.travellerIds.filter((id) => !have.has(id));
  const gone = rows.filter((r) => r.personId && !r.userId && !r.inviteId && r.status === "going" && r.role !== "owner" && !trip.travellerIds.includes(r.personId));
  if (!missing.length && !gone.length) return rows;
  if (missing.length) {
    const people = await q.select({ id: appPeople.id, isSelf: appPeople.isSelf }).from(appPeople)
      .where(and(eq(appPeople.ownerId, trip.ownerId), inArray(appPeople.id, missing)));
    if (people.length) {
      await q.insert(appTripTravellers).values(people.map((p) => ({ tripId: trip.id, personId: p.id, role: p.isSelf ? "owner" : "suggest", status: "going", addedByKind: "system" }))).onConflictDoNothing();
    }
  }
  if (gone.length) await q.delete(appTripTravellers).where(inArray(appTripTravellers.id, gone.map((r) => r.id)));
  return q.select().from(appTripTravellers).where(eq(appTripTravellers.tripId, trip.id)).orderBy(asc(appTripTravellers.createdAt));
}

/** traveller_ids: the household people going, in the order they were added (the cache old readers read). */
export async function writeCache(tripId: string, q: Exec = db): Promise<string[]> {
  const rows = await q.select({ personId: appTripTravellers.personId, status: appTripTravellers.status }).from(appTripTravellers)
    .where(eq(appTripTravellers.tripId, tripId)).orderBy(asc(appTripTravellers.createdAt));
  const ids = [...new Set(rows.filter((r) => r.personId && r.status !== "declined").map((r) => r.personId!))];
  await q.update(appTrips).set({ travellerIds: ids, updatedAt: new Date() }).where(eq(appTrips.id, tripId));
  return ids;
}

/* ───────────── how the owner knows each one ───────────── */

type Known = { household: Map<string, typeof appPeople.$inferSelect>; users: Map<string, { name: string; how: string }> };

/** The household (not deleted) and the circle: friends and members of the owner's circles, never anyone blocked. */
async function knownBy(ownerId: string, lang: "en" | "ar", q: Exec = db): Promise<Known> {
  const [people, g, circles] = await Promise.all([
    q.select().from(appPeople).where(and(eq(appPeople.ownerId, ownerId), isNull(appPeople.deletedAt))).orderBy(desc(appPeople.isSelf), asc(appPeople.createdAt)),
    graphOf(ownerId, q),
    q.select({ circleId: appCircleMembers.circleId, name: appCircles.name }).from(appCircleMembers).innerJoin(appCircles, eq(appCircles.id, appCircleMembers.circleId)).where(eq(appCircleMembers.userId, ownerId)),
  ]);
  const members = circles.length
    ? await q.select({ circleId: appCircleMembers.circleId, userId: appCircleMembers.userId }).from(appCircleMembers)
      .where(and(inArray(appCircleMembers.circleId, circles.map((c) => c.circleId)), ne(appCircleMembers.userId, ownerId)))
    : [];
  const circleOf = new Map<string, string>();
  for (const m of members) if (!circleOf.has(m.userId)) circleOf.set(m.userId, circles.find((c) => c.circleId === m.circleId)?.name ?? "");
  const ids = [...new Set([...g.friends, ...circleOf.keys()])].filter((id) => !g.blocked.has(id));
  const refs = await peopleByIds(ids, q);
  const users = new Map<string, { name: string; how: string }>();
  for (const id of ids) {
    const circle = circleOf.get(id);
    const how = g.friends.has(id) ? (circle ? t("people.how.circle", { circle }, lang) : t("people.how.friend", undefined, lang)) : t("people.how.member", { circle: circle ?? "" }, lang);
    users.set(id, { name: refs.get(id)?.short ?? "", how });
  }
  return { household: new Map(people.map((p) => [p.id, p])), users };
}

const relationWord = (relation: string, lang: "en" | "ar") => t(`person.rel.${relation}` as never, undefined, lang);
const householdHow = (p: typeof appPeople.$inferSelect, lang: "en" | "ar") =>
  p.isSelf ? t("people.how.self", undefined, lang) : t("people.how.household", { relation: relationWord(p.relation, lang) }, lang);

/**
 * Everyone the owner could mean by this name, household first (§5.1): never more than 4, the account holder and
 * people already going on the trip left out. A household row that stands for a circle member is that member.
 */
export async function findMatches(ownerId: string, name: string, opts: { tripId?: string | null; lang?: "en" | "ar" } = {}): Promise<PeopleMatch[]> {
  const lang = opts.lang ?? (await localeOfUser(ownerId));
  const key = nameKey(firstOf(name));
  if (!key) return [];
  const known = await knownBy(ownerId, lang);
  const going = opts.tripId ? await db.select({ personId: appTripTravellers.personId, userId: appTripTravellers.userId }).from(appTripTravellers)
    .where(and(eq(appTripTravellers.tripId, opts.tripId), ne(appTripTravellers.status, "declined"))) : [];
  const onTrip = new Set(going.flatMap((r) => [r.personId, r.userId]).filter(Boolean) as string[]);
  const out: PeopleMatch[] = [];
  for (const p of known.household.values()) {
    if (p.isSelf || onTrip.has(p.id)) continue;
    const first = firstOf(p.givenNames);
    if (nameKey(first) !== key && nameKey(p.givenNames.replace(/\s+/g, "")) !== key) continue;
    // His own account answers for him (and says how he's known).
    if (p.linkedUserId && known.users.has(p.linkedUserId)) continue;
    out.push({ ref: { kind: "person", id: p.id }, name: first, initial: initialOf(first), how: householdHow(p, lang) });
  }
  for (const [id, u] of known.users) {
    if (onTrip.has(id) || nameKey(u.name) !== key) continue;
    out.push({ ref: { kind: "user", id }, name: u.name, initial: initialOf(u.name), how: u.how });
  }
  return out.slice(0, 4);
}

/* ───────────── reading ───────────── */

export async function sharePricesOf(tripId: string, q: Exec = db): Promise<boolean> {
  const [s] = await q.select({ on: appTripSharing.sharePrices }).from(appTripSharing).where(eq(appTripSharing.tripId, tripId));
  return !!s?.on;
}

function viewOf(r: Row, known: Known, invites: Map<string, string>, lang: "en" | "ar"): TripCompanion {
  const p = r.personId ? known.household.get(r.personId) : undefined;
  const u = r.userId ? known.users.get(r.userId) : undefined;
  const name = firstOf(u?.name || (p ? p.givenNames : "") || r.name || "") || t("circles.someone", undefined, lang);
  const masked = r.inviteId ? invites.get(r.inviteId) : undefined;
  const how = r.role === "owner" ? t("people.how.self", undefined, lang)
    : r.status === "invited" && masked ? t("people.how.invited", { phone: masked }, lang)
    : u ? u.how : p ? (p.linkedUserId ? t("people.how.friend", undefined, lang) : householdHow(p, lang)) : t("people.how.named", undefined, lang);
  const onMada = !!r.userId || !!p?.linkedUserId || !!r.inviteId;
  return {
    id: r.id, kind: r.userId ? "user" : r.inviteId ? "invite" : "person", name, initial: initialOf(name), how,
    owner: r.role === "owner", role: r.role === "owner" ? null : (r.role as TravellerRole), status: r.status as TripCompanion["status"], onMada, personId: r.personId,
  };
}

/** The Travellers screen: the owner sees everyone with their role; a companion is sent to the shared view. */
export async function listTravellers(ownerId: string, tripId: string): Promise<TripTravellersResponse> {
  const trip = await ownTrip(ownerId, tripId);
  const lang = await localeOfUser(ownerId);
  const rows = await syncRows(trip);
  const [known, title, sharePrices, [pending]] = await Promise.all([
    knownBy(ownerId, lang),
    tripName(trip),
    sharePricesOf(tripId),
    db.select({ n: sql<number>`count(*)::int` }).from(appPlanChangeRequests).where(and(eq(appPlanChangeRequests.tripId, tripId), eq(appPlanChangeRequests.status, "pending"))),
  ]);
  const inviteIds = rows.map((r) => r.inviteId).filter((x): x is string => !!x);
  const invites = new Map((inviteIds.length ? await db.select({ id: appCircleInvites.id, masked: appCircleInvites.phoneMasked }).from(appCircleInvites).where(inArray(appCircleInvites.id, inviteIds)) : [])
    .filter((i) => i.masked).map((i) => [i.id, i.masked!] as const));
  const list = rows.map((r) => viewOf(r, known, invites, lang)).sort((a, b) => Number(b.owner) - Number(a.owner));
  return { tripId, title, canManage: true, sharePrices, travellers: list, pending: pending?.n ?? 0 };
}

/** The caller's place on a trip: owner, a role, or nothing (not on it, invited only, or said no). */
export async function roleOf(userId: string, tripId: string): Promise<{ trip: TripRow; role: "owner" | TravellerRole } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(tripId)) return null;
  const [trip] = await db.select().from(appTrips).where(eq(appTrips.id, tripId));
  if (!trip) return null;
  if (trip.ownerId === userId) return { trip, role: "owner" };
  const [r] = await db.select({ role: appTripTravellers.role }).from(appTripTravellers)
    .where(and(eq(appTripTravellers.tripId, tripId), eq(appTripTravellers.userId, userId), eq(appTripTravellers.status, "going")));
  return r && ROLES.includes(r.role as TravellerRole) ? { trip, role: r.role as TravellerRole } : null;
}

/* ───────────── adding and removing ───────────── */

/** A household row standing for a circle member, made once (§5.4): his first name only, linked to his account. */
async function linkedPerson(tx: Tx, ownerId: string, userId: string, name: string): Promise<string> {
  const [have] = await tx.select({ id: appPeople.id }).from(appPeople).where(and(eq(appPeople.ownerId, ownerId), eq(appPeople.linkedUserId, userId), isNull(appPeople.deletedAt)));
  if (have) return have.id;
  const [p] = await tx.insert(appPeople).values({ ownerId, givenNames: firstOf(name), relation: "friend", linkedUserId: userId }).returning({ id: appPeople.id });
  return p!.id;
}

export type Added = { traveller: TripCompanion; already: boolean; invited: boolean };

/**
 * Put someone on the trip: one the owner picked (a household person or someone from the circle) or a name only ("Just
 * add his name", a household row with the first name). A circle member is told in his app, and is "invited" until he
 * says yes; the pick (a tap on the choice card) is the owner's consent to share the trip with him.
 */
export async function addTraveller(ownerId: string, tripId: string, input: AddTravellerRequest, by: "ask" | "traveller" = "traveller"): Promise<Added> {
  const b = AddTravellerRequest.parse(input);
  const trip = await ownTrip(ownerId, tripId);
  const lang = await localeOfUser(ownerId);
  await syncRows(trip);
  const known = await knownBy(ownerId, lang);
  const role = ("role" in b && b.role) || "suggest";
  let tellUser: string | null = null;
  const out = await db.transaction(async (tx) => {
    let rowId: string;
    let already = false;
    if ("personId" in b) {
      const p = known.household.get(b.personId);
      if (!p) throw new AppError("NOT_FOUND");
      const [have] = await tx.select().from(appTripTravellers).where(and(eq(appTripTravellers.tripId, tripId), eq(appTripTravellers.personId, p.id)));
      if (have && have.status !== "declined") { rowId = have.id; already = true; }
      else if (have) { await tx.update(appTripTravellers).set({ status: "going", updatedAt: new Date() }).where(eq(appTripTravellers.id, have.id)); rowId = have.id; }
      else rowId = (await tx.insert(appTripTravellers).values({ tripId, personId: p.id, role: p.isSelf ? "owner" : role, addedByKind: by }).returning({ id: appTripTravellers.id }))[0]!.id;
    } else if ("userId" in b) {
      const u = known.users.get(b.userId);
      if (!u) throw new AppError("NOT_FOUND");
      const [have] = await tx.select().from(appTripTravellers).where(and(eq(appTripTravellers.tripId, tripId), eq(appTripTravellers.userId, b.userId)));
      if (have && have.status !== "declined") { rowId = have.id; already = true; }
      else {
        const personId = await linkedPerson(tx, ownerId, b.userId, u.name);
        const inviteId = await inviteToTripInApp(tx, ownerId, b.userId);
        if (have) {
          await tx.update(appTripTravellers).set({ status: "invited", inviteId, personId, role, updatedAt: new Date() }).where(eq(appTripTravellers.id, have.id));
          rowId = have.id;
        } else {
          // His household row may already be on the trip (added before as a person): that row becomes his.
          const [asPerson] = await tx.select().from(appTripTravellers).where(and(eq(appTripTravellers.tripId, tripId), eq(appTripTravellers.personId, personId)));
          if (asPerson) {
            await tx.update(appTripTravellers).set({ userId: b.userId, inviteId, status: "invited", role, updatedAt: new Date() }).where(eq(appTripTravellers.id, asPerson.id));
            rowId = asPerson.id;
          } else rowId = (await tx.insert(appTripTravellers).values({ tripId, personId, userId: b.userId, inviteId, role, status: "invited", addedByKind: by }).returning({ id: appTripTravellers.id }))[0]!.id;
        }
        tellUser = b.userId;
      }
    } else {
      const [p] = await tx.insert(appPeople).values({ ownerId, givenNames: b.name.trim(), relation: "friend" }).returning();
      known.household.set(p!.id, p!);
      rowId = (await tx.insert(appTripTravellers).values({ tripId, personId: p!.id, name: firstOf(b.name), role: "suggest", addedByKind: by }).returning({ id: appTripTravellers.id }))[0]!.id;
    }
    await writeCache(tripId, tx);
    const [row] = await tx.select().from(appTripTravellers).where(eq(appTripTravellers.id, rowId));
    return { row: row!, already };
  });
  if (tellUser) {
    const name = (await peopleByIds([ownerId])).get(ownerId)?.short ?? "";
    await notify(tellUser, { kind: "circle", level: "active", copy: "notify.tripInvite", vars: { name, trip: await tripName(trip) }, href: "/trips", data: { tripId } }).catch(() => {});
  }
  return { traveller: viewOf(out.row, known, new Map(), lang), already: out.already, invited: !!tellUser };
}

/**
 * Invite by number (the invite card's tap, §9.6): someone on Mada gets it in his app; anyone else by WhatsApp or SMS,
 * a household row with his first name kept for the plan to count him until he joins.
 */
export async function inviteTraveller(ownerId: string, tripId: string, input: TripInviteRequest, ipHash: string | null): Promise<TripInviteResponse> {
  const b = TripInviteRequest.parse(input);
  const trip = await ownTrip(ownerId, tripId);
  const title = await tripName(trip);
  const sent = await inviteToTripByPhone(ownerId, { phone: b.phone, channel: b.channel, trip: title }, ipHash);
  if (sent.onMada) {
    const lang = await localeOfUser(ownerId);
    const known = await knownBy(ownerId, lang);
    if (!known.users.has(sent.onMada)) {
      // On Mada but not in the circle: added the same way, with his name as the owner typed it.
      const refs = await peopleByIds([sent.onMada]);
      known.users.set(sent.onMada, { name: refs.get(sent.onMada)?.short || firstOf(b.name), how: t("people.how.friend", undefined, lang) });
    }
    const r = await addUserDirect(ownerId, trip, sent.onMada, firstOf(b.name), b.role ?? "suggest");
    return { result: r.already ? "already" : "in_app", traveller: viewOf(r.row, known, new Map(), lang) };
  }
  if (!sent.inviteId) return { result: "sent", traveller: null };
  const row = await db.transaction(async (tx) => {
    const [p] = await tx.insert(appPeople).values({ ownerId, givenNames: firstOf(b.name), relation: "friend" }).returning({ id: appPeople.id });
    const [r] = await tx.insert(appTripTravellers).values({ tripId, personId: p!.id, inviteId: sent.inviteId, name: firstOf(b.name), role: b.role ?? "suggest", status: "invited", addedByKind: "traveller" }).returning();
    await writeCache(tripId, tx);
    return r!;
  });
  const lang = await localeOfUser(ownerId);
  const known = await knownBy(ownerId, lang);
  return { result: "sent", traveller: viewOf(row, known, new Map([[sent.inviteId, sent.masked || maskPhone(b.phone)]]), lang) };
}

/** A number that turned out to be on Mada: an invite in his app, and a household row linked to him. */
async function addUserDirect(ownerId: string, trip: TripRow, userId: string, name: string, role: TravellerRole) {
  const out = await db.transaction(async (tx) => {
    const [have] = await tx.select().from(appTripTravellers).where(and(eq(appTripTravellers.tripId, trip.id), eq(appTripTravellers.userId, userId)));
    if (have && have.status !== "declined") return { row: have, already: true };
    const personId = await linkedPerson(tx, ownerId, userId, name);
    const inviteId = await inviteToTripInApp(tx, ownerId, userId);
    const [row] = have
      ? await tx.update(appTripTravellers).set({ status: "invited", inviteId, personId, role, updatedAt: new Date() }).where(eq(appTripTravellers.id, have.id)).returning()
      : await tx.insert(appTripTravellers).values({ tripId: trip.id, personId, userId, inviteId, role, status: "invited" }).returning();
    await writeCache(trip.id, tx);
    return { row: row!, already: false };
  });
  if (!out.already) {
    const me = (await peopleByIds([ownerId])).get(ownerId)?.short ?? "";
    await notify(userId, { kind: "circle", level: "active", copy: "notify.tripInvite", vars: { name: me, trip: await tripName(trip) }, href: "/trips", data: { tripId: trip.id } }).catch(() => {});
  }
  return out;
}

/** Take someone off (not the owner). Booked tickets stay until changed: a trip with bookings sends them to the change flow. */
export async function removeTraveller(ownerId: string, tripId: string, travellerId: string): Promise<void> {
  const trip = await ownTrip(ownerId, tripId);
  const [r] = await db.select().from(appTripTravellers).where(and(eq(appTripTravellers.id, travellerId), eq(appTripTravellers.tripId, tripId)));
  if (!r) throw new AppError("NOT_FOUND");
  if (r.role === "owner") throw new AppError("VALIDATION", { fields: { travellerId: "The organiser stays on the trip" } });
  if (trip.status !== "planning" && r.personId && trip.travellerIds.includes(r.personId) && r.status === "going") {
    throw new AppError("VALIDATION", { fields: { travellerId: "On a booking: change it through the booking" }, details: { booked: true } });
  }
  await db.transaction(async (tx) => {
    await tx.delete(appTripTravellers).where(eq(appTripTravellers.id, r.id));
    if (r.inviteId) await tx.update(appCircleInvites).set({ status: "cancelled", respondedAt: new Date() }).where(and(eq(appCircleInvites.id, r.inviteId), eq(appCircleInvites.status, "pending")));
    await writeCache(tripId, tx);
  });
}

/** The owner sets what a companion may do (§5.5). */
export async function setRole(ownerId: string, tripId: string, travellerId: string, role: TravellerRole): Promise<TripCompanion> {
  await ownTrip(ownerId, tripId);
  if (!ROLES.includes(role)) throw new AppError("VALIDATION");
  const [r] = await db.update(appTripTravellers).set({ role, updatedAt: new Date() })
    .where(and(eq(appTripTravellers.id, travellerId), eq(appTripTravellers.tripId, tripId), ne(appTripTravellers.role, "owner"))).returning();
  if (!r) throw new AppError("NOT_FOUND");
  const lang = await localeOfUser(ownerId);
  return viewOf(r, await knownBy(ownerId, lang), new Map(), lang);
}

export async function setSharePrices(ownerId: string, tripId: string, on: boolean): Promise<void> {
  await ownTrip(ownerId, tripId);
  await db.insert(appTripSharing).values({ tripId, sharePrices: on }).onConflictDoUpdate({ target: appTripSharing.tripId, set: { sharePrices: on, updatedAt: new Date() } });
}

/* ───────────── the companion's side ───────────── */

/**
 * An accepted trip invite (circles/invites.ts accept): he's going, his household row in the owner's account is linked
 * to him, and the owner hears it ("Abdullah joined your trip").
 */
export async function joinFromInvite(inviteId: string, userId: string): Promise<void> {
  const rows = await db.select().from(appTripTravellers).where(eq(appTripTravellers.inviteId, inviteId));
  for (const r of rows) {
    // An invite link opened again (or forwarded) never moves a place that someone already took.
    if (r.userId && r.userId !== userId) continue;
    if (r.status === "going" && r.userId === userId) continue;
    const [trip] = await db.select().from(appTrips).where(eq(appTrips.id, r.tripId));
    if (!trip || trip.ownerId === userId) continue;
    const [dup] = await db.select({ id: appTripTravellers.id }).from(appTripTravellers).where(and(eq(appTripTravellers.tripId, r.tripId), eq(appTripTravellers.userId, userId), ne(appTripTravellers.id, r.id)));
    await db.transaction(async (tx) => {
      if (dup) await tx.delete(appTripTravellers).where(eq(appTripTravellers.id, dup.id));
      await tx.update(appTripTravellers).set({ userId, status: "going", updatedAt: new Date() }).where(eq(appTripTravellers.id, r.id));
      if (r.personId) await tx.update(appPeople).set({ linkedUserId: userId, updatedAt: new Date() }).where(and(eq(appPeople.id, r.personId), eq(appPeople.ownerId, trip.ownerId)));
      await writeCache(r.tripId, tx);
    });
    const name = (await peopleByIds([userId])).get(userId)?.short ?? "";
    await notify(trip.ownerId, { kind: "circle", level: "active", copy: "notify.tripJoined", vars: { name, trip: await tripName(trip) }, href: `/trip/${trip.id}/travellers`, data: { tripId: trip.id } }).catch(() => {});
  }
}

/** He said no in his app: the invite and his place on the trip both say so. The owner isn't pushed. */
export async function declineTripInvite(inviteId: string, userId: string): Promise<void> {
  const [inv] = await db.select().from(appCircleInvites).where(and(eq(appCircleInvites.id, inviteId), eq(appCircleInvites.inviteeUserId, userId), eq(appCircleInvites.kind, "trip")));
  if (!inv) throw new AppError("NOT_FOUND");
  await db.transaction(async (tx) => {
    await tx.update(appCircleInvites).set({ status: "declined", respondedAt: new Date() }).where(eq(appCircleInvites.id, inv.id));
    const rows = await tx.update(appTripTravellers).set({ status: "declined", updatedAt: new Date() }).where(eq(appTripTravellers.inviteId, inv.id)).returning({ tripId: appTripTravellers.tripId });
    for (const r of rows) await writeCache(r.tripId, tx);
  });
}

/** The trips others share with him, for his Trips tab: going, or invited in his app and waiting for his yes. */
export async function sharedTrips(userId: string): Promise<SharedTripCard[]> {
  const rows = await db.select({ r: appTripTravellers, trip: appTrips }).from(appTripTravellers).innerJoin(appTrips, eq(appTrips.id, appTripTravellers.tripId))
    .where(and(eq(appTripTravellers.userId, userId), ne(appTrips.ownerId, userId), or(eq(appTripTravellers.status, "going"), eq(appTripTravellers.status, "invited")), ne(appTrips.status, "cancelled")))
    .orderBy(asc(appTrips.startDate));
  if (!rows.length) return [];
  const owners = await peopleByIds(rows.map((x) => x.trip.ownerId));
  const pendingInvites = new Set((await db.select({ id: appCircleInvites.id }).from(appCircleInvites)
    .where(and(eq(appCircleInvites.inviteeUserId, userId), eq(appCircleInvites.kind, "trip"), eq(appCircleInvites.status, "pending"), sql`${appCircleInvites.expiresAt} > now()`))).map((x) => x.id));
  const out: SharedTripCard[] = [];
  for (const { r, trip } of rows) {
    if (r.status === "invited" && !(r.inviteId && pendingInvites.has(r.inviteId))) continue;
    out.push({
      tripId: trip.id, title: await tripName(trip), startDate: trip.startDate, endDate: trip.endDate, ownerName: owners.get(trip.ownerId)?.short ?? "",
      role: ROLES.includes(r.role as TravellerRole) ? (r.role as TravellerRole) : "view", status: r.status === "going" ? "going" : "invited", inviteId: r.status === "invited" ? r.inviteId : null,
    });
  }
  return out;
}

/**
 * One shared trip as he sees it (§5.3): title, dates, the plan's days with places, stay names and times; never
 * prices, payment, other people's documents or the owner's chat. An invite not yet accepted shows only the card.
 */
export async function sharedTrip(userId: string, tripId: string): Promise<SharedTripView> {
  const card = (await sharedTrips(userId)).find((x) => x.tripId === tripId);
  if (!card) throw new AppError("NOT_FOUND");
  const [trip] = await db.select().from(appTrips).where(eq(appTrips.id, tripId));
  const rows = (await db.select().from(appTripTravellers).where(and(eq(appTripTravellers.tripId, tripId), eq(appTripTravellers.status, "going"))).orderBy(asc(appTripTravellers.createdAt)));
  const people = await db.select({ id: appPeople.id, given: appPeople.givenNames, linked: appPeople.linkedUserId }).from(appPeople)
    .where(inArray(appPeople.id, rows.map((r) => r.personId).filter((x): x is string => !!x).concat(["00000000-0000-0000-0000-000000000000"])));
  const users = await peopleByIds([...rows.map((r) => r.userId).filter((x): x is string => !!x), ...(trip ? [trip.ownerId] : [])]);
  const names = rows.map((r) => {
    const uid = r.role === "owner" ? trip?.ownerId : r.userId;
    const name = firstOf((uid ? users.get(uid)?.short : undefined) || people.find((p) => p.id === r.personId)?.given || r.name || "");
    return { name, initial: initialOf(name), owner: r.role === "owner" };
  }).filter((p) => p.name);
  let items: SharedTripView["items"] = [];
  if (card.status === "going" && trip && (await planRowOf(tripId))) {
    const plan = await readPlan(trip.ownerId, tripId);
    items = plan.items.filter((i) => i.status !== "skipped" && i.status !== "cancelled").map((i) => ({
      id: i.id, day: i.day, kind: i.kind, mode: i.mode, title: i.title,
      place: i.place?.city || i.place?.name || i.to?.city || i.to?.name || null,
      at: i.startsAt ? i.startsAt.slice(11, 16) : null, nights: i.nights, booked: i.status === "booked" || i.status === "confirmed",
    }));
  }
  const { changesBy } = await import("./change-requests");
  return { ...card, items, people: names, changes: card.status === "going" ? await changesBy(userId, tripId) : [] };
}

/** First names on the trip, for the model (never contacts or documents). */
export async function travellerNames(tripId: string): Promise<string[]> {
  const rows = await db.select({ name: appTripTravellers.name, given: appPeople.givenNames, userName: appUsers.name, status: appTripTravellers.status }).from(appTripTravellers)
    .leftJoin(appPeople, eq(appPeople.id, appTripTravellers.personId)).leftJoin(appUsers, eq(appUsers.id, appTripTravellers.userId))
    .where(and(eq(appTripTravellers.tripId, tripId), ne(appTripTravellers.status, "declined")));
  return rows.map((r) => firstOf(r.userName || r.given || r.name || "")).filter(Boolean);
}
