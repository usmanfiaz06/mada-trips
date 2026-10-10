/*
 * Who looks after a traveller right now. Pure, so the inbox, the presence endpoint and the tests agree:
 *   1. their primary agent, when that agent is on shift and not signed off;
 *   2. otherwise whoever is on shift covering for the primary agent ("Noura is covering for Faisal tonight");
 *   3. otherwise the shared queue: the first free hand on shift takes it.
 * A person's own decision (a reassignment on the desk) always wins over the rota.
 */

export type RotaAgent = { id: string; status: string; active: boolean };
export type RotaShift = { agentId: string; startsAt: Date; endsAt: Date; coveringForId: string | null };
export type Route = { agentId: string | null; reason: "manual" | "primary" | "covering" | "queue"; usualId: string | null };

export const onShift = (agentId: string, shifts: RotaShift[], now: Date) =>
  shifts.some((s) => s.agentId === agentId && s.startsAt <= now && now < s.endsAt);

/** On shift, switched on, and not signed off ("away" still counts: they are on shift, back in a few minutes). */
export function available(a: RotaAgent | undefined, shifts: RotaShift[], now: Date) {
  return !!a && a.active && a.status !== "offline" && onShift(a.id, shifts, now);
}

/** The agent covering for `agentId` now, if any (the most recently started shift wins). */
export function coveringFor(agentId: string, agents: RotaAgent[], shifts: RotaShift[], now: Date): string | null {
  const live = shifts
    .filter((s) => s.coveringForId === agentId && s.startsAt <= now && now < s.endsAt)
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  for (const s of live) if (available(agents.find((a) => a.id === s.agentId), shifts, now)) return s.agentId;
  return null;
}

export function routeFor(primaryId: string | null, agents: RotaAgent[], shifts: RotaShift[], now: Date = new Date(), manualId?: string | null): Route {
  if (manualId) return { agentId: manualId, reason: "manual", usualId: primaryId };
  if (!primaryId) return { agentId: null, reason: "queue", usualId: null };
  if (available(agents.find((a) => a.id === primaryId), shifts, now)) return { agentId: primaryId, reason: "primary", usualId: primaryId };
  const cover = coveringFor(primaryId, agents, shifts, now);
  if (cover) return { agentId: cover, reason: "covering", usualId: primaryId };
  return { agentId: null, reason: "queue", usualId: primaryId };
}
