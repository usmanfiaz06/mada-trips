import { sql } from "drizzle-orm";
import { pgTable, uuid, text, bigint, boolean, timestamp, date, jsonb, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { appCircles, appMessages, appUsers } from "./app-schema";

/*
 * Circles (M4): the tables beside app_circles, app_circle_members and app_messages (app-schema.ts), which hold the
 * circle, its members and its chat. CREATE TABLE statements: drizzle/pending/circles.sql, folded into one generated
 * migration at integration. Money in halalas, times as timestamptz, enums as text checked by the shared zod schemas.
 */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const user = (name: string) => uuid(name).notNull().references(() => appUsers.id, { onDelete: "cascade" });

/** What a circle has beyond app_circles: its cover, where it's going, a pinned plan, and whether it is a 1:1 chat. */
export const appCircleDetails = pgTable("app_circle_details", {
  circleId: uuid("circle_id").primaryKey().references(() => appCircles.id, { onDelete: "cascade" }),
  cover: text("cover"), // istanbul | alula | riyadh | null (plain green)
  dest: text("dest"),
  dm: boolean("dm").notNull().default(false),
  // The two people of a 1:1 chat, sorted and joined, so there is only ever one.
  dmKey: text("dm_key"),
  pinnedPlan: text("pinned_plan"),
  pinnedBy: uuid("pinned_by").references(() => appUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("app_circle_details_dm_key").on(t.dmKey).where(sql`${t.dmKey} IS NOT NULL`)]);

/**
 * Invites: to a circle (a person on Mada, or anyone with the link) and to Mada itself (by SMS, WhatsApp or link).
 * A link's code is "<lookup>-<mac>": the lookup is stored, the mac is recomputed from the server pepper, so a code
 * can't be guessed and nothing secret sits in the table. Links last 14 days.
 */
export const appCircleInvites = pgTable("app_circle_invites", {
  id: id(),
  kind: text("kind").notNull(), // circle | mada
  circleId: uuid("circle_id").references(() => appCircles.id, { onDelete: "cascade" }),
  inviterId: user("inviter_id"),
  inviteeUserId: uuid("invitee_user_id").references(() => appUsers.id, { onDelete: "cascade" }),
  // SMS/WhatsApp invites: a keyed hash of the number (to spot it on sign-up) and a masked form to show.
  phoneHash: text("phone_hash"),
  phoneMasked: text("phone_masked"),
  // The number itself, AES-256-GCM encrypted (lib/app/crypto.ts), so a reminder can be sent. Null without APP_DATA_KEY.
  phoneEnc: text("phone_enc"),
  channel: text("channel").notNull(), // app | link | sms | whatsapp
  lookup: text("lookup"),
  status: text("status").notNull().default("pending"), // pending | accepted | declined | cancelled
  acceptedBy: uuid("accepted_by").references(() => appUsers.id, { onDelete: "set null" }),
  remindedAt: timestamp("reminded_at", { withTimezone: true }),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("app_circle_invites_lookup_key").on(t.lookup).where(sql`${t.lookup} IS NOT NULL`),
  index("app_circle_invites_circle_idx").on(t.circleId, t.status),
  index("app_circle_invites_invitee_idx").on(t.inviteeUserId, t.status),
  index("app_circle_invites_inviter_idx").on(t.inviterId, t.createdAt),
]);

/** One vote per person per vote message. */
export const appCircleVotes = pgTable("app_circle_votes", {
  messageId: uuid("message_id").notNull().references(() => appMessages.id, { onDelete: "cascade" }),
  userId: user("user_id"),
  optionId: text("option_id").notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.messageId, t.userId] })]);

/** The shares of a split, in halalas. A record only: Mada holds no money for the group. */
export const appCircleSplitShares = pgTable("app_circle_split_shares", {
  messageId: uuid("message_id").notNull().references(() => appMessages.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  userIds: uuid("user_ids").array().notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paidVia: text("paid_via"), // bill | cash | card
  markedBy: uuid("marked_by").references(() => appUsers.id, { onDelete: "set null" }),
  paymentId: uuid("payment_id"),
}, (t) => [primaryKey({ columns: [t.messageId, t.key] })]);

/** Friends are mutual: one row per pair, asked by one and accepted by the other. Each side can tag the other. */
export const appFriendships = pgTable("app_friendships", {
  id: id(),
  requesterId: user("requester_id"),
  addresseeId: user("addressee_id"),
  status: text("status").notNull().default("pending"), // pending | accepted
  requesterTag: text("requester_tag"), // how the requester files the addressee: close | family
  addresseeTag: text("addressee_tag"),
  createdAt: createdAt(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("app_friendships_pair_key").on(sql`least(${t.requesterId}, ${t.addresseeId})`, sql`greatest(${t.requesterId}, ${t.addresseeId})`),
  index("app_friendships_addressee_idx").on(t.addresseeId, t.status),
  index("app_friendships_requester_idx").on(t.requesterId, t.status),
]);

export const appFollows = pgTable("app_follows", {
  followerId: user("follower_id"),
  followeeId: user("followee_id"),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.followerId, t.followeeId] }), index("app_follows_followee_idx").on(t.followeeId)]);

export const appBlocks = pgTable("app_blocks", {
  blockerId: user("blocker_id"),
  blockedId: user("blocked_id"),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index("app_blocks_blocked_idx").on(t.blockedId)]);

/** Tips. Every tip is checked before it shows (lib/app/circles/moderation.ts). */
export const appPosts = pgTable("app_posts", {
  id: id(),
  authorId: user("author_id"),
  city: text("city").notNull(),
  place: text("place").notNull(),
  body: text("body").notNull(),
  kind: text("kind").notNull(), // food | todo
  audience: text("audience").notNull(), // friends | everyone
  photoKey: text("photo_key"),
  hasPhoto: boolean("has_photo").notNull().default(false),
  photoConsent: boolean("photo_consent").notNull().default(false),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  // Mock moderation approves a clean tip once this time has passed.
  autoApproveAt: timestamp("auto_approve_at", { withTimezone: true }),
  flagged: text("flagged"), // why the automatic check held it for a person
  moderatedAt: timestamp("moderated_at", { withTimezone: true }),
  moderatedBy: text("moderated_by"),
  moderationNote: text("moderation_note"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("app_posts_city_idx").on(t.city, t.status, t.createdAt), index("app_posts_author_idx").on(t.authorId, t.createdAt), index("app_posts_status_idx").on(t.status, t.createdAt)]);

/** A tip's photo, kept apart so lists stay light. Base64 of a JPEG/PNG/WebP, at most about 2 MB. */
export const appPostPhotos = pgTable("app_post_photos", {
  postId: uuid("post_id").primaryKey().references(() => appPosts.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  data: text("data").notNull(),
});

export const appPostThanks = pgTable("app_post_thanks", {
  postId: uuid("post_id").notNull().references(() => appPosts.id, { onDelete: "cascade" }),
  userId: user("user_id"),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.postId, t.userId] })]);

/** Saves keep a copy of the tip, so a save stays even if the post goes. */
export const appSaved = pgTable("app_saved", {
  id: id(),
  userId: user("user_id"),
  kind: text("kind").notNull(), // post | plan
  refId: text("ref_id").notNull(),
  city: text("city").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("app_saved_key").on(t.userId, t.kind, t.refId), index("app_saved_ref_idx").on(t.kind, t.refId)]);

/** Reports go to a person on the desk within 24 hours. */
export const appReports = pgTable("app_reports", {
  id: id(),
  reporterId: user("reporter_id"),
  targetKind: text("target_kind").notNull(), // user | post | circle | message
  targetId: uuid("target_id").notNull(),
  targetUserId: uuid("target_user_id").references(() => appUsers.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  note: text("note"),
  status: text("status").notNull().default("open"), // open | actioned | dismissed
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("app_reports_status_idx").on(t.status, t.createdAt)]);

/** Who's around: city only, never a place; off by default; ends by itself when the trip ends. */
export const appPresence = pgTable("app_presence", {
  userId: uuid("user_id").primaryKey().references(() => appUsers.id, { onDelete: "cascade" }),
  city: text("city").notNull(),
  fromDate: date("from_date"),
  toDate: date("to_date"),
  audience: text("audience").notNull(), // picked | close | family
  audienceIds: uuid("audience_ids").array().notNull().default(sql`'{}'::uuid[]`),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** What you did about someone shown in Who's around: hid them, said hello, or not now. They aren't told. */
export const appPresenceMarks = pgTable("app_presence_marks", {
  userId: user("user_id"),
  otherId: user("other_id"),
  mark: text("mark").notNull(), // hidden | hello | no
  city: text("city"),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.otherId] })]);
