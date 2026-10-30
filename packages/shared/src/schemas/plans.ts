import { z } from 'zod';

/*
 * The living plan (docs/app/ASK-INTEGRATED.md §3): one plan per trip, made of items (legs, stays, a car, activities,
 * meals, notes) with a status each, and whole-trip checks. The booking tables stay the source of truth for anything
 * booked: an item points at its booking and its status is read from it. Nothing in a plan is written by the model:
 * times come from a template, a tool or the traveller, and drive distances only from the drive interface (U4).
 */

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const PLAN_ITEM_KINDS = ['leg', 'stay', 'car', 'activity', 'meal', 'note', 'check'] as const;
export const PlanItemKind = z.enum(PLAN_ITEM_KINDS);
export type PlanItemKind = z.infer<typeof PlanItemKind>;

export const LEG_MODES = ['flight', 'drive', 'train', 'ferry', 'transfer', 'walk'] as const;
export const LegMode = z.enum(LEG_MODES);
export type LegMode = z.infer<typeof LegMode>;

/** idea → priced → (requested) → held → booked → confirmed; cancelled once it was booked; skipped by the traveller. */
export const PLAN_ITEM_STATUSES = ['idea', 'priced', 'requested', 'held', 'booked', 'confirmed', 'cancelled', 'skipped'] as const;
export const PlanItemStatus = z.enum(PLAN_ITEM_STATUSES);
export type PlanItemStatus = z.infer<typeof PlanItemStatus>;

export const PLAN_BOOKING_KINDS = ['segment', 'stay', 'pickup', 'esim', 'idea', 'rental', 'order'] as const;
export const PlanBookingKind = z.enum(PLAN_BOOKING_KINDS);
export type PlanBookingKind = z.infer<typeof PlanBookingKind>;

/** A place on a plan. `code` is an IATA airport code when the place has one we know. */
export const PlanPlace = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['airport', 'city', 'place']),
  code: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  country: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  /** Google's place id, for a place added from Ask's place cards: the plan screen can read its hours later. */
  gid: z.string().max(300).nullable().optional(),
});
export type PlanPlace = z.infer<typeof PlanPlace>;

/** Where a trip starts, and how we know: said in a chat, remembered, from the profile or a booking, or a default. */
export const OriginSource = z.enum(['said', 'memory', 'booking', 'profile', 'default']);
export type OriginSource = z.infer<typeof OriginSource>;
export const TripOrigin = PlanPlace.extend({ source: OriginSource });
export type TripOrigin = z.infer<typeof TripOrigin>;

/** What a caller may send for a place: a code ("JED") or a name ("Jeddah"); the server resolves it. */
export const PlaceInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['airport', 'city', 'place']).optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullable().optional(),
  /** A place from Ask's place cards: where it is and Google's place id, kept as given (never matched to a city). */
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  gid: z.string().trim().min(1).max(300).nullable().optional(),
});
export type PlaceInput = z.infer<typeof PlaceInput>;

/** A drive leg's numbers, filled only by the drive interface (U4): source "map" with a time, or "estimate" (straight line) without one. */
export const PlanDrive = z.object({
  km: z.number().nullable(),
  minutes: z.number().int().nullable(),
  tolls: z.boolean().nullable(),
  borders: z.array(z.string()),
  source: z.string().nullable(),
  asOf: z.string().nullable(),
  estimate: z.boolean().optional(),
  ferries: z.boolean().nullable().optional(),
  /** Border crossings in order: ISO country codes and the crossing's name when known ("Woodlands Causeway"). */
  crossings: z.array(z.object({ from: z.string().nullable(), to: z.string().nullable(), name: z.string().nullable() })).optional(),
  /** No road between the two places: offer a flight or a ferry. */
  noRoute: z.boolean().optional(),
  expiresAt: z.string().nullable().optional(),
  /** The line to show and the only km/time the agent may quote ("1,076 km · about 10 h 20 min"). */
  line: z.string().optional(),
});
export type PlanDrive = z.infer<typeof PlanDrive>;

export const PlanItem = z.object({
  id: z.string().uuid(),
  day: z.number().int().min(0).nullable(),
  sort: z.number().int(),
  kind: PlanItemKind,
  mode: LegMode.nullable(),
  title: z.string(),
  note: z.string().nullable(),
  place: PlanPlace.nullable(),
  from: PlanPlace.nullable(),
  to: PlanPlace.nullable(),
  startsAt: localTime.nullable(),
  endsAt: localTime.nullable(),
  tz: z.string().nullable(),
  nights: z.number().int().min(1).nullable(),
  status: PlanItemStatus,
  /** A short line for the status ("Booked · Bereketzade Hotel", "Price needs checking again"). */
  statusLine: z.string().nullable(),
  booking: z.object({ kind: PlanBookingKind, id: z.string().uuid(), name: z.string().nullable(), ref: z.string().nullable() }).nullable(),
  requestId: z.string().uuid().nullable(),
  offerId: z.string().uuid().nullable(),
  drive: PlanDrive.nullable(),
  source: z.enum(['ask', 'manual', 'template', 'desk', 'booking']),
  /**
   * Booking from the plan (U7). price: what a tool priced it at (an offer) or what the order charged, with "as of" and
   * the offer's end; demo for a sample fare. quote: the desk's quote on its request ("Quote ready · SAR 4,200").
   * promisedBy: when the team gets back on its request. priceExpired: priced once, ran out: "Price again".
   */
  price: z.object({ amount: z.number().int(), currency: z.literal('SAR'), asOf: z.string(), expiresAt: z.string().nullable(), demo: z.boolean() }).nullable().optional(),
  quote: z.object({ requestId: z.string().uuid(), amount: z.number().int(), currency: z.literal('SAR'), expiresAt: z.string().nullable() }).nullable().optional(),
  promisedBy: z.string().nullable().optional(),
  priceExpired: z.boolean().optional(),
});
export type PlanItem = z.infer<typeof PlanItem>;

/**
 * What the plan adds up to (§3.3, §7.4): only prices from a tool, a quote or a booking, never an estimate. priced: what
 * the "Book what's ready" sheet would charge (priced items and open quotes); booked: what was paid. demo when any of
 * it is a sample fare: the total says "Demo fare · not bookable" too. ready: how many items can be paid now.
 */
export const PlanTotals = z.object({ priced: z.number().int(), booked: z.number().int(), currency: z.literal('SAR'), demo: z.boolean(), ready: z.number().int() });
export type PlanTotals = z.infer<typeof PlanTotals>;

export const PLAN_CHECK_KEYS = ['passports', 'visa', 'stays', 'car', 'esim', 'insurance', 'money'] as const;
export const PlanCheckKey = z.enum(PLAN_CHECK_KEYS);
export type PlanCheckKey = z.infer<typeof PlanCheckKey>;
/** ok: nothing to do · todo: something to book or add · warn: a problem (an expiring passport) · none: not started · unknown: we can't tell. */
export const PlanCheckState = z.enum(['ok', 'todo', 'warn', 'none', 'unknown']);
export type PlanCheckState = z.infer<typeof PlanCheckState>;
export const PlanCheck = z.object({
  key: PlanCheckKey,
  state: PlanCheckState,
  text: z.string(),
  /** Travellers concerned (person ids). */
  who: z.array(z.string()).default([]),
  /** Nights (0-based from the first day) or days the check is about. */
  nights: z.array(z.number().int()).default([]),
  days: z.array(z.number().int()).default([]),
});
export type PlanCheck = z.infer<typeof PlanCheck>;

export const Plan = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  version: z.number().int().min(1),
  title: z.string(),
  kind: z.enum(['simple', 'multi', 'road']),
  origin: TripOrigin.nullable(),
  /** The origin isn't known: ask where the trip starts (§3.8 step 5). */
  originNeeded: z.boolean(),
  returnTo: PlanPlace.nullable(),
  startDate: isoDay,
  endDate: isoDay,
  days: z.number().int().min(1),
  pace: z.enum(['easy', 'normal', 'full']),
  templateId: z.string().nullable(),
  travellerIds: z.array(z.string().uuid()),
  notes: z.array(z.string()),
  items: z.array(PlanItem),
  checks: z.array(PlanCheck),
  totals: PlanTotals.nullable().optional(),
  createdBy: z.enum(['ask', 'template', 'desk', 'traveller']),
  updatedAt: z.string(),
});
export type Plan = z.infer<typeof Plan>;

/* ───────────── requests ───────────── */

export const PlanStopInput = z.object({ place: PlaceInput, nights: z.number().int().min(0).max(30) });

export const CreatePlanRequest = z.object({
  templateId: z.string().max(40).nullable().optional(),
  origin: PlaceInput.nullable().optional(),
  /** Where the trip ends: "same" (the default) is the origin; null is one way. */
  returnTo: z.union([PlaceInput, z.literal('same'), z.null()]).optional(),
  stops: z.array(PlanStopInput).min(1).max(12).optional(),
  start: isoDay.nullable().optional(),
  days: z.number().int().min(1).max(30).nullable().optional(),
  travellerIds: z.array(z.string().uuid()).max(20).optional(),
  pace: z.enum(['easy', 'normal', 'full']).optional(),
  must: z.array(z.string().trim().min(1).max(80)).max(6).optional(),
  travelMode: z.enum(['fly', 'drive', 'mixed']).nullable().optional(),
}).refine((b) => !!b.templateId || !!b.stops?.length, { message: 'A template or at least one stop', path: ['stops'] });
export type CreatePlanRequest = z.infer<typeof CreatePlanRequest>;

/** An item as an edit describes it. Times are "HH:mm" on the item's day; only what the traveller or a tool gave. */
export const PlanItemInput = z.object({
  kind: z.enum(['leg', 'stay', 'car', 'activity', 'meal', 'note']),
  mode: LegMode.nullable().optional(),
  title: z.string().trim().min(1).max(120),
  note: z.string().trim().max(280).nullable().optional(),
  place: PlaceInput.nullable().optional(),
  from: PlaceInput.nullable().optional(),
  to: PlaceInput.nullable().optional(),
  at: hhmm.nullable().optional(),
  until: hhmm.nullable().optional(),
  nights: z.number().int().min(1).max(30).nullable().optional(),
});
export type PlanItemInput = z.infer<typeof PlanItemInput>;

export const PlanOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), day: z.number().int().min(0).nullable(), afterItemId: z.string().uuid().nullable().optional(), item: PlanItemInput }),
  z.object({ op: z.literal('update'), itemId: z.string().uuid(), item: PlanItemInput.partial() }),
  /** first: to the top of the day (afterItemId is then ignored); else after the given item, or last. */
  z.object({ op: z.literal('move'), itemId: z.string().uuid(), day: z.number().int().min(0).nullable(), afterItemId: z.string().uuid().nullable().optional(), first: z.boolean().optional() }),
  z.object({ op: z.literal('remove'), itemId: z.string().uuid() }),
  z.object({ op: z.literal('skip'), itemId: z.string().uuid() }),
  z.object({ op: z.literal('unskip'), itemId: z.string().uuid() }),
]);
export type PlanOp = z.infer<typeof PlanOp>;

export const PlanOpsRequest = z.object({ version: z.number().int().min(1), ops: z.array(PlanOp).min(1).max(10) });
export type PlanOpsRequest = z.infer<typeof PlanOpsRequest>;

export const SetOriginRequest = z.object({
  version: z.number().int().min(1).optional(),
  origin: PlaceInput,
  returnTo: z.union([PlaceInput, z.literal('same'), z.null()]).optional(),
});
export type SetOriginRequest = z.infer<typeof SetOriginRequest>;

export const PlanChange = z.object({ op: z.enum(['create', 'add', 'move', 'update', 'remove', 'status', 'origin']), itemId: z.string().nullable(), day: z.number().int().nullable(), title: z.string() });
export type PlanChange = z.infer<typeof PlanChange>;

/**
 * Who is reading the plan and what they may do (§5.5): the owner edits; a companion who can edit changes ideas at
 * once; one who can suggest sends a change request the owner approves; one who can view only reads. prices: whether
 * prices are shown (always for the owner; for companions only when the owner shares them).
 */
export const PlanAccess = z.object({ role: z.enum(['owner', 'view', 'suggest', 'edit']), prices: z.boolean(), ownerName: z.string().nullable() });
export type PlanAccess = z.infer<typeof PlanAccess>;

/** people: first names of everyone on the trip, for the plan's header (never contacts or documents). */
export const LivingPlanResponse = z.object({ plan: Plan, access: PlanAccess.optional(), people: z.array(z.object({ name: z.string(), initial: z.string() })).optional() });
export type LivingPlanResponse = z.infer<typeof LivingPlanResponse>;
export const PlanChangeResponse = z.object({
  plan: Plan,
  changes: z.array(PlanChange),
  /** Booked items an origin change can't touch: Mada offers the change flow for them instead. */
  untouched: z.array(z.object({ itemId: z.string(), title: z.string() })).default([]),
});
export type PlanChangeResponse = z.infer<typeof PlanChangeResponse>;

export const PlanEvent = z.object({ id: z.string(), itemId: z.string().nullable(), at: z.string(), by: z.enum(['ask', 'traveller', 'desk', 'system']), op: PlanChange.shape.op, diff: z.record(z.string(), z.unknown()) });
export type PlanEvent = z.infer<typeof PlanEvent>;
export const PlanEventsResponse = z.object({ events: z.array(PlanEvent) });
export type PlanEventsResponse = z.infer<typeof PlanEventsResponse>;

/** POST /trips/{id}/change-requests: a companion's edit on the plan screen, as a change request (or applied, "Can edit"). */
export const PlanChangeAskResponse = z.object({ applied: z.boolean(), changeId: z.string().uuid().nullable(), text: z.string() });
export type PlanChangeAskResponse = z.infer<typeof PlanChangeAskResponse>;

export const planRoute = (tripId: string) => `/trips/${tripId}/plan`;

/* ───────────── pure helpers (app and server alike) ───────────── */

/** "Riyadh → AlUla", or with more stops "Riyadh → Singapore → Penang" (first and last stop only past two). RTL uses ←. */
export function planTitle(origin: { name: string; city?: string | null } | null, stops: { name: string; city?: string | null }[], rtl = false): string {
  const name = (p: { name: string; city?: string | null }) => p.city || p.name;
  const places = stops.map(name).filter((n, i, a) => n && n !== a[i - 1]);
  const route = places.length > 2 ? [places[0]!, places[places.length - 1]!] : places;
  const all = [...(origin ? [name(origin)] : []), ...route].filter((n, i, a) => n !== a[i - 1]);
  return all.join(rtl ? ' ← ' : ' → ');
}

/** The rank of a status on the way to a confirmed booking (for "the furthest along wins"). */
export const statusRank = (s: PlanItemStatus) => ({ skipped: -1, cancelled: 0, idea: 1, priced: 2, requested: 3, held: 4, booked: 5, confirmed: 6 })[s];

/**
 * Today from the plan (ASK-INTEGRATED §1.3, U9): the trip that's near, and what its plan says for today and tomorrow.
 * pickup: a booked pickup (time and meeting point from the booking) or a car to collect; checkin: a booked stay whose
 * first night is that day; drive: a drive leg U4 measured ("3 h to Melaka", "leave by" only when the item has a time);
 * todo: a check that isn't fine (passports from 30 days before, the rest from 7). Times are never made up here.
 */
export const TodayPlanWhen = z.enum(['today', 'tomorrow']);
export const TodayPlanCard = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pickup'), when: TodayPlanWhen, time: z.string().nullable(), place: z.string().nullable(), car: z.boolean(), href: z.string() }),
  z.object({ kind: z.literal('checkin'), when: TodayPlanWhen, hotel: z.string(), city: z.string().nullable(), href: z.string() }),
  z.object({ kind: z.literal('drive'), when: TodayPlanWhen, minutes: z.number().int().positive(), to: z.string(), leaveBy: z.string().nullable(), href: z.string() }),
  z.object({ kind: z.literal('todo'), check: PlanCheckKey, state: z.enum(['todo', 'warn']), names: z.array(z.string()).max(6), days: z.array(z.number().int()), href: z.string() }),
]);
export type TodayPlanCard = z.infer<typeof TodayPlanCard>;
export const TodayPlanResponse = z.object({
  trip: z.object({ id: z.string().uuid(), title: z.string(), startDate: z.string(), endDate: z.string(), startsIn: z.number().int() }).nullable(),
  cards: z.array(TodayPlanCard).max(8),
});
export type TodayPlanResponse = z.infer<typeof TodayPlanResponse>;
