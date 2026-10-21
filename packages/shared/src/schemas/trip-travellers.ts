import { z } from 'zod';
import { Id, IsoDateTime, IsoDay } from './common';
import { PlanOp } from './plans';

/*
 * Who goes on a trip, and what they may do with its plan (docs/app/ASK-INTEGRATED.md §5, §5.5). A trip traveller is
 * a household person, a Mada user from the circle (with a household row linked to him, so the plan counts him) or a
 * pending invite. The owner sets each one's role: view, suggest (the default) or edit. A suggestion becomes a change
 * request the owner approves in the chat; money always goes to the payer. `app_trips.traveller_ids` stays as a cache
 * of the household people going, so old readers keep working.
 */

export const TRAVELLER_ROLES = ['view', 'suggest', 'edit'] as const;
export const TravellerRole = z.enum(TRAVELLER_ROLES);
export type TravellerRole = z.infer<typeof TravellerRole>;

export const TripCompanion = z.object({
  id: Id,
  kind: z.enum(['person', 'user', 'invite']),
  /** First name, as the owner knows them. */
  name: z.string(),
  initial: z.string().max(2),
  /** How the owner knows them: "Your brother", "Friend · Riyadh Hiking", "Invited · +966 5•• ••• 482". */
  how: z.string(),
  owner: z.boolean(),
  /** Null for the owner. */
  role: TravellerRole.nullable(),
  status: z.enum(['going', 'invited', 'declined']),
  /** On Mada, so a role means something (a household person with no account sees nothing). */
  onMada: z.boolean(),
  personId: Id.nullable(),
});
export type TripCompanion = z.infer<typeof TripCompanion>;

export const TripTravellersResponse = z.object({
  tripId: Id,
  title: z.string(),
  /** The caller owns the trip (sets roles, removes people). */
  canManage: z.boolean(),
  /** The owner shares prices with companions who can edit. */
  sharePrices: z.boolean(),
  travellers: z.array(TripCompanion),
  /** Changes asked by companions, still waiting (they expire after 48 h). */
  pending: z.number().int(),
});
export type TripTravellersResponse = z.infer<typeof TripTravellersResponse>;

/** POST /trips/{id}/travellers: one the owner picked (from a choice card), or a name only ("Just add his name"). */
export const AddTravellerRequest = z.union([
  z.object({ personId: Id, role: TravellerRole.optional() }),
  z.object({ userId: Id, role: TravellerRole.optional() }),
  z.object({ name: z.string().trim().min(1).max(40), relation: z.string().trim().max(30).nullable().optional() }),
]);
export type AddTravellerRequest = z.infer<typeof AddTravellerRequest>;

/** PATCH /trips/{id}/travellers/{travellerId}: the owner's Travellers screen sets a role. */
export const UpdateTravellerRequest = z.object({ role: TravellerRole });
export type UpdateTravellerRequest = z.infer<typeof UpdateTravellerRequest>;
/** PATCH /trips/{id}/travellers: whether companions who can edit see prices. */
export const TripSharingRequest = z.object({ sharePrices: z.boolean() });
export type TripSharingRequest = z.infer<typeof TripSharingRequest>;

/** POST /trips/{id}/travellers/invite: "He isn't in your circle yet. Invite him?" Sending needs this tap. */
export const TripInviteRequest = z.object({
  name: z.string().trim().min(1).max(40),
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
  channel: z.enum(['whatsapp', 'sms']).default('whatsapp'),
  role: TravellerRole.optional(),
});
export type TripInviteRequest = z.input<typeof TripInviteRequest>;
export const TripInviteResponse = z.object({
  /** sent: by SMS or WhatsApp · in_app: the number is on Mada, so he gets it in his app · already: he's on the trip. */
  result: z.enum(['sent', 'in_app', 'already']),
  traveller: TripCompanion.nullable(),
});
export type TripInviteResponse = z.infer<typeof TripInviteResponse>;

/** A candidate for "Which Abdullah?": never a guess, always the traveller's pick. */
export const PeopleMatch = z.object({
  ref: z.object({ kind: z.enum(['person', 'user']), id: Id }),
  name: z.string(),
  initial: z.string().max(2),
  how: z.string(),
});
export type PeopleMatch = z.infer<typeof PeopleMatch>;

/**
 * One line of what a change does ("Melaka: 1 → 2 nights"): the app words it from op, field, from and to in the
 * reader's language; `text` is the same in English, for the model and the desk.
 */
export const ChangeLine = z.object({
  op: z.enum(['add', 'update', 'move', 'remove', 'skip', 'unskip']),
  title: z.string(),
  day: z.number().int().nullable(),
  field: z.enum(['nights', 'day', 'title', 'other']).nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  text: z.string(),
});
export type ChangeLine = z.infer<typeof ChangeLine>;

export const ChangeRequestStatus = z.enum(['pending', 'approved', 'declined', 'expired', 'cancelled']);
export type ChangeRequestStatus = z.infer<typeof ChangeRequestStatus>;

/** A change a companion asked for, as both chats draw it (§5.5). */
export const ChangeRequestView = z.object({
  id: Id,
  tripId: Id,
  tripTitle: z.string(),
  /** Who asked, and who decides (the trip's owner and payer), by first name. */
  byName: z.string(),
  ownerName: z.string(),
  summary: z.string(),
  lines: z.array(ChangeLine).max(10),
  /** It needs booking or paying: the payer decides, and it goes to the payer's pay sheet. */
  costs: z.boolean(),
  status: ChangeRequestStatus,
  reason: z.string().nullable(),
  /** The caller is the one who decides it. */
  mine: z.boolean(),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  decidedAt: IsoDateTime.nullable(),
});
export type ChangeRequestView = z.infer<typeof ChangeRequestView>;
export const ChangeRequestResponse = z.object({ change: ChangeRequestView });
export type ChangeRequestResponse = z.infer<typeof ChangeRequestResponse>;

/** POST /trips/{id}/change-requests/{changeId}/decide: Approve · Decline (a one-line reason). */
export const DecideChangeRequest = z.object({ decision: z.enum(['approve', 'decline']), reason: z.string().trim().max(140).nullable().optional() });
export type DecideChangeRequest = z.infer<typeof DecideChangeRequest>;

/** What a companion asks for: plan ops against the version they read, and a short summary in their words. */
export const ChangeAsk = z.object({ summary: z.string().trim().min(1).max(200), ops: z.array(PlanOp).min(1).max(10) });
export type ChangeAsk = z.infer<typeof ChangeAsk>;

export const CHANGE_REQUEST_TTL_H = 48;
export const CHANGE_REQUEST_REMIND_H = 24;

/* ───────────── the trip as a companion sees it (§5.3): no prices unless the owner shares them ───────────── */

export const SharedTripItem = z.object({
  id: Id,
  day: z.number().int().nullable(),
  kind: z.string(),
  mode: z.string().nullable(),
  title: z.string(),
  place: z.string().nullable(),
  /** Local "HH:mm" when the plan has one. */
  at: z.string().nullable(),
  nights: z.number().int().nullable(),
  booked: z.boolean(),
});
export type SharedTripItem = z.infer<typeof SharedTripItem>;

export const SharedTripCard = z.object({
  tripId: Id,
  title: z.string(),
  startDate: IsoDay,
  endDate: IsoDay.nullable(),
  ownerName: z.string(),
  role: TravellerRole,
  /** invited: he hasn't said yes yet (inviteId to accept or decline). */
  status: z.enum(['going', 'invited']),
  inviteId: Id.nullable(),
});
export type SharedTripCard = z.infer<typeof SharedTripCard>;
export const SharedTripsResponse = z.object({ trips: z.array(SharedTripCard) });
export type SharedTripsResponse = z.infer<typeof SharedTripsResponse>;

export const SharedTripView = SharedTripCard.extend({
  items: z.array(SharedTripItem),
  people: z.array(z.object({ name: z.string(), initial: z.string().max(2), owner: z.boolean() })),
  /** Changes this companion asked for, newest first. */
  changes: z.array(ChangeRequestView).max(10),
});
export type SharedTripView = z.infer<typeof SharedTripView>;
export const SharedTripResponse = z.object({ trip: SharedTripView });
export type SharedTripResponse = z.infer<typeof SharedTripResponse>;

export const tripTravellersRoute = (tripId: string) => `/trips/${tripId}/travellers`;
export const tripTravellerRoute = (tripId: string, travellerId: string) => `/trips/${tripId}/travellers/${travellerId}`;
export const tripInviteRoute = (tripId: string) => `/trips/${tripId}/travellers/invite`;
export const changeRequestRoute = (tripId: string, changeId: string) => `/trips/${tripId}/change-requests/${changeId}`;
export const SHARED_TRIPS_ROUTE = '/trips/shared';
export const sharedTripRoute = (tripId: string) => `/trips/shared/${tripId}`;
export const sharedInviteRoute = (inviteId: string, answer: 'accept' | 'decline') => `/trips/shared/invites/${inviteId}/${answer}`;

/*
 * nameKey: one key for the ways a name is written, so "Abdullah", "Abdallah", "Abdulla", «عبدالله» and «عبد الله» all
 * meet (§5.1). Latin: lower case, no accents, "abd al"/"abdel"/"abdul" joined, doubled letters and vowels folded.
 * Arabic: no diacritics or tatweel, alif forms as one, taa marbuta as haa, alif maqsura as yaa, spaces dropped, then
 * spelled in Latin letters (ain as a) with the same folds, so an Arabic and a Latin spelling of one name match too.
 */
const AR_LATIN: Record<string, string> = {
  'ا': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'th', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh',
  'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h',
  'و': 'w', 'ي': 'y', 'ء': '',
};
export function nameKey(raw: string): string {
  let s = (raw ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  // Arabic: diacritics, tatweel, letter variants.
  s = s.replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ؤئ]/g, 'ء');
  s = s.replace(/[ء-ي]/g, (c) => AR_LATIN[c] ?? '');
  s = s.replace(/[^a-z]/g, '');
  // "abd al", "abdel", "abdul", "abdal" → "abdl"; then vowels and doubled letters folded.
  s = s.replace(/^abd(?:ul|al|el|il|l)?/, 'abdl');
  s = s.replace(/[aeiouyw]+/g, '').replace(/(.)\1+/g, '$1');
  // A final h is often not written ("Abdulla", "Sara").
  return s.length > 2 ? s.replace(/h$/, '') : s;
}
