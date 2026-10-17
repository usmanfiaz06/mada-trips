import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { appPeople, appSegments, appTrips, appUsers } from "./app-schema";
import { appFiles } from "./app-schema-wallet";

/*
 * The airline's boarding passes, the lock-screen flight (ActivityKit push tokens) and Apple Wallet registrations
 * (docs/app/NATIVE.md). A boarding pass row only ever holds what an airline's barcode said: it is read from the
 * traveller's or the desk's file (lib/app/boarding), never made up from the booking.
 */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** One traveller's pass for one flight. A newer pass for the same person and flight replaces the old one. */
export const appBoardingPasses = pgTable("app_boarding_passes", {
  id: id(),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  tripId: uuid("trip_id").notNull().references(() => appTrips.id, { onDelete: "cascade" }),
  segmentId: uuid("segment_id").notNull().references(() => appSegments.id, { onDelete: "cascade" }),
  // Null when the printed name matched nobody on the trip: the desk sees it and sorts it out.
  personId: uuid("person_id").references(() => appPeople.id, { onDelete: "set null" }),
  passengerName: text("passenger_name").notNull(),
  format: text("format").notNull(), // pdf417 | aztec | qr
  message: text("message").notNull(),
  pnr: text("pnr").notNull(),
  seat: text("seat").notNull(),
  sequence: text("sequence").notNull(),
  compartment: text("compartment").notNull(),
  source: text("source").notNull(), // traveller | desk
  addedBy: text("added_by"), // the desk agent's name when the desk added it
  fileId: uuid("file_id").references(() => appFiles.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("app_boarding_passes_trip_idx").on(t.tripId),
  uniqueIndex("app_boarding_passes_leg_key").on(t.segmentId, t.passengerName),
]);

/** A Live Activity (iPhone lock screen and Dynamic Island) or the Android ongoing notification, for one flight. */
export const appLiveActivities = pgTable("app_live_activities", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  tripId: uuid("trip_id").notNull().references(() => appTrips.id, { onDelete: "cascade" }),
  segmentId: uuid("segment_id").notNull().references(() => appSegments.id, { onDelete: "cascade" }),
  activityId: text("activity_id").notNull(),
  platform: text("platform").notNull(), // ios | android
  pushToken: text("push_token"),
  locale: text("locale").notNull().default("en"),
  lastState: jsonb("last_state").$type<Record<string, unknown>>(),
  lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
  lastError: text("last_error"),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("app_live_activities_activity_key").on(t.userId, t.activityId),
  index("app_live_activities_segment_idx").on(t.segmentId),
]);

/**
 * Apple Wallet's web service: each device that added one of our passes registers here so it can be told to fetch
 * the pass again when the gate or the time changes. `serial` is "bp-<boarding pass id>" or "stay-<stay id>".
 */
export const appWalletRegistrations = pgTable("app_wallet_registrations", {
  id: id(),
  deviceId: text("device_id").notNull(),
  pushToken: text("push_token").notNull(),
  passTypeId: text("pass_type_id").notNull(),
  serial: text("serial").notNull(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("app_wallet_registrations_key").on(t.deviceId, t.passTypeId, t.serial),
  index("app_wallet_registrations_serial_idx").on(t.serial),
]);

/** When each Wallet pass last changed, for "passesUpdatedSince" and Last-Modified. */
export const appWalletPassVersions = pgTable("app_wallet_pass_versions", {
  serial: text("serial").primaryKey(),
  passTypeId: text("pass_type_id").notNull(),
  // What the pass showed last time (gate, times), so only a real change pushes an update.
  fingerprint: text("fingerprint").notNull(),
  updatedAt: updatedAt(),
});
