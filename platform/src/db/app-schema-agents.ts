import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { users as opsUsers } from "./schema";
import { appAgents } from "./app-schema-desk";

/*
 * Agents over time (DESK-PLAN.md §4.6, U7): every presence change from the header switch is an interval here, so the
 * desk can show time logs (online, away, signed off per agent per day) against the rota. The open interval has no
 * ended_at; setAgentStatus closes it and opens the next in the same transaction.
 *
 * Migration: drizzle/0038_desk_agents.sql.
 */

export const appAgentPresenceLog = pgTable("app_agent_presence_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => appAgents.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // online | away | offline
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  // Who flipped it: the agent themselves, a lead signing them off, or null for the desk (a deactivation).
  setBy: uuid("set_by").references(() => opsUsers.id, { onDelete: "set null" }),
}, (t) => [index("app_agent_presence_log_agent_idx").on(t.agentId, t.startedAt)]);
