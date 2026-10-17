import "server-only";
import { AskIntent, AskKind, DESTINATIONS, HomeAirport, askIntentOfRules, carNowAsk, isIsoDay, parseAskRules, type Person } from "@mada/shared";
import { bookingSuppliers, householdOf, today } from "./common";

/*
 * POST /ask/parse. Mock mode: the deterministic parser (the prototype's rules, moved to the server). Live mode: Claude
 * through one strict tool, then every field is checked here (real destination keys, real days not in the past, people
 * from this household only). If the model is down or declines, the rules answer. Nothing here carries a price.
 */

export async function parseAsk(ownerId: string | null, text: string): Promise<AskIntent> {
  // A guest has no household: names aren't matched, "me and my wife" is still two.
  const people = ownerId ? await householdOf(ownerId) : [];
  const day = today();
  const rules = parseAskRules(text, { today: day, people });
  const fromRules: AskIntent = askIntentOfRules(rules);
  let model: Awaited<ReturnType<ReturnType<typeof bookingSuppliers.ask>["parse"]>> = null;
  try {
    model = await bookingSuppliers.ask().parse(text, { today: day, people, destinations: Object.keys(DESTINATIONS) });
  } catch (e) {
    console.warn("[ask] the model didn't answer; using the rules", e instanceof Error ? e.message : "");
  }
  if (!model) return AskIntent.parse(fromRules);
  const merged = mergeModel(fromRules, model, people, day);
  // "A taxi now in Abha" is a car right now, whatever the model made of the place.
  if (rules.kind === "car" && carNowAsk("car", text)) merged.kind = "car";
  return AskIntent.parse(merged);
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
    // Counts and ages that don't map to the household stay unmapped, whatever the model picked: the app asks.
    travellerIds: rules.party && !rules.travellerIds ? null : ids && ids.length ? ids : rules.travellerIds,
    travellerCount: rules.party ? rules.travellerCount : m.travellerCount && m.travellerCount > 0 && m.travellerCount < 10 ? m.travellerCount : rules.travellerCount,
    infants: rules.party ? rules.infants : Number.isInteger(m.infants) && m.infants >= 0 && m.infants <= 4 ? m.infants : rules.infants,
    ask: rules.party && !rules.travellerIds && (m.ask === "who" || !m.ask) ? rules.ask : m.ask === "where" || m.ask === "when" || m.ask === "return" || m.ask === "who" ? m.ask : rules.ask,
    source: "model",
  };
}
