import { pgTable, text, integer, timestamp, jsonb, index, primaryKey } from "drizzle-orm/pg-core";

/*
 * Resilience (FLOWS.md §12): the idempotency store, supplier health as the circuit breakers last saw it, and the
 * runtime switches behind GET /config (versions, maintenance, features).
 * Migration: drizzle/0017_app_features.sql.
 */

/**
 * One mutation sent with an Idempotency-Key. A repeat with the same key and the same request gets the first answer
 * back instead of running twice (a double tap on Pay, a retry after a dropped connection, the offline outbox).
 * `scope` is the user id, or "ip:<hash>" before sign-in. Rows expire after 24 hours.
 */
export const appIdempotencyKeys = pgTable("app_idempotency_keys", {
  scope: text("scope").notNull(),
  key: text("key").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  /** sha256 of method, path and body: the same key with a different request is refused. */
  requestHash: text("request_hash").notNull(),
  state: text("state").notNull().default("running"), // running | done
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  responseType: text("response_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.scope, t.key] }), index("app_idempotency_expires_idx").on(t.expiresAt)]);

/** The last state each supplier's circuit breaker reported. Written on changes only; read by GET /status. */
export const appSupplierHealth = pgTable("app_supplier_health", {
  name: text("name").primaryKey(),
  state: text("state").notNull(), // up | degraded | down
  since: timestamp("since", { withTimezone: true }).notNull().defaultNow(),
  failures: integer("failures").notNull().default(0),
  lastProblem: text("last_problem"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Runtime switches set from Ops without a deploy. key "config" holds a partial of GET /config over the env defaults. */
export const appRuntime = pgTable("app_runtime", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
