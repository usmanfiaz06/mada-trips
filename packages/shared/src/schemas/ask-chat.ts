import { z } from 'zod';
import { Id, IsoDateTime, IsoDay, Money } from './common';
import { AskIntent, EntryCheckResponse, FlightOption, HomeAirport, OrderDraft, StayOption } from './booking';
import { EsimPlan } from './esim';
import { RefundReason, RefundView, TripCard, TripPaymentItem } from './trips';
import { ChangeRequestView, PeopleMatch } from './trip-travellers';
import { ChatDocCard, ChatShareCard } from './ask-docs';
import { StayQuoteOption } from './stay-quote';

/*
 * Ask Mada as a conversation (docs/app/ASK-CHAT.md). POST /ask/chat answers with Server-Sent Events: the words as they
 * come, then the cards the app already draws (flights, stays, eSIM plans, entry rules), all from tool results this
 * turn. The model never writes a price: every number in a card is the supplier's, and a reply that names a price or a
 * time no tool returned is replaced before it reaches the phone. Off (ASK_CHAT=off, no key, any failure): the app runs
 * its own flows from /ask/parse, as before.
 */

export const ASK_CHAT_ROUTE = '/ask/chat';
/** The GET /config feature that turns the conversation on in the app. */
export const ASK_CHAT_FEATURE = 'askChat';

export const AskChatRequest = z.object({
  text: z.string().trim().min(1).max(1000),
  /** The thread to continue; a new one when missing or not the caller's. */
  threadId: Id.nullish(),
  /** The trip on screen, so "a hotel" means a hotel there. From the trip page it also attaches a new chat to that trip. */
  tripId: Id.nullish(),
  /**
   * The answer to "About your AlUla trip?" (an `attach` card, docs/app/ASK-INTEGRATED.md §2.2), sent with the same
   * words again: trip continues in that trip's chat (tripId), new starts a chat of its own.
   */
  attach: z.enum(['trip', 'new']).nullish(),
});
export type AskChatRequest = z.input<typeof AskChatRequest>;

/** What a card was searched for, so tapping it opens the full flow with the same search. */
export const ChatSearch = z.object({
  destination: z.string(),
  destinationName: z.string(),
  /** A place without a key ('other'): its Arabic name when we hold one. */
  destinationNameAr: z.string().nullable().optional(),
  from: HomeAirport.nullable(),
  depart: IsoDay,
  return: IsoDay.nullable(),
  travellerIds: z.array(Id),
});
export type ChatSearch = z.infer<typeof ChatSearch>;

/**
 * One plan item as a chat card draws it: what it is, its places (names, so the app writes them in the reader's language
 * and direction), its status, and a drive's numbers only when the drive interface measured them.
 */
export const ChatPlanRow = z.object({
  kind: z.enum(['leg', 'stay', 'car', 'activity', 'meal', 'note', 'check']),
  mode: z.enum(['flight', 'drive', 'train', 'ferry', 'transfer', 'walk']).nullable(),
  title: z.string(),
  place: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  status: z.enum(['idea', 'priced', 'requested', 'held', 'booked', 'confirmed', 'cancelled', 'skipped']),
  nights: z.number().int().nullable(),
  /** "09:40": only a time a template, a tool or the traveller gave. */
  at: z.string().nullable(),
  km: z.number().nullable(),
  minutes: z.number().int().nullable(),
  borders: z.array(z.string()).max(4).default([]),
  /** The hotel's or flight's name once booked. */
  booking: z.string().nullable(),
});
export type ChatPlanRow = z.infer<typeof ChatPlanRow>;

/**
 * A place from Google Places (CONNECT.md §32) as a chat card draws it: restaurants, cafés, sights, malls, mosques,
 * pharmacies. Open now and today's hours are worked out by the server from the weekly hours when the card is made
 * (never a cached "open"). The photo is our own image link (the key never leaves the server) with its author's credit,
 * shown under the photo as Google requires. `id` is Google's place id: it opens the details and goes on the plan.
 */
export const ChatPlace = z.object({
  id: z.string().min(1).max(300),
  name: z.string().min(1).max(160),
  /** "Shawarma restaurant", "Mosque", in the reader's language when Google has it. */
  type: z.string().max(80).nullable(),
  rating: z.number().min(0).max(5).nullable(),
  ratings: z.number().int().min(0).nullable(),
  /** 1 (inexpensive) to 4 (very expensive); null when Google doesn't say. */
  price: z.number().int().min(0).max(4).nullable(),
  /** Open right now, and when it next closes or opens ("23:00", local time); null when Google has no hours. */
  open: z.object({ now: z.boolean(), closes: z.string().nullable(), opens: z.string().nullable() }).nullable(),
  /** Today's hours as Google writes them ("12:00 – 11:00 PM"), the day name left off. */
  today: z.string().max(160).nullable(),
  address: z.string().max(300).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  /** Metres from the trip's hotel (or the point searched around), when we know where that is. */
  distanceM: z.number().int().min(0).nullable(),
  photo: z.object({ url: z.string(), credit: z.array(z.object({ name: z.string().max(120), url: z.string().nullable() })).max(3) }).nullable(),
  /** The details only (place_details): the week's hours, the phone, the website, Google's map link. */
  week: z.array(z.string().max(160)).max(7).optional(),
  phone: z.string().max(40).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  mapsUrl: z.string().max(500).nullable().optional(),
});
export type ChatPlace = z.infer<typeof ChatPlace>;

export const ChatCard = z.discriminatedUnion('type', [
  z.object({ type: z.literal('flights'), search: ChatSearch, options: z.array(FlightOption).max(3) }),
  z.object({ type: z.literal('stays'), search: ChatSearch, nights: z.number().int(), options: z.array(StayOption).max(3), near: z.string().nullable() }),
  z.object({ type: z.literal('esim'), where: z.string(), days: z.number().int(), plans: z.array(EsimPlan).max(3) }),
  z.object({ type: z.literal('entry'), destination: z.string(), entry: EntryCheckResponse }),
  z.object({ type: z.literal('trips'), trips: z.array(TripCard).max(4) }),
  /** A car now: what was read, for the app's car flow to finish (the meeting point is always confirmed there). */
  z.object({ type: z.literal('car'), city: z.string().nullable(), from: z.string().nullable(), to: z.string().nullable(), when: z.enum(['now', 'in15']) }),
  /** Something the team arranges by hand: what, when and who (detail), when the team gets back, and how. */
  z.object({
    type: z.literal('request'), requestId: Id, kind: z.string(), title: z.string(),
    detail: z.string().optional(), promisedBy: IsoDateTime.nullable().optional(),
    contact: z.enum(['call', 'whatsapp', 'in_app']).nullable().optional(),
    /** Written out on the card: where, the days, and who (each traveller's name, the account holder marked). */
    where: z.string().max(80).nullable().optional(),
    depart: IsoDay.nullable().optional(),
    return: IsoDay.nullable().optional(),
    who: z.array(z.object({ name: z.string(), self: z.boolean() })).max(12).optional(),
  }),
  /**
   * "About your AlUla trip in Nov?": the first message names a place the traveller already has a trip to. Asked once,
   * never guessed (ASK-INTEGRATED.md §2.2): the app sends the same words again with `attach`.
   */
  z.object({ type: z.literal('attach'), tripId: Id, place: z.string(), when: z.string().nullable() }),
  /**
   * Companions (ASK-INTEGRATED.md §5, U5). "Which Abdullah?": up to 4 people the name matched, never a guess; the tap
   * adds the one picked. "He isn't in your circle yet": an invite that only goes out on a tap (it shares the trip's
   * name and dates). A change a companion asked for: the same card in his chat and the owner's, read again live.
   */
  z.object({ type: z.literal('people'), tripId: Id, name: z.string(), options: z.array(PeopleMatch).min(1).max(4) }),
  z.object({ type: z.literal('invite'), tripId: Id, name: z.string(), tripTitle: z.string(), when: z.string().nullable() }),
  z.object({ type: z.literal('change'), change: ChangeRequestView }),
  /** "Here's your plan, review it" (ASK-INTEGRATED.md §3.3): the living plan at this version, a few rows a day. */
  z.object({
    type: z.literal('plan'), planId: Id, tripId: Id, version: z.number().int(), title: z.string(),
    start: IsoDay, end: IsoDay,
    /** Where it starts and how we know (said, remembered…); null with originNeeded when nobody knows yet. */
    origin: z.object({ name: z.string(), code: z.string().nullable(), source: z.string() }).nullable(),
    originNeeded: z.boolean(),
    travellers: z.array(z.object({ name: z.string(), self: z.boolean() })).max(12),
    days: z.array(z.object({ day: z.number().int(), items: z.array(ChatPlanRow).max(5) })).max(7),
    /** Days after the seventh, not drawn (the plan screen has them). */
    more: z.number().int(),
    /** What's left to do (the checks that aren't fine), at most 3. */
    todo: z.array(z.object({ key: z.string(), state: z.string(), days: z.array(z.number().int()).default([]) })).max(3),
    /** Prices from tools and bookings only (plans.ts PlanTotals): "Ready to book · SAR 2,480" with [Book what's ready]. */
    totals: z.object({ priced: z.number().int(), booked: z.number().int(), demo: z.boolean(), ready: z.number().int() }).nullable().optional(),
  }),
  /** What a later turn changed in the plan, instead of the whole plan again (§3.3). */
  z.object({
    type: z.literal('plan_diff'), planId: Id, tripId: Id, title: z.string(), from: z.number().int(), to: z.number().int(),
    changes: z.array(z.object({ op: z.enum(['create', 'add', 'move', 'update', 'remove', 'status', 'origin']), day: z.number().int().nullable(), row: ChatPlanRow })).max(8),
    /** Booked items a change couldn't touch: Mada offers the change flow for them. */
    untouched: z.array(z.string()).max(4).default([]),
  }),
  /** A place in the app (open_in_app): "Your boarding pass is in Wallet" with a button there. */
  z.object({ type: z.literal('link'), screen: z.enum(['plan', 'trip', 'documents', 'household', 'esim', 'requests', 'money', 'change', 'refund', 'support']), id: Id.nullable() }),
  /** A passport, visa or ID sent in the chat (ask-docs.ts, ASK-INTEGRATED.md §6): one card, saved only on its tap. */
  ChatDocCard,
  /** Asking a companion to share their passport for the trip (§5.4): sent only on its tap. */
  ChatShareCard,
  /**
   * "Start a chat for Istanbul?" (ASK-INTEGRATED.md §2.2): this chat is about another trip and the words name a new place.
   * Mada answers here and offers the tap; the words are carried over to the new chat. Never split silently.
   */
  z.object({ type: z.literal('new_chat'), place: z.string(), text: z.string().max(1000) }),
  /**
   * A companion's change the owner approved that costs money (§5.5 step 4), on the payer's phone only: "Abdullah's
   * change needs booking · SAR 650" with Book · Not now. amount is the desk's quote; null while the team prices it.
   * Book opens the pay sheet with that quote; nothing is charged from the chat.
   */
  z.object({
    type: z.literal('pay_change'), tripId: Id, changeId: Id, byName: z.string(), tripTitle: z.string(), what: z.string(),
    requestId: Id.nullable(), amount: z.number().int().nullable(), promisedBy: z.string().nullable(),
  }),
  /**
   * Rooms the team priced by hand for a stay request (desk "Add hotel quote"): up to three options, each with its
   * hotel, dates, room, board, all-in total and cancellation line, and Book (the pay sheet with that option) · Not now.
   * Nothing is charged from the chat.
   */
  z.object({
    type: z.literal('stay_quote'), requestId: Id, quoteId: Id, options: z.array(StayQuoteOption).min(1).max(3), expiresAt: IsoDateTime.nullable(),
  }),
  /**
   * Places (find_places, CONNECT.md §32): up to 5, each with its photo, kind, rating, price level, open now and how far
   * from the hotel. `near` names where they were searched around ("your hotel", "Taksim"); `tripId` is the trip whose
   * plan "Add to plan" goes on. Tapping one opens its details.
   */
  z.object({ type: z.literal('places'), query: z.string().max(200), near: z.string().max(120).nullable(), tripId: Id.nullable(), places: z.array(ChatPlace).min(1).max(5) }),
  /** One place in full (place_details): Directions, Call, Website, Add to plan. */
  z.object({ type: z.literal('place'), tripId: Id.nullable(), place: ChatPlace }),
  /**
   * Cancel and refund from the chat (refund_quote, docs/app/ASK-REFUND.md): what comes back under the same rules as the
   * refund screen, what the hotel or airline keeps, and the same two places for it (the Mada Wallet first and marked
   * Recommended, "instantly" only when the rules approve it at once; or back to the card). Nothing is cancelled until the
   * traveller slides: that calls the refund screen's own POST /trips/{id}/refunds with `clientKey`, so a second slide or
   * a retried turn finds the same refund. `refund` is set when it was already asked for: the card shows the tracker.
   */
  z.object({
    type: z.literal('refund_quote'), tripId: Id, title: z.string().max(200), city: z.string().max(80),
    paymentIds: z.array(Id).min(1).max(10), items: z.array(TripPaymentItem).max(10), reason: RefundReason, clientKey: z.string().min(8).max(64),
    paid: Money, back: Money,
    /** What the hotel, airline or driver keeps under the rules; null when it all comes back. */
    kept: Money.nullable(), keptBy: z.enum(['hotel', 'airline', 'driver', 'supplier']).nullable(),
    rule: z.string().max(300),
    /** Nothing comes back by the rules: the slide asks the team anyway. */
    anyway: z.boolean(),
    /** Paid with instalments: it goes back through Tabby or Tamara, no choice to make. */
    instalments: z.enum(['tabby', 'tamara']).nullable(),
    card: z.string().max(80),
    /** The Mada Wallet pick is approved at once by the rules (APP_REFUND_AUTO_MAX); else "once we've checked it". */
    walletInstant: z.boolean(),
    refund: RefundView.nullable(),
  }),
]);
export type ChatCard = z.infer<typeof ChatCard>;

/** A price the traveller can pay: the app opens its own pay sheet with this draft (nothing is ever charged from chat). */
export const ChatPay = z.object({ draft: OrderDraft, title: z.string() });
export type ChatPay = z.infer<typeof ChatPay>;

/** The stream, one JSON object per `data:` line, its `event:` the type. */
export const AskChatEvent = z.discriminatedUnion('type', [
  /**
   * The thread this turn is in. moved: the message went into an existing chat (the trip's own, after "Yes, that trip"),
   * so the app opens that thread's earlier turns. tripId: the trip the chat is about, when there is one.
   */
  z.object({ type: z.literal('thread'), threadId: Id, lang: z.enum(['en', 'ar']), moved: z.boolean().optional(), tripId: Id.nullable().optional() }),
  /** What is being done right now ("Checking flights to Istanbul"), for the typing line. */
  z.object({ type: z.literal('status'), text: z.string(), tool: z.string().max(40).optional() }),
  z.object({ type: z.literal('text'), delta: z.string() }),
  /** The words so far are replaced (a check failed, or a fixed line answers): show this instead. */
  z.object({ type: z.literal('replace'), text: z.string() }),
  z.object({ type: z.literal('cards'), cards: z.array(ChatCard) }),
  /** What the sentence was read as, for the app's own flows if the conversation stops. */
  z.object({ type: z.literal('intent'), intent: AskIntent }),
  z.object({ type: z.literal('pay'), pay: ChatPay }),
  /** A person takes it from here, in this support thread. agent: who is on duty, only when the desk names someone. */
  z.object({ type: z.literal('handoff'), threadId: Id, agent: z.string().nullable() }),
  /**
   * A person on the desk has taken this conversation over (desk/ask): the message was kept for them and Mada doesn't
   * answer it. Their replies come from GET /ask/chat/desk. name: their first name, as the app shows people.
   */
  z.object({ type: z.literal('agent'), name: z.string() }),
  /**
   * What the traveller can do next, as 2 or 3 chips that send their words when tapped (docs/app/ASSISTANT.md: every
   * reply ends with a next step). Mada's own when it wrote them; otherwise the server fills them from the turn.
   */
  z.object({ type: z.literal('next'), choices: z.array(z.string().min(1).max(60)).min(1).max(3) }),
  z.object({ type: z.literal('done'), text: z.string() }),
  /** fallback: the app should answer with its own flows. */
  z.object({ type: z.literal('error'), code: z.string(), fallback: z.boolean() }),
]);
export type AskChatEvent = z.infer<typeof AskChatEvent>;

/** GET /ask/chat/desk?threadId=…&after=n: what a person on the desk said in this thread since line n (the desk's take-over). */
export const ASK_CHAT_DESK_ROUTE = '/ask/chat/desk';
export const AskDeskLine = z.object({
  /** Its place in the thread: pass the last one back as `after`. */
  n: z.number().int(),
  /** agent: a reply from a person on the desk (`by`). joined: the line "Noura from Mada joined", shown once. */
  kind: z.enum(['agent', 'joined']),
  by: z.string(),
  text: z.string(),
  at: IsoDateTime,
});
export type AskDeskLine = z.infer<typeof AskDeskLine>;
export const AskDeskResponse = z.object({
  /** agent: a person has the conversation (Mada doesn't answer); ai: Mada answers. */
  mode: z.enum(['ai', 'agent']),
  /** Who has it, while a person does. */
  agent: z.string().nullable(),
  lines: z.array(AskDeskLine),
  /** The last line in the thread: the next `after`. */
  last: z.number().int(),
});
export type AskDeskResponse = z.infer<typeof AskDeskResponse>;

/*
 * The conversations list (docs/app/ASK-INTEGRATED.md §2): one chat per trip or topic, titled on the server
 * ("Riyadh → AlUla · 20–22 Nov", "eSIM for Pakistan"), searchable by title, preview and trip place (never the words
 * inside), archived without deleting. Opening a chat reads its transcript from the server, so it opens on any device.
 */
export const ASK_THREADS_ROUTE = '/ask/threads';
export const askThreadRoute = (id: string) => `/ask/threads/${id}`;

/**
 * The shared trip chat (§5.5): GET says whether it's on and who's in it; POST (owner) turns it on and answers with its
 * thread; DELETE (owner) turns it off (archived, kept). Private chats with Mada stay as they are.
 */
export const TripChatResponse = z.object({
  on: z.boolean(),
  threadId: Id.nullable(),
  canManage: z.boolean(),
  members: z.array(z.object({ name: z.string(), initial: z.string(), owner: z.boolean(), me: z.boolean() })).max(12),
});
export type TripChatResponse = z.infer<typeof TripChatResponse>;
export const tripChatRoute = (tripId: string) => `/trips/${tripId}/chat`;

/** Planning (no booking yet), booked, today (the trip is on), done (ended or cancelled). */
export const AskTripStatus = z.enum(['planning', 'booked', 'today', 'done']);
export type AskTripStatus = z.infer<typeof AskTripStatus>;

export const AskThreadRow = z.object({
  id: Id,
  /** Null until the first turn names it; the app shows "New chat". */
  title: z.string().nullable(),
  tripId: Id.nullable(),
  tripStatus: AskTripStatus.nullable(),
  /** The trip's first day, for the Upcoming trips section's order. */
  tripStart: IsoDay.nullable(),
  /** The last line, redacted, ≤ 140 characters. */
  preview: z.string().nullable(),
  lastAt: IsoDateTime,
  /** agent: a person on the desk has the chat now (`agent` is their name, "Noura from Mada is here"). */
  mode: z.enum(['ai', 'agent']),
  agent: z.string().nullable(),
  /** The desk wrote last and the traveller hasn't answered. */
  unread: z.boolean(),
  archived: z.boolean(),
  /** Full (60 turns): the list offers "Continue in a new chat", which carries the trip over. */
  ended: z.boolean(),
  lang: z.enum(['en', 'ar']),
  /** With a search: the line said in the chat that has the words (a few words either side), or null when the title matched. */
  match: z.string().nullable().optional(),
  /** trip: the shared trip chat (§5.5), every traveller on Mada and Mada in one thread. Missing means private. */
  kind: z.enum(['private', 'trip']).optional(),
  /** The trip chat's people, owner first, for the row's avatars (first names only). */
  members: z.array(z.object({ name: z.string(), initial: z.string(), owner: z.boolean(), me: z.boolean() })).max(12).optional(),
  /** The caller may rename, archive and delete it (a companion in a trip chat may not). */
  mine: z.boolean().optional(),
});
export type AskThreadRow = z.infer<typeof AskThreadRow>;

/**
 * GET /ask/threads?q=&archived=1&filter=&tripId=&before= → 30 a page, newest first; next is the cursor for the page after.
 * q searches titles, trip places and every line said (the traveller's own chats). filter: trips, upcoming or past.
 */
export const ASK_THREAD_FILTERS = ['trips', 'upcoming', 'past'] as const;
export const AskThreadsResponse = z.object({ threads: z.array(AskThreadRow), next: z.string().nullable(), archivedCount: z.number().int() });
export type AskThreadsResponse = z.infer<typeof AskThreadsResponse>;

/** One line of a chat as the app shows it again: words, the cards' kinds, the next steps, who wrote it. */
export const AskThreadLine = z.object({
  /** member: another traveller in a shared trip chat, named in `by`. */
  who: z.enum(['me', 'mada', 'agent', 'joined', 'member']),
  text: z.string(),
  cards: z.array(z.string()).optional(),
  next: z.array(z.string()).optional(),
  /** A person on the desk, by the name the traveller knows. */
  by: z.string().nullable().optional(),
  at: IsoDateTime.nullable().optional(),
  /** Cards kept with the line because they are references, read again live (a change asked by a companion, §5.5). */
  kept: z.array(ChatCard).max(2).optional(),
  /** A document the traveller sent: its kind and the masked label, never the photo (ASK-INTEGRATED.md §6.4). */
  attachment: z.object({ kind: z.string(), label: z.string() }).optional(),
});
export type AskThreadLine = z.infer<typeof AskThreadLine>;

/** GET /ask/threads/{id}: the chat and every line of it, for opening on any device. `last` is the desk's `after`. */
export const AskThreadResponse = z.object({ thread: AskThreadRow, lines: z.array(AskThreadLine), last: z.number().int() });
export type AskThreadResponse = z.infer<typeof AskThreadResponse>;

/** PATCH /ask/threads/{id}: rename (an empty title goes back to the automatic one), archive or unarchive. */
export const AskThreadPatch = z.object({
  title: z.string().trim().max(80).nullable().optional(),
  archived: z.boolean().optional(),
  /** The trip a booking made in this chat created (§2.2): only a chat not yet about a trip, only the caller's trip. */
  tripId: Id.optional(),
}).refine((v) => v.title !== undefined || v.archived !== undefined || v.tripId !== undefined, { message: 'Nothing to change' });
export type AskThreadPatch = z.input<typeof AskThreadPatch>;

/** Read an SSE body as it arrives: complete `data:` frames out, the rest kept for the next chunk. */
export function readSseFrames(buffer: string): { events: AskChatEvent[]; rest: string } {
  const events: AskChatEvent[] = [];
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = parts.pop() ?? '';
  for (const frame of parts) {
    const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!data) continue;
    try {
      const e = AskChatEvent.safeParse(JSON.parse(data));
      if (e.success) events.push(e.data);
    } catch { /* a frame we can't read is skipped, never fatal */ }
  }
  return { events, rest };
}
