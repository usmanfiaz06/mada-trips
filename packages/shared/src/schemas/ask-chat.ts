import { z } from 'zod';
import { Id, IsoDay } from './common';
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
  /** The trip on screen, so "a hotel" means a hotel there. */
  tripId: Id.nullish(),
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
  z.object({ type: z.literal('request'), requestId: Id, kind: z.string(), title: z.string() }),
]);
export type ChatCard = z.infer<typeof ChatCard>;

/** A price the traveller can pay: the app opens its own pay sheet with this draft (nothing is ever charged from chat). */
export const ChatPay = z.object({ draft: OrderDraft, title: z.string() });
export type ChatPay = z.infer<typeof ChatPay>;

/** The stream, one JSON object per `data:` line, its `event:` the type. */
export const AskChatEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thread'), threadId: Id, lang: z.enum(['en', 'ar']) }),
  /** What is being done right now ("Checking flights to Istanbul"), for the typing line. */
  z.object({ type: z.literal('status'), text: z.string() }),
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
   * What the traveller can do next, as 2 or 3 chips that send their words when tapped (docs/app/ASSISTANT.md: every
   * reply ends with a next step). Mada's own when it wrote them; otherwise the server fills them from the turn.
   */
  z.object({ type: z.literal('next'), choices: z.array(z.string().min(1).max(60)).min(1).max(3) }),
  z.object({ type: z.literal('done'), text: z.string() }),
  /** fallback: the app should answer with its own flows. */
  z.object({ type: z.literal('error'), code: z.string(), fallback: z.boolean() }),
]);
export type AskChatEvent = z.infer<typeof AskChatEvent>;

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
