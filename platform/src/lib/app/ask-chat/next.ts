import { t, type ChatCard } from "@mada/shared";
import { outgoingProblems, unbacked } from "./guard";

/*
 * Every reply ends with a next step (docs/app/ASSISTANT.md §1 "Always resolve"). The model writes it as one line,
 * `<next>A | B | C</next>`, which the sentence gate keeps off the screen and hands here. Each choice is held to the
 * same checks as the words (no unbacked price or time, no banned word). When fewer than 2 survive, or the model wrote
 * none, the choices come from the turn itself, so the conversation never ends open-ended. Pure.
 */

export const NEXT_OPEN = "<next>";
export const NEXT_CLOSE = "</next>";
const MAX = 3;
const LEN = 60;

/** The choices in a `<next>` line, each kept only if it passes the checks. */
export function parseNext(line: string, toolText: string): string[] {
  const body = line.replace(NEXT_OPEN, "").replace(NEXT_CLOSE, "").replace(/<\/?n?e?x?t?>?$/, "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of body.split(/\s*[|·•]\s*|\n/)) {
    const c = raw.replace(/^[\s\-–*"«]+|[\s"».]+$/g, "").trim();
    if (!c || c.length > LEN || seen.has(c.toLowerCase())) continue;
    if (unbacked(c, toolText).length || outgoingProblems(c).length) continue;
    seen.add(c.toLowerCase());
    out.push(c);
    if (out.length === MAX) break;
  }
  return out;
}

export type TurnState = {
  cards: ChatCard[];
  pay: boolean;
  handoff: boolean;
  lang: "en" | "ar";
};

const fits = (s: string) => s.length <= LEN;

/** 2 or 3 choices from what the turn did: the cards it showed, the pay sheet, the desk, or what Mada does most. */
export function nextFromState(s: TurnState): string[] {
  const say = (key: Parameters<typeof t>[0], v?: Parameters<typeof t>[1]) => t(key, v, s.lang);
  const last = s.cards.at(-1);
  let out: string[];
  if (s.handoff) out = [say("chat.next.openChat"), say("chat.next.myTrips")];
  else if (s.pay) out = [say("chat.next.pay"), say("chat.next.otherOptions")];
  else if (!last) out = [say("chat.next.flights"), say("chat.next.stays"), say("chat.next.esim")];
  else {
    switch (last.type) {
      case "flights": {
        const f = last.options[0];
        const book = f ? say("chat.next.bookFlight", { airline: f.airline, time: f.out.dep }) : say("chat.next.bookFirst");
        out = [fits(book) ? book : say("chat.next.bookFirst"), say("chat.next.staysIn", { city: last.search.destinationName }), say("chat.next.otherDates")];
        break;
      }
      case "stays": {
        const h = last.options[0];
        const book = h ? say("chat.next.bookStay", { hotel: h.name }) : say("chat.next.bookFirst");
        out = [fits(book) && book.length <= 32 ? book : say("chat.next.bookFirst"), say("chat.next.flightsTo", { city: last.search.destinationName }), say("chat.next.otherDates")];
        break;
      }
      case "esim": {
        const p = last.plans[0];
        out = [p?.gb ? say("chat.next.esimGb", { gb: p.gb }) : say("chat.next.bookFirst"), say("chat.next.moreData")];
        break;
      }
      case "entry":
        out = [say("chat.next.arrange"), say("chat.next.flightsTo", { city: last.entry.countryName })];
        break;
      case "car":
        out = [say("chat.next.carPickup"), say("chat.next.carLater"), say("chat.next.carWhere")];
        break;
      case "trips":
        out = [say("chat.next.nextTrip"), say("chat.next.tripHotel"), say("chat.next.tripEsim")];
        break;
      case "request":
        out = [say("chat.next.request"), say("chat.next.team")];
        break;
      default:
        out = [say("chat.next.flights"), say("chat.next.stays"), say("chat.next.esim")];
    }
  }
  return [...new Set(out.filter((x) => x && fits(x)))].slice(0, MAX);
}

/** The model's choices when it gave at least 2 good ones; otherwise the turn's. */
export function resolveNext(model: string[], s: TurnState): { choices: string[]; from: "model" | "app" } {
  return model.length >= 2 ? { choices: model.slice(0, MAX), from: "model" } : { choices: nextFromState(s), from: "app" };
}
