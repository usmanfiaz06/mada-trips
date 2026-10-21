/**
 * Demo data for Support admin (DESK-PLAN.md U7), on top of the desk seed (src/lib/app/desk/seed.ts):
 *   npx tsx --conditions=react-server src/lib/app/desk/seed-agents.ts
 * A week of presence (online, away, signed off) for each agent, a weekly rota, two weeks of resolved tickets with
 * first replies, some late, some reopened and some rated. Runs once: it stops if the presence
 * log already has history. Local databases only.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { asc, eq } from "drizzle-orm";
import * as app from "../../../db/app-schema";
import * as desk from "../../../db/app-schema-desk";
import * as agents from "../../../db/app-schema-agents";

const url = process.env.DATABASE_URL ?? "postgres://mada:mada@localhost:5432/mada_ops";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && process.env.ALLOW_DESK_SEED !== "yes") throw new Error("The agents demo seed only runs against a local database");
const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const db = drizzle(client);

const MIN = 60_000, H = 3600_000, DAY = 86400_000;
const NOW = Date.now();
// Riyadh midnight today (UTC+3).
const today = Math.floor((NOW + 3 * H) / DAY) * DAY - 3 * H;
// A fixed pseudo-random sequence, so every run of the seed looks the same.
let s = 7;
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

async function main() {
  const list = await db.select().from(desk.appAgents).orderBy(asc(desk.appAgents.displayName));
  if (list.length < 3) throw new Error("Run the desk demo seed first (src/lib/app/desk/seed.ts)");
  const history = await db.select({ id: agents.appAgentPresenceLog.id }).from(agents.appAgentPresenceLog).where(eq(agents.appAgentPresenceLog.status, "away")).limit(1);
  if (history.length) { console.log("Agents demo data already there. Nothing to do."); return; }
  // The rota: Faisal mornings, Noura afternoons, Omar nights, weekly for this week and the last, Sunday to Thursday.
  const sunday = today - new Date(today + 3 * H).getUTCDay() * DAY;
  const plan: Record<string, [number, number]> = { Faisal: [9, 17], Noura: [14, 22], Omar: [22, 30] };
  const users2 = list.filter((a) => plan[a.displayName]);
  for (const a of users2) {
    const [from, to] = plan[a.displayName]!;
    const series = crypto.randomUUID();
    await db.delete(desk.appAgentShifts).where(eq(desk.appAgentShifts.agentId, a.id));
    const rows = [];
    for (let w = -1; w <= 1; w++) for (let d = 0; d < 5; d++) {
      const start = sunday + w * 7 * DAY + d * DAY + from * H;
      rows.push({ agentId: a.id, startsAt: new Date(start), endsAt: new Date(sunday + w * 7 * DAY + d * DAY + to * H), seriesId: series, repeat: "weekly" });
    }
    await db.insert(desk.appAgentShifts).values(rows);

    // Presence for the last 7 days that were rostered: on 0–25 minutes late, a short break, off at the end.
    await db.delete(agents.appAgentPresenceLog).where(eq(agents.appAgentPresenceLog.agentId, a.id));
    const log: (typeof agents.appAgentPresenceLog.$inferInsert)[] = [];
    let last = new Date(today - 8 * DAY);
    log.push({ agentId: a.id, status: "offline", startedAt: last });
    for (const r of rows) {
      if (r.startsAt.getTime() > NOW || r.startsAt.getTime() < today - 7 * DAY) continue;
      const on = new Date(r.startsAt.getTime() + Math.round(rnd() * 25) * MIN);
      const brk = new Date(on.getTime() + (3 + rnd() * 2) * H);
      const back = new Date(brk.getTime() + (15 + Math.round(rnd() * 30)) * MIN);
      const off = new Date(Math.min(r.endsAt.getTime() + Math.round(rnd() * 10) * MIN, NOW));
      for (const [status, at] of [["online", on], ["away", brk], ["online", back], ["offline", off]] as const) {
        if (at.getTime() > NOW) break;
        log[log.length - 1]!.endedAt = at;
        log.push({ agentId: a.id, status, startedAt: at });
        last = at;
      }
    }
    await db.insert(agents.appAgentPresenceLog).values(log);
    const cur = log[log.length - 1]!;
    await db.update(desk.appAgents).set({ status: cur.status, statusAt: cur.startedAt }).where(eq(desk.appAgents.id, a.id));
  }

  // Two weeks of tickets the agents resolved: replies in a few minutes (now and then late), some rated.
  const people = await db.select().from(app.appUsers).orderBy(asc(app.appUsers.createdAt)).limit(8);
  const subjects = ["Seat change on SV263", "Bag didn't arrive in Istanbul", "Refund for the cancelled hotel night", "Visa appointment date", "eSIM not connecting", "Add a traveller to the trip", "Receipt for my company", "Pick-up time at the airport"];
  const tickets: (typeof desk.deskTickets.$inferInsert)[] = [];
  for (let d = 13; d >= 0; d--) {
    const n = 2 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const a = users2[Math.floor(rnd() * users2.length)]!;
      const [from] = plan[a.displayName]!;
      const opened = today - d * DAY + (from + rnd() * 7) * H;
      if (opened > NOW - 30 * MIN) continue;
      const sla = 10;
      const late = rnd() < 0.15;
      const fr = opened + (late ? 12 + rnd() * 30 : 1 + rnd() * 8) * MIN;
      const resolved = fr + (10 + rnd() * 200) * MIN;
      const done = resolved < NOW;
      const rated = done && rnd() < 0.55;
      tickets.push({
        kind: rnd() < 0.6 ? "chat" : "manual", subject: subjects[Math.floor(rnd() * subjects.length)]!, customerId: people[Math.floor(rnd() * people.length)]?.id ?? null,
        status: done ? (rated ? "closed" : "resolved") : "open", priority: rnd() < 0.1 ? "high" : "normal", ownerAgentId: a.id, ownerReason: "primary",
        openedAt: new Date(opened), firstResponseAt: new Date(fr), slaStartedAt: new Date(opened), slaMinutes: sla, dueAt: new Date(opened + sla * MIN),
        escalationLevel: late ? 1 : 0, escalatedAt: late ? new Date(opened + sla * MIN) : null, resolvedAt: done ? new Date(resolved) : null, closedAt: rated ? new Date(resolved + 2 * H) : null,
        reopenedCount: rnd() < 0.08 ? 1 : 0, csat: rated ? (rnd() < 0.7 ? 5 : rnd() < 0.6 ? 4 : 3) : null, csatAt: rated ? new Date(resolved + 2 * H) : null,
        lastActivityAt: new Date(done ? resolved : fr), createdAt: new Date(opened),
      });
    }
  }
  if (tickets.length) await db.insert(desk.deskTickets).values(tickets);
  console.log(`Agents demo data loaded: a weekly rota for ${users2.length} agents, 7 days of presence, ${tickets.length} tickets over two weeks.`);
}

main().then(() => client.end()).catch(async (err) => { console.error(err); await client.end(); process.exit(1); });
