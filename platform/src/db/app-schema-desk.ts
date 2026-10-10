import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, bigint, boolean, timestamp, jsonb, index, uniqueIndex, primaryKey, check } from "drizzle-orm/pg-core";
import { users as opsUsers } from "./schema";
import { appUsers } from "./app-schema";

/*
 * The agent desk inside Mada Ops: the people travellers talk to, their shifts and who covers whom, which agent
 * looks after which traveller, and the desk's own working state (reassignments, escalations, internal notes,
 * canned replies, typing, moderation, blocks, disruption plans). Everything else the desk shows lives in the
 * app_ tables it reads (requests, quotes, payments, refunds, messages, trips).
 *
 * Migration: drizzle/0017_app_features.sql.
 */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** A person on the desk, as travellers see them. One per Ops login. */
export const appAgents = pgTable("app_agents", {
  id: id(),
  opsUserId: uuid("ops_user_id").notNull().references(() => opsUsers.id, { onDelete: "cascade" }),
  // First name only, the way the app shows people (COPY.md §4): "Faisal".
  displayName: text("display_name").notNull(),
  displayNameAr: text("display_name_ar"),
  photoUrl: text("photo_url"),
  languages: text("languages").array().notNull().default(sql`'{en,ar}'::text[]`),
  pronoun: text("pronoun").notNull().default("he"), // he | she, for "She has your whole trip."
  // online | away | offline. Set by the agent; offline is also what an off-shift agent reads as.
  status: text("status").notNull().default("offline"),
  statusAt: timestamp("status_at", { withTimezone: true }).notNull().defaultNow(),
  // What the app promises when there are too few replies to measure.
  replyMinutes: integer("reply_minutes").notNull().default(2),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("app_agents_ops_user_key").on(t.opsUserId)]);

/** A shift on the rota. covering_for names the agent whose travellers this shift looks after ("Noura covers Faisal tonight"). */
export const appAgentShifts = pgTable("app_agent_shifts", {
  id: id(),
  agentId: uuid("agent_id").notNull().references(() => appAgents.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  coveringForId: uuid("covering_for_id").references(() => appAgents.id, { onDelete: "set null" }),
  note: text("note"),
  createdBy: uuid("created_by").references(() => opsUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [check("app_agent_shifts_order", sql`${t.endsAt} > ${t.startsAt}`), index("app_agent_shifts_time_idx").on(t.startsAt, t.endsAt), index("app_agent_shifts_agent_idx").on(t.agentId, t.startsAt)]);

/** Each traveller account has one primary agent ("Faisal, your Mada agent"). */
export const appAgentAssignments = pgTable("app_agent_assignments", {
  userId: uuid("user_id").primaryKey().references(() => appUsers.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => appAgents.id, { onDelete: "cascade" }),
  assignedBy: uuid("assigned_by").references(() => opsUsers.id, { onDelete: "set null" }),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("app_agent_assignments_agent_idx").on(t.agentId)]);

/**
 * The desk's state for one piece of work (an order, a chat, a refund…), keyed by what it is. Routing is worked out
 * live from the rota; a row here only records what a person decided: a reassignment, an escalation, done/snoozed.
 */
export const appDeskItems = pgTable("app_desk_items", {
  itemKind: text("item_kind").notNull(), // order | ticketing | chat | request | refund | disruption | moderation
  itemId: text("item_id").notNull(),
  assignedAgentId: uuid("assigned_agent_id").references(() => appAgents.id, { onDelete: "set null" }),
  assignedBy: uuid("assigned_by").references(() => opsUsers.id, { onDelete: "set null" }),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  escalatedBy: uuid("escalated_by").references(() => opsUsers.id, { onDelete: "set null" }),
  escalationNote: text("escalation_note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.itemKind, t.itemId] }), index("app_desk_items_agent_idx").on(t.assignedAgentId)]);

/** Notes for the team on a thread. Never shown to the traveller. */
export const appDeskNotes = pgTable("app_desk_notes", {
  id: id(),
  threadKind: text("thread_kind").notNull(), // request | support
  threadId: uuid("thread_id").notNull(),
  opsUserId: uuid("ops_user_id").notNull().references(() => opsUsers.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: createdAt(),
}, (t) => [index("app_desk_notes_thread_idx").on(t.threadKind, t.threadId, t.createdAt)]);

/** Replies the team uses often, in both languages. */
export const appDeskCanned = pgTable("app_desk_canned", {
  id: id(),
  title: text("title").notNull(),
  bodyEn: text("body_en").notNull(),
  bodyAr: text("body_ar").notNull(),
  sort: integer("sort").notNull().default(0),
  createdBy: uuid("created_by").references(() => opsUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

/** "Faisal is typing…": one row per agent, refreshed while they type, read by the app's presence endpoint. */
export const appDeskTyping = pgTable("app_desk_typing", {
  agentId: uuid("agent_id").primaryKey().references(() => appAgents.id, { onDelete: "cascade" }),
  threadKind: text("thread_kind").notNull(),
  threadId: uuid("thread_id").notNull(),
  until: timestamp("until", { withTimezone: true }).notNull(),
}, (t) => [index("app_desk_typing_thread_idx").on(t.threadKind, t.threadId)]);

/**
 * The moderation queue: tips waiting for review and reports from travellers. Circles pushes rows here (a copy of
 * what was posted, so the decision stands even if the post changes); the desk decides.
 */
export const appDeskModeration = pgTable("app_desk_moderation", {
  id: id(),
  kind: text("kind").notNull(), // tip | report
  targetKind: text("target_kind").notNull(), // post | user | circle | message
  targetId: text("target_id").notNull(),
  authorUserId: uuid("author_user_id").references(() => appUsers.id, { onDelete: "set null" }),
  reporterUserId: uuid("reporter_user_id").references(() => appUsers.id, { onDelete: "set null" }),
  reason: text("reason"), // unwanted | impostor | unsafe | other (reports)
  note: text("note"),
  snapshot: jsonb("snapshot").$type<{ city?: string; place?: string; text?: string; photoUrl?: string | null; name?: string }>().notNull().default({}),
  status: text("status").notNull().default("open"), // open | approved | rejected | removed | dismissed
  decidedBy: uuid("decided_by").references(() => opsUsers.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),
  createdAt: createdAt(),
}, (t) => [index("app_desk_moderation_status_idx").on(t.status, t.createdAt)]);

/** Accounts the desk has blocked from posting and messaging. Lifting a block keeps the row. */
export const appDeskBlocks = pgTable("app_desk_blocks", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  blockedBy: uuid("blocked_by").references(() => opsUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  liftedAt: timestamp("lifted_at", { withTimezone: true }),
  liftedBy: uuid("lifted_by").references(() => opsUsers.id, { onDelete: "set null" }),
}, (t) => [
  index("app_desk_blocks_user_idx").on(t.userId),
  uniqueIndex("app_desk_blocks_one_active").on(t.userId).where(sql`${t.liftedAt} IS NULL`),
]);

/** A rebooking plan the desk pushed to the travellers on a disrupted flight, and any voucher that went with it. */
export const appDeskDisruptions = pgTable("app_desk_disruptions", {
  id: id(),
  flightNumber: text("flight_number").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD, the flight's local departure day
  status: text("status").notNull(), // the status the plan answered: delayed | cancelled | diverted
  plan: text("plan").notNull(), // what the travellers read
  options: jsonb("options").$type<{ label: string; detail: string }[]>().notNull().default([]),
  voucherAmount: bigint("voucher_amount", { mode: "number" }).notNull().default(0), // halalas per account, as Mada credit
  userIds: uuid("user_ids").array().notNull().default(sql`'{}'::uuid[]`),
  pushedBy: uuid("pushed_by").references(() => opsUsers.id, { onDelete: "set null" }),
  agentName: text("agent_name"),
  createdAt: createdAt(),
}, (t) => [index("app_desk_disruptions_flight_idx").on(t.flightNumber, t.date)]);
