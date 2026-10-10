import "server-only";
import { AskIntent, AskKind, DESTINATIONS, HomeAirport, isIsoDay, parseAskRules, type Person } from "@mada/shared";
import { bookingSuppliers, householdOf, today } from "./common";

/*
 * POST /ask/parse. Mock mode: the deterministic parser (the prototype's rules, moved to the server). Live mode: Claude
 * through one strict tool, then every field is checked here (real destination keys, real days not in the past, people
 * from this household only). If the model is down or declines, the rules answer. Nothing here carries a price.
 */

export async function parseAsk(ownerId: string, text: string): Promise<AskIntent> {
  const people = await householdOf(ownerId);
  const day = today();
  const rules = parseAskRules(text, { today: day, people });
  const fromRules: AskIntent = {
    kind: rules.kind, destination: rules.destination, destinationName: rules.destinationName, from: rules.from, depart: rules.depart, return: rules.return,
    tripType: rules.tripType, monthOnly: rules.monthOnly, cabin: rules.cabin, cabinNote: rules.cabinNote, travellerIds: rules.ids, travellerCount: rules.count,
    infants: rules.infants, needs: rules.needs, needsMentioned: rules.needsMentioned, answers: rules.answers, ask: rules.ask, source: "rules",
  };
  let model: Awaited<ReturnType<ReturnType<typeof bookingSuppliers.ask>["parse"]>> = null;
  try {
    model = await bookingSuppliers.ask().parse(text, { today: day, people, destinations: Object.keys(DESTINATIONS) });
  } catch (e) {
    console.warn("[ask] the model didn't answer; using the rules", e instanceof Error ? e.message : "");
  }
  if (!model) return AskIntent.parse(fromRules);
  return AskIntent.parse(mergeModel(fromRules, model, people, day));
}

/** Keep what the model said only where it is a real value; the rules fill the rest (needs and form answers always). */
export function mergeModel(rules: AskIntent, m: NonNullable<Awaited<ReturnType<ReturnType<typeof bookingSuppliers.ask>["parse"]>>>, people: Person[], day: string): AskIntent {
  const kind = AskKind.safeParse(m.kind);
  const dest = m.destination && (m.destination === "other" || DESTINATIONS[m.destination]) ? m.destination : null;
  const futureDay = (d: string | null) => (d && isIsoDay(d) && d >= day ? d : null);
  const depart = futureDay(m.depart);
  const ret = futureDay(m.return);
  const ids = m.travellerIds?.filter((id) => people.some((p) => p.id === id)) ?? null;
  const from = HomeAirport.safeParse(m.from);
  const cabin = m.cabin === "economy" || m.cabin === "premium" || m.cabin === "business" ? m.cabin : null;
  return {
    ...rules,
    kind: kind.success ? kind.data : rules.kind,
    destination: dest ?? rules.destination,
    destinationName: dest === "other" ? (m.destinationName?.slice(0, 60) ?? rules.destinationName) : dest ? null : rules.destinationName,
    from: from.success ? from.data : rules.from,
    depart: depart ?? rules.depart,
    return: ret && (!depart || ret > depart) ? ret : rules.return,
    tripType: m.tripType === "oneway" || m.tripType === "return" ? m.tripType : rules.tripType,
    monthOnly: m.monthOnly && m.monthOnly.month >= 1 && m.monthOnly.month <= 12 ? { month: m.monthOnly.month, year: m.monthOnly.year, label: m.monthOnly.label?.slice(0, 40) ?? null } : rules.monthOnly,
    cabin: cabin ?? rules.cabin,
    travellerIds: ids && ids.length ? ids : rules.travellerIds,
    travellerCount: m.travellerCount && m.travellerCount > 0 && m.travellerCount < 10 ? m.travellerCount : rules.travellerCount,
    infants: Number.isInteger(m.infants) && m.infants >= 0 && m.infants <= 4 ? m.infants : rules.infants,
    ask: m.ask === "where" || m.ask === "when" || m.ask === "return" || m.ask === "who" ? m.ask : rules.ask,
    source: "model",
  };
}
