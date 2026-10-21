import { StayFit } from './stay-fit';
import { RequestProgress, RequestResult } from './outcomes';
import { HotelRequests } from './hotel-requests';
import { z } from 'zod';
import { ContactPhone, FlightQuote, FlightRequestExtras, ThreadAttachment } from './flight-quote';
import { AirportCode, HalalasAmount, Id, IsoDateTime, IsoDay, Money } from './common';
import { Cabin, FlightSegment, Pickup, Stay, Trip } from './trips';
import { NEED_KEYS } from './booking-data';
import { CardBrand } from './wallet';
import { BookingExtras, BookingLoyalty, BookingLoyaltyBase, BookingPrefs } from './booking-prefs';

/*
 * Booking (M2): Ask → search → entry check → order sheet → payment → the desk → a booked trip.
 * Every price in these payloads came from a supplier response or the desk's price table, never from the model.
 */

export * from './booking-data';
export * from './booking-logic';
export * from './party';
export * from './ask-correction';

/* ───────────── Ask ───────────── */

export const AskKind = z.enum(['flight', 'stay', 'plan', 'esim', 'visa', 'umrah', 'car', 'food', 'todo', 'general']);
export type AskKind = z.infer<typeof AskKind>;
export const HomeAirport = z.enum(['RUH', 'JED', 'DMM']);
export type HomeAirport = z.infer<typeof HomeAirport>;
export const TripType = z.enum(['return', 'oneway']);
export type TripType = z.infer<typeof TripType>;
export const NeedKeySchema = z.enum(NEED_KEYS);

export const AskParseRequest = z.object({
  text: z.string().trim().min(1).max(500),
  /** The trip already booked, so "a hotel" means a hotel there. */
  tripCity: z.string().max(60).nullish(),
});
export type AskParseRequest = z.input<typeof AskParseRequest>;

/** Who was said to be going, by count and age ("2 adults and 3 kids aged 2, 6 and 13"). childAges: 2 to 17, null when not said. */
export const SaidPartySchema = z.object({
  adults: z.number().int().min(0).max(9).nullable(),
  childAges: z.array(z.number().int().min(0).max(17).nullable()).max(9),
  /** Under 2. */
  infants: z.number().int().min(0).max(4),
  /** Of the infants, how many have their own seat (the rest sit on a lap). */
  infantSeats: z.number().int().min(0).max(4).optional(),
  total: z.number().int().min(1).max(20).nullable(),
});

/** What Mada understood. Structure only: no prices, no availability (SCOPE.md §6). */
export const AskIntent = z.object({
  kind: AskKind,
  /** A DESTINATIONS key ("istanbul"), "other" for a city we don't sell live, or null. */
  destination: z.string().max(40).nullable(),
  /** The city as typed when destination is "other" ("Tbilisi" is known; "Muscat" is not). */
  destinationName: z.string().max(60).nullable(),
  from: HomeAirport.nullable(),
  depart: IsoDay.nullable(),
  return: IsoDay.nullable(),
  tripType: TripType.nullable(),
  /** "in March": only the days are asked. */
  monthOnly: z.object({ month: z.number().int().min(1).max(12), year: z.number().int(), label: z.string().nullable() }).nullable(),
  cabin: Cabin.nullable(),
  /** "First isn't sold on these routes." */
  cabinNote: z.string().nullable(),
  /** People in the household named or implied ("the family", "Sara"). */
  travellerIds: z.array(Id).nullable(),
  /** "for 4" when the household is smaller: the app asks for the others' names. */
  travellerCount: z.number().int().min(1).max(9).nullable(),
  infants: z.number().int().min(0).max(4),
  /** The counts and ages said, when they say more than names do. The app asks (a stepper) when they don't map to the household. */
  party: SaidPartySchema.nullable().optional(),
  /** Needs said in the same sentence as a name ("Hessa needs a wheelchair"). */
  needs: z.record(z.string(), z.array(NeedKeySchema)),
  /** Needs mentioned without a person, for the app to offer. */
  needsMentioned: z.array(NeedKeySchema),
  /** Request form answers already given in the text. */
  answers: z.record(z.string(), z.array(z.string())),
  /** The one detail that changes the outcome and is still missing. */
  ask: z.enum(['where', 'when', 'return', 'who']).nullable(),
  /** rules = deterministic parser; model = Claude through a strict tool schema. */
  source: z.enum(['rules', 'model']),
});
export type AskIntent = z.infer<typeof AskIntent>;
export const AskParseResponse = z.object({ intent: AskIntent });
export type AskParseResponse = z.infer<typeof AskParseResponse>;

/* ───────────── search ───────────── */

export const OptionLabel = z.enum(['best', 'lowest', 'earliest', 'fastest', 'bags', 'quiet', 'water']);

/** Demo switches (FLOWS.md): honoured only when the supplier runs in mock mode. Sent as ?demo=a,b or X-Mada-Demo. */
export const DemoFlag = z.enum(['offline', 'decline', 'priceUp', 'noResults', 'supplierDown', 'agentQuestion', 'passportProblem', 'needs3ds', 'fareGone', 'ticketingFails', 'slowAgent', 'faceIdFails', 'priceDown', 'esimFails']);
export type DemoFlag = z.infer<typeof DemoFlag>;

/**
 * Someone searching without an account: the people they said are going, kept on their phone (ids made there). The
 * server prices for them and keeps nothing personal; signed in, the household on the account is used instead.
 */
export const GuestTraveller = z.object({ id: Id, dateOfBirth: IsoDay.nullable(), isSelf: z.boolean().default(false) });
export type GuestTraveller = z.input<typeof GuestTraveller>;
const Guests = z.array(GuestTraveller).max(12).optional();

export const FlightSearchRequest = z.object({
  from: HomeAirport,
  /** A DESTINATIONS key. */
  destination: z.string().min(2).max(40),
  depart: IsoDay,
  return: IsoDay.nullable(),
  travellerIds: z.array(Id).min(1).max(9),
  infants: z.number().int().min(0).max(4).default(0),
  cabin: Cabin.default('economy'),
  /** ±days the traveller allows; with no flights on the day, 1 moves the search a day later. */
  flexibleDays: z.number().int().min(0).max(3).default(0),
  /** Without an account: who travellerIds are (GuestTraveller). Ignored when signed in. */
  guests: Guests,
});
export type FlightSearchRequest = z.input<typeof FlightSearchRequest>;

export const FlightOptionLeg = z.object({
  flightNumber: z.string(),
  from: AirportCode,
  to: AirportCode,
  date: IsoDay,
  dep: z.string(),
  arr: z.string(),
  durationMin: z.number().int().positive(),
});

/** One card in Ask. The id is ours (app_offers), opaque to the app, and expires with the price hold. */
export const FlightOption = z.object({
  id: Id,
  label: OptionLabel,
  carrier: z.string(),
  airline: z.string(),
  /** Brand colour for the airline mark. */
  brand: z.string(),
  out: FlightOptionLeg,
  back: FlightOptionLeg.nullable(),
  stop: z.string().nullable(),
  reason: z.string(),
  bags: z.string(),
  changeRule: z.string(),
  refundRule: z.string(),
  refundable: z.boolean(),
  cabin: Cabin,
  /** Every seat: adults and the children among them. Babies on a lap are `infants`. */
  adults: z.number().int(),
  infants: z.number().int(),
  /** Of the seats, how many are a child 2 to 11 or a baby with its own seat (priced at `childPrice`). */
  children: z.number().int().default(0),
  /** The adult fare, each. */
  pricePerPerson: Money,
  /** The child fare, each; when missing, the adult fare. */
  childPrice: Money.optional(),
  infantPrice: Money,
  total: Money,
  expiresAt: IsoDateTime,
  /**
   * A sample fare from the mock catalogue (SUPPLIER_MODE_FLIGHTS=mock, outside production or on a staging copy with
   * APP_ALLOW_MOCKS=yes): every card that shows it says "Demo fare · not bookable" (search.demoFare).
   */
  demo: z.boolean().optional(),
});
export type FlightOption = z.infer<typeof FlightOption>;

export const BundleQuote = z.object({ nights: z.number().int(), stay: Money, pickup: Money, total: Money, hotelName: z.string(), rooms: z.number().int() });
export type BundleQuote = z.infer<typeof BundleQuote>;

export const FlightSearchResponse = z.object({
  outcome: z.enum(['ok', 'none', 'partial', 'by_hand']),
  destination: z.string(),
  destinationName: z.string(),
  from: HomeAirport,
  depart: IsoDay,
  return: IsoDay.nullable(),
  cabin: Cabin,
  /** How many fares were looked at ("Checked 14 flights"). */
  checked: z.number().int(),
  options: z.array(FlightOption),
  /** Carriers that didn't answer (FLOWS.md: "Saudia's system isn't answering"). */
  unavailable: z.array(z.object({ carrier: z.string(), airline: z.string() })),
  /** Rooms and pickups that can be added in one tap, priced for these dates and travellers. */
  bundle: BundleQuote.nullable(),
  cachedUntil: IsoDateTime,
});
export type FlightSearchResponse = z.infer<typeof FlightSearchResponse>;

export const StaySearchRequest = z.object({
  destination: z.string().min(2).max(40),
  checkIn: IsoDay,
  nights: z.number().int().min(1).max(60),
  travellerIds: z.array(Id).min(1).max(12),
  guests: Guests,
});
export type StaySearchRequest = z.input<typeof StaySearchRequest>;

/** What Mada can say about an amenity or a view: only what the hotel's content or its rooms show. */
export const StayAmenity = z.enum(['pool', 'beach', 'kidsClub', 'gym', 'spa', 'parking', 'connecting', 'accessible', 'familyRooms', 'wifi']);
export type StayAmenity = z.infer<typeof StayAmenity>;
export const StayView = z.enum(['sea', 'beach', 'burj', 'haram', 'city']);
export type StayView = z.infer<typeof StayView>;

/**
 * A stay's facts in structure, so the app writes the card in the traveller's language and can sort, filter and refine
 * by them: stars, the board, whether it can be cancelled, local tax paid at the hotel, where it is, what it has.
 */
export const StayFacts = z.object({
  stars: z.number().int().min(0).max(5).nullable(),
  apartment: z.boolean(),
  board: z.enum(['RO', 'BB', 'HB', 'FB', 'AI', 'other']).nullable(),
  /** The room as the hotel names it, tidied ("Deluxe double"). */
  room: z.string().nullable(),
  refundable: z.boolean(),
  /** Local taxes paid at the hotel, in halalas (not in the price). */
  payAtHotel: z.number().int().nullable(),
  zone: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  /** Whether we hold the hotel's content (facilities, description): without it, "no pool" can't be said. */
  content: z.boolean(),
  amenities: z.array(StayAmenity),
  views: z.array(StayView),
  quiet: z.boolean(),
  deal: z.boolean(),
  /**
   * A shared room or a hostel (a bed in a dorm, a shared bathroom, a hostel's rooms): never a pick, and out of the list
   * until the traveller asks for shared rooms (sharedStay in stay-fit.ts says how it's read). Absent on older offers.
   */
  shared: z.boolean().optional(),
});
export type StayFacts = z.infer<typeof StayFacts>;

export const StayOption = z.object({
  id: Id,
  label: OptionLabel,
  name: z.string(),
  area: z.string(),
  address: z.string(),
  note: z.string(),
  rating: z.string(),
  photo: z.string(),
  focal: z.string(),
  checkIn: IsoDay,
  nights: z.number().int(),
  rooms: z.number().int(),
  /** "2 connecting rooms", "1 room for 2". */
  roomsLabel: z.string(),
  total: Money,
  cancellation: z.string(),
  freeCancelUntil: IsoDay.nullable(),
  expiresAt: IsoDateTime,
  /** A partner's room: the hotel's opaque id (for its details), category, photo (through Mada's image link), room and board, and the rate's essential information. */
  hotel: z.object({
    code: z.string(), category: z.string().nullable(), imageUrl: z.string().nullable(), room: z.string().nullable(), board: z.string().nullable(),
    rateComments: z.string().nullable(),
  }).nullable().optional(),
  /** At most one "Best for you" and one "Lowest price" in a list; null for the rest (label stays for older apps). */
  badge: z.enum(['best', 'lowest']).nullable().optional(),
  /** How well it fits, 0–100 (stars, price, where it is): the "Recommended" order. */
  score: z.number().optional(),
  facts: StayFacts.nullable().optional(),
  /** Why it ranks where it does: the trip's shape, the score and the facts behind it (stay-fit.ts). */
  fit: StayFit.nullable().optional(),
});
export type StayOption = z.infer<typeof StayOption>;

export const StaySearchResponse = z.object({
  outcome: z.enum(['ok', 'none', 'by_hand']),
  destination: z.string(),
  destinationName: z.string(),
  options: z.array(StayOption),
  cachedUntil: IsoDateTime,
  /** Who the list was ranked for ("family: 2 children under 12"), so the app can say so. */
  shape: z.object({ shape: z.string(), because: z.string(), travellers: z.number().int(), under12: z.number().int() }).nullable().optional(),
});
export type StaySearchResponse = z.infer<typeof StaySearchResponse>;

/** GET /offers/{id}/rooms: every room the hotel has for this stay and party, cheapest first (the one shown first). */
export const StayRoomsResponse = z.object({ options: z.array(StayOption) });
export type StayRoomsResponse = z.infer<typeof StayRoomsResponse>;

/** Offers keep their price for the hold; "Check the price again" re-prices with the supplier. */
export const OfferResponse = z.object({
  kind: z.enum(['flight', 'stay']),
  flight: FlightOption.nullable(),
  stay: StayOption.nullable(),
  expired: z.boolean(),
  /** Set by a re-price: how much it moved (0 when the same). */
  changedBy: HalalasAmount.nullable(),
});
export type OfferResponse = z.infer<typeof OfferResponse>;

/* ───────────── entry checks ───────────── */

/** Answers the traveller gave: "<personId>:<country>:visa" → has|asked, "<personId>:reentry" → has|asked, "<personId>:iqama" → a day. */
export const EntryAnswers = z.record(z.string().max(120), z.string().max(20));
export type EntryAnswers = z.infer<typeof EntryAnswers>;

export const EntryCheckRequest = z.object({
  destination: z.string().min(2).max(40),
  travellerIds: z.array(Id).min(1).max(12),
  depart: IsoDay,
  return: IsoDay.nullable(),
  answers: EntryAnswers.default({}),
  guests: Guests,
});
export type EntryCheckRequest = z.input<typeof EntryCheckRequest>;

export const EntryCheck = z.object({
  personId: Id.nullable(),
  name: z.string().nullable(),
  key: z.enum(['passport', 'visa', 'iqama', 'reentry', 'manual', 'eta']),
  blocking: z.boolean(),
  done: z.boolean(),
  info: z.boolean(),
  title: z.string().nullable(),
  text: z.string(),
  /** "Türkiye e-Visa": what Mada can get. */
  need: z.string().nullable(),
  /** The answer key to send back when the traveller answers. */
  answerKey: z.string().nullable(),
  /** Who can be left off the booking: anyone, the account holder too, while someone else is still going. */
  removable: z.boolean(),
  /** What the "Mada gets it" button asks for. */
  service: z.enum(['uk_eta', 'evisa', 'reentry', 'passport_renewal']).nullable(),
  /** A passport too short for the trip: when Mada can have it renewed by, the fee, whether that's in time, and whether it's asked. */
  renewal: z.object({ by: IsoDay, fee: HalalasAmount, inTime: z.boolean(), asked: z.boolean() }).nullable().optional(),
});
export type EntryCheck = z.infer<typeof EntryCheck>;

export const EntryCheckResponse = z.object({
  countryName: z.string(),
  domestic: z.boolean(),
  /** "Saudi and Philippine" */
  nationalities: z.array(z.string()),
  /** "Visa-free for 90 days." when nothing else needs saying. */
  okText: z.string().nullable(),
  checks: z.array(EntryCheck),
  blocking: z.number().int(),
  checkedOn: IsoDay,
});
export type EntryCheckResponse = z.infer<typeof EntryCheckResponse>;

/* ───────────── plans ───────────── */

export const PlanStopSchema = z.object({ time: z.string(), icon: z.enum(['flight', 'stay', 'star', 'food', 'car']), title: z.string(), note: z.string() });
export const BookingPlan = z.object({
  id: z.string(), title: z.string(), sub: z.string(), photo: z.string(), city: z.string(), days: z.number().int(), stops: z.number().int(),
  /** For the household's travellers. */
  total: Money, travellers: z.number().int(),
});
export type BookingPlan = z.infer<typeof BookingPlan>;
export const PlanDetail = BookingPlan.extend({ plan: z.array(z.object({ day: z.string(), stops: z.array(PlanStopSchema) })) });
export type PlanDetail = z.infer<typeof PlanDetail>;
export const PlansResponse = z.object({ plans: z.array(BookingPlan) });
export const PlanResponse = z.object({ plan: PlanDetail });

/* ───────────── requests ───────────── */

export const BookingRequestKind = z.enum(['visa', 'umrah', 'car', 'food', 'todo', 'flight', 'stay', 'general', 'package']);
export type BookingRequestKind = z.infer<typeof BookingRequestKind>;
export const BookingRequestStatus = z.enum(['queued', 'sent', 'reviewing', 'quoted', 'paid', 'done', 'cancelled']);
export type BookingRequestStatus = z.infer<typeof BookingRequestStatus>;

export const ContactPreference = z.enum(['call', 'whatsapp', 'in_app']);
export type ContactPreference = z.infer<typeof ContactPreference>;

export const CreateRequestBody = z.object({
  kind: BookingRequestKind.exclude(['package']),
  /** What the traveller typed. */
  query: z.string().trim().max(500).default(''),
  answers: z.record(z.string().max(20), z.array(z.string().max(80)).max(8)).default({}),
  travellerIds: z.array(Id).max(12).default([]),
  needs: z.record(z.string(), z.array(NeedKeySchema)).default({}),
  note: z.string().trim().max(1000).default(''),
  /** A flight or stay Mada searches by hand (a city we don't sell live, or an airline not answering). */
  search: z.object({
    destination: z.string().max(40).nullable(),
    destinationName: z.string().max(60).nullable(),
    from: HomeAirport.nullable(),
    depart: IsoDay.nullable(),
    return: IsoDay.nullable(),
    cabin: Cabin.nullable(),
    carrier: z.string().max(3).nullable(),
    /** Flights by request: how flexible, bags each, and what they'd like (schemas/flight-quote.ts). */
    ...FlightRequestExtras.shape,
  }).nullish(),
  /** Asked from an entry check. */
  service: z.enum(['uk_eta', 'evisa', 'reentry', 'passport_renewal']).nullish(),
  /** Who the service is for, and the country, for its title. */
  serviceFor: z.object({ personId: Id.nullable(), need: z.string().max(60).nullable(), destination: z.string().max(40).nullable() }).nullish(),
  /** Set by the app when it sends a request it saved offline, so a retry never makes two. */
  clientId: z.string().min(8).max(64).optional(),
  /** How the traveller wants the team to come back (Ask chat asks once): a call, WhatsApp, or here in the app. */
  contactPreference: ContactPreference.nullish(),
  /** With a call: the best time, in their words ("evenings", "after 4"). */
  contactWindow: z.string().trim().max(60).nullish(),
});
export type CreateRequestBody = z.input<typeof CreateRequestBody>;

export const QuoteBreakdownLine = z.object({ label: z.string(), amount: HalalasAmount });
export const RequestQuote = z.object({
  id: Id,
  total: Money,
  /** Per person, so the traveller sees where every riyal goes. */
  breakdown: z.array(z.object({ personId: Id.nullable(), name: z.string(), lines: z.array(QuoteBreakdownLine) })),
  /** The agent's words. */
  text: z.string(),
  lead: z.string().nullable(),
  needLines: z.array(z.string()),
  expiresAt: IsoDateTime.nullable(),
  status: z.enum(['open', 'accepted', 'expired', 'withdrawn']),
  /** A flight request's fare options, each with flights, a price per person, bags and rules. */
  flight: FlightQuote.nullable().optional(),
});
export type RequestQuote = z.infer<typeof RequestQuote>;

export const AgentInfo = z.object({ name: z.string() });

export const BookingRequestView = z.object({
  id: Id,
  kind: BookingRequestKind,
  status: BookingRequestStatus,
  title: z.string(),
  /** "Hessa, Sara · In Ramadan" */
  summary: z.string(),
  detail: z.string(),
  note: z.string().nullable(),
  travellerIds: z.array(Id),
  /** The person on duty for it, from the desk. */
  agent: AgentInfo.nullable(),
  quote: RequestQuote.nullable(),
  promisedBy: IsoDateTime.nullable(),
  /** How it ended, once closed; what Mada is doing, by when and the cost while open (schemas/outcomes.ts). */
  result: RequestResult.nullable().optional(),
  progress: RequestProgress.nullable().optional(),
  /** How the traveller asked to be reached (CreateRequestBody.contactPreference). */
  contact: z.object({ preference: ContactPreference, window: z.string().nullable() }).nullable().optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BookingRequestView = z.infer<typeof BookingRequestView>;
export const RequestResponse = z.object({ request: BookingRequestView });
export const RequestsResponse = z.object({ requests: z.array(BookingRequestView) });

export const ThreadMessage = z.object({
  id: Id,
  from: z.enum(['me', 'agent', 'mada']),
  authorName: z.string().nullable(),
  text: z.string(),
  /** An offer the agent made in the thread ("A hotel at the King Abdulaziz Gate"). */
  offer: z.object({ label: z.string(), perPerson: Money, accepted: z.boolean() }).nullable(),
  /** A photo or PDF the agent sent, with a short-lived signed link to open it. */
  attachment: ThreadAttachment.nullable().optional(),
  createdAt: IsoDateTime,
});
export type ThreadMessage = z.infer<typeof ThreadMessage>;
export const MessagesResponse = z.object({ messages: z.array(ThreadMessage), agentTyping: z.boolean() });
export type MessagesResponse = z.infer<typeof MessagesResponse>;
export const PostMessageBody = z.object({ text: z.string().trim().min(1).max(2000), clientId: z.string().min(8).max(64).optional() });
export const AcceptOfferBody = z.object({ messageId: Id });

/* Cards and credit: the Wallet's /cards and /credit (schemas/wallet.ts). Orders pay with a saved card's id. */
/* ───────────── orders ───────────── */

export const OrderKind = z.enum(['trip', 'stay', 'package', 'quote', 'esim', 'share']);
export type OrderKind = z.infer<typeof OrderKind>;

export const OrderDraft = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('trip'), flightOfferId: Id, bundle: z.boolean().default(false), travellerIds: z.array(Id).min(1).max(9) }),
  /** requests: what to tell the hotel (late check-in, high floor, a cot…), kept on the order and sent on as its remark. */
  z.object({ kind: z.literal('stay'), stayOfferId: Id, travellerIds: z.array(Id).min(1).max(12), tripId: Id.nullish(), requests: HotelRequests.nullish() }),
  z.object({ kind: z.literal('package'), planId: z.string().max(40), travellerIds: z.array(Id).min(1).max(12) }),
  /** optionId: which fare option of a flight quote (the first when there is only one). */
  z.object({ kind: z.literal('quote'), requestId: Id, optionId: z.string().min(1).max(40).optional() }),
  /** packageId: the plan picked (schemas/esim.ts), one eSIM per traveller; topupOf: more GB on an eSIM already bought. */
  z.object({
    kind: z.literal('esim'), count: z.number().int().min(1).max(12), packageId: z.string().min(1).max(400).optional(), where: z.string().max(20).optional(),
    tripId: Id.nullish(), travellerIds: z.array(Id).max(12).optional(), topupOf: Id.optional(),
    /** A daily plan: how many days. */
    days: z.number().int().min(1).max(365).optional(),
  }),
  /** Your share of a split in a circle, paid by card. The amount comes from the circle, never from the app. */
  z.object({ kind: z.literal('share'), circleId: Id, messageId: Id, shareKey: z.string().min(1).max(64) }),
]);
export type OrderDraft = z.input<typeof OrderDraft>;

export const PayPlan = z.enum(['full', 'tabby', 'tamara']);
export type PayPlan = z.infer<typeof PayPlan>;

export const PreviewBody = z.object({
  draft: OrderDraft,
  promo: z.string().trim().max(20).nullish(),
  useCredit: z.boolean().default(true),
  /** Preferences for this booking only; left out, the saved ones apply (booking-prefs.ts). */
  prefs: BookingPrefs.nullish(),
  /** Paid extras the traveller added on the sheet this time (never remembered). */
  extras: BookingExtras.nullish(),
  /** Loyalty numbers per traveller; left out, the account holder's saved numbers for this carrier or hotel apply. */
  loyalty: z.array(BookingLoyalty).max(12).nullish(),
});
export type PreviewBody = z.input<typeof PreviewBody>;

export const OrderLine = z.object({ key: z.string(), icon: z.enum(['flight', 'stay', 'car', 'star', 'doc', 'globe']), text: z.string(), amount: HalalasAmount });

/** What the order sheet applied from the saved preferences, for its "Your preferences" and loyalty rows. */
export const AppliedPrefs = z.object({
  prefs: BookingPrefs,
  /** Short labels in the traveller's language ("Window", "Seats together", "Halal"). */
  summary: z.array(z.string()),
  /** Which part of the preferences this booking uses. */
  scope: z.enum(['flight', 'stay', 'both']),
  loyalty: z.array(BookingLoyaltyBase.extend({ programName: z.string(), masked: z.string() })),
  /** Programmes this booking earns on, for adding a number on the sheet. */
  programmes: z.array(z.string()),
  /** A paid extra the fare prices, with its price: on the order only when `added`. */
  /** `carrier` is the airline's code and `airline` its name, from the flight itself (never read back from a line's words). */
  extrasOffer: z.object({ key: z.literal('seatsTogether'), carrier: z.string().optional(), airline: z.string().optional(), perPerson: Money, count: z.number().int(), legs: z.number().int(), total: Money, added: z.boolean() }).nullable(),
});
export type AppliedPrefs = z.infer<typeof AppliedPrefs>;
export type OrderLine = z.infer<typeof OrderLine>;

export const OrderRenewal = z.object({ personId: Id, name: z.string(), by: IsoDay, fee: HalalasAmount, inTime: z.boolean(), asked: z.boolean() });
export type OrderRenewal = z.infer<typeof OrderRenewal>;

export const OrderFamily = z.object({
  /** "2 × 23 kg", as the fare gives it, for each person with a seat. */
  bags: z.string().nullable(),
  /** Babies on a lap: a bassinet is asked for each. */
  bassinets: z.number().int(),
  /** Children 2 to 11: a child meal is asked for each. */
  childMeals: z.number().int(),
  /** Travellers 12 to 17: airlines price them as adults. */
  adultFares: z.array(z.object({ personId: Id, name: z.string(), age: z.number().int() })),
});
export type OrderFamily = z.infer<typeof OrderFamily>;

export const OrderPreview = z.object({
  kind: OrderKind,
  title: z.string(),
  /** Photo for the sheet's hero. */
  photo: z.string(),
  lines: z.array(OrderLine),
  subtotal: Money,
  promo: z.object({ code: z.string(), status: z.enum(['applied', 'ended', 'unknown']), message: z.string().nullable(), discount: Money }).nullable(),
  credit: z.object({ balance: Money, used: Money }),
  total: Money,
  /** Cancellation rule worked out from this booking's own dates. */
  rule: z.string(),
  /** Whether an agent confirms it (authorised now, captured on issue) or it's charged now. */
  agent: z.boolean(),
  /** Price hold: when it ends the price must be re-checked. */
  holdExpiresAt: IsoDateTime.nullable(),
  instalments: z.object({ tabby: Money, tamara: Money }).nullable(),
  travellerIds: z.array(Id),
  /** People on the booking without a passport yet: book now, add within 48 hours. */
  missingPassports: z.array(Id),
  /**
   * A room: the facts the app repeats in the traveller's language before they pay (cancellation, local tax paid at the
   * hotel, the hotel's own notes), so nothing at the last step is a surprise.
   */
  stay: z.object({
    name: z.string(), checkIn: IsoDay, nights: z.number().int(), freeCancelUntil: IsoDay.nullable(), refundable: z.boolean(),
    payAtHotel: Money.nullable(), essentials: z.string().nullable(), facts: StayFacts.nullable(),
  }).nullable().optional(),
  /** Preferences, loyalty and paid extras as applied to this booking (null for shares and eSIMs). */
  applied: AppliedPrefs.nullable().optional(),
  /**
   * Passports too short for this trip: when Mada can have each renewed by, its fee, whether that's before the flight,
   * and whether it's already asked. One in time and not yet asked is asked with the order (CreateOrderBody.renewals).
   */
  renewals: z.array(OrderRenewal).optional(),
  /** A flight with a family: the bags each, a bassinet asked for each baby on a lap, child meals, and who 12 to 17 pays as an adult. */
  family: OrderFamily.nullable().optional(),
  /** The flight on the sheet is a sample fare from the mock catalogue (FlightOption.demo): the sheet says so. */
  demoFare: z.boolean().optional(),
});
export type OrderPreview = z.infer<typeof OrderPreview>;
export const PreviewResponse = z.object({ preview: OrderPreview });

export const PaymentChoice = z.discriminatedUnion('method', [
  z.object({ method: z.literal('card'), cardId: Id }),
  /** A card added just now and not saved: the provider's one-time token. */
  z.object({ method: z.literal('new_card'), token: z.string().min(8).max(200), brand: CardBrand, last4: z.string().regex(/^\d{4}$/) }),
  z.object({ method: z.literal('applepay'), token: z.string().min(8).max(400) }),
  /** Mada credit covers it all. */
  z.object({ method: z.literal('credit') }),
  /** Someone in a circle pays: the order waits for them (a split in the circle carries the pay link). */
  z.object({ method: z.literal('someone_else'), userId: Id, circleId: Id }),
]);
export type PaymentChoice = z.infer<typeof PaymentChoice>;

export const CreateOrderBody = PreviewBody.extend({
  payment: PaymentChoice,
  plan: PayPlan.default('full'),
  /** The total the traveller saw and slid to accept. If the supplier's price moved, we ask again. */
  expectedTotal: HalalasAmount,
  /** One per slide: a retried request never books twice. */
  idempotencyKey: z.string().min(8).max(80),
  /** Accounts without a verified phone, while booking allows it (GET /config features.bookingNeedsPhone off): a number to call. */
  contactPhone: ContactPhone.optional(),
  /** Short passports the traveller agreed Mada renews (OrderPreview.renewals): asked with the order, the booking goes ahead. */
  renewals: z.array(Id).max(12).optional(),
});
export type CreateOrderBody = z.input<typeof CreateOrderBody>;

export const OrderStatus = z.enum([
  'payment_requested', 'requires_action', 'pending_agent', 'held', 'price_locked', 'issuing', 'needs_answer', 'fare_changed', 'ticketing_failed', 'confirmed', 'cancelled', 'declined',
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const OrderView = z.object({
  id: Id,
  kind: OrderKind,
  status: OrderStatus,
  /** 0 holding seats · 1 price locked · 2 issuing · 3 done. */
  step: z.number().int().min(0).max(3),
  title: z.string(),
  /** "Istanbul" */
  place: z.string(),
  /** "Tue 9 Mar · 09:40 from Riyadh" pieces. */
  depart: IsoDay.nullable(),
  departTime: z.string().nullable(),
  from: z.string().nullable(),
  oneway: z.boolean(),
  photo: z.string(),
  carrier: z.string().nullable(),
  airline: z.string().nullable(),
  flightNumber: z.string().nullable(),
  cabin: Cabin.nullable(),
  seats: z.array(z.string()),
  travellerIds: z.array(Id),
  lines: z.array(OrderLine),
  total: Money,
  /** The fare went up while Mada held the seats and the traveller said yes. */
  extra: Money,
  plan: PayPlan,
  paymentLabel: z.string(),
  creditUsed: Money,
  bundle: z.boolean(),
  ref: z.string().nullable(),
  /** The person on duty for this booking, from the desk. */
  agent: AgentInfo.nullable(),
  /** Set only when that person confirmed it (COPY.md §1). */
  confirmedBy: AgentInfo.nullable(),
  question: z.object({ text: z.string(), options: z.array(z.enum(['yes', 'call'])), calling: z.boolean() }).nullable(),
  fareChange: z.object({ perPerson: Money, total: Money, newTotal: Money }).nullable(),
  problem: z.string().nullable(),
  /**
   * Set only while status is 'ticketing_failed': what failed and what the traveller can do (POST /orders/:id/answer).
   * cause 'payment': the card capture didn't go through · 'airline': the airline's system didn't issue the tickets.
   * Nothing was charged in either case (the authorisation is released). Optional so older builds still parse.
   */
  failure: z.object({ cause: z.enum(['payment', 'airline']), actions: z.array(z.enum(['retry_by_phone', 'cancel'])) }).nullable().optional(),
  /** Over 8 seconds without finishing: "Taking longer than usual". */
  slow: z.boolean(),
  tripId: Id.nullable(),
  requestId: Id.nullable(),
  /** 3-D Secure: the bank wants a code before authorising. */
  action: z.object({ kind: z.literal('otp'), triesLeft: z.number().int(), label: z.string(), amount: Money }).nullable(),
  /** Set when someone else was asked to pay: who, in which circle, and whether they have. */
  payRequest: z.object({ userId: Id, name: z.string(), circleId: Id, messageId: Id, shareKey: z.string(), requestedAt: IsoDateTime, paidAt: IsoDateTime.nullable() }).nullable().optional(),
  /** How a booking that won't go ahead ended (cancelled, not issued): the reason, the money, the next step. */
  result: RequestResult.nullable().optional(),
  createdAt: IsoDateTime,
  confirmedAt: IsoDateTime.nullable(),
});
export type OrderView = z.infer<typeof OrderView>;
export const OrderResponse = z.object({ order: OrderView });
export const OrdersResponse = z.object({ orders: z.array(OrderView) });

/** POST /orders answers with an outcome: a business result, not an error. */
export const CreateOrderResponse = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('created'), order: OrderView }),
  z.object({ outcome: z.literal('requires_action'), order: OrderView }),
  z.object({ outcome: z.literal('declined'), message: z.string() }),
  z.object({ outcome: z.literal('price_changed'), previousTotal: Money, preview: OrderPreview, changedBy: Money }),
  z.object({ outcome: z.literal('hold_ended'), preview: OrderPreview }),
  z.object({ outcome: z.literal('blocked'), message: z.string() }),
  /** Charged now (requests, eSIMs): nothing for an agent to confirm. */
  z.object({ outcome: z.literal('paid'), order: OrderView }),
  /** Someone else was asked to pay: nothing charged, the order waits for them. */
  z.object({ outcome: z.literal('payment_requested'), order: OrderView }),
]);
export type CreateOrderResponse = z.infer<typeof CreateOrderResponse>;

export const ThreeDsBody = z.object({ code: z.string().regex(/^\d{6}$/) });
/** `resend_code`: the bank's 3-D Secure code didn't come; ask for another (at most three times). */
export const OrderAnswerBody = z.object({ answer: z.enum(['yes', 'call', 'accept_fare', 'stop', 'retry_by_phone', 'cancel', 'remind', 'resend_code']) });

/* ───────────── what a confirmed booking writes into Trips ───────────── */

/** The money side of a booked trip, kept with it for the receipt, the refund rules and the VAT invoice. */
export const TripBooking = z.object({
  orderId: Id,
  ref: z.string(),
  lines: z.array(OrderLine),
  paid: z.object({
    subtotal: Money, discount: Money, promo: z.string().nullable(), creditUsed: Money, charged: Money,
    /** "Visa ending 41", "Apple Pay", "Mada credit" */
    card: z.string(),
  }),
  payPlan: PayPlan,
  bookedAt: IsoDateTime,
});
export type TripBooking = z.infer<typeof TripBooking>;

/** A trip as the booking flow writes it: the M0 Trip shape plus its booking. Trips reads app_trips/app_segments/app_stays/app_pickups and app_trip_bookings. */
export const BookedTrip = Trip.extend({ booking: TripBooking.nullable() });
export type BookedTrip = z.infer<typeof BookedTrip>;
export { FlightSegment as BookedSegment, Stay as BookedStay, Pickup as BookedPickup };

/** POST /payments/webhook (MyFatoorah-style). Idempotent by eventId. */
export const PaymentWebhookBody = z.object({
  eventId: z.string().min(4).max(120),
  type: z.enum(['payment.authorized', 'payment.captured', 'payment.voided', 'payment.declined', 'payment.refunded']),
  providerRef: z.string().min(4).max(120),
  amount: HalalasAmount.optional(),
});
export type PaymentWebhookBody = z.infer<typeof PaymentWebhookBody>;
