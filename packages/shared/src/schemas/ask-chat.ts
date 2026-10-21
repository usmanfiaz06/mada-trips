import { z } from 'zod';
import { Id, IsoDateTime, IsoDay } from './common';
import { AskIntent, EntryCheckResponse, FlightOption, HomeAirport, OrderDraft, StayOption } from './booking';
import { EsimPlan } from './esim';
import { TripCard } from './trips';

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
  from: HomeAirport.nullable(),
  depart: IsoDay,
  return: IsoDay.nullable(),
  travellerIds: z.array(Id),
});
export type ChatSearch = z.infer<typeof ChatSearch>;

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
  who: z.enum(['me', 'mada', 'agent', 'joined']),
  text: z.string(),
  cards: z.array(z.string()).optional(),
  next: z.array(z.string()).optional(),
  /** A person on the desk, by the name the traveller knows. */
  by: z.string().nullable().optional(),
  at: IsoDateTime.nullable().optional(),
});
export type AskThreadLine = z.infer<typeof AskThreadLine>;

/** GET /ask/threads/{id}: the chat and every line of it, for opening on any device. `last` is the desk's `after`. */
export const AskThreadResponse = z.object({ thread: AskThreadRow, lines: z.array(AskThreadLine), last: z.number().int() });
export type AskThreadResponse = z.infer<typeof AskThreadResponse>;

/** PATCH /ask/threads/{id}: rename (an empty title goes back to the automatic one), archive or unarchive. */
export const AskThreadPatch = z.object({
  title: z.string().trim().max(80).nullable().optional(),
  archived: z.boolean().optional(),
}).refine((v) => v.title !== undefined || v.archived !== undefined, { message: 'Nothing to change' });
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
