import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { sslFor } from "./ssl";

const url = process.env.DATABASE_URL ?? "postgres://mada:mada@localhost:5432/mada_ops";

// Reuse one pool across hot reloads in dev, and across warm serverless invocations in prod.
const g = globalThis as unknown as { __madaSql?: ReturnType<typeof postgres> };
// On a serverless host each warm instance keeps its own pool. `max` must be large enough for one request's
// own concurrent queries — the dashboard, for example, runs two transactions plus several reads at once, so
// max:1 makes them queue behind a single connection forever (a request-level deadlock that no statement
// timeout catches, because the queue wait happens before a statement starts). A small pool per instance is
// both safe for the database's connection limit and enough to serve each request without self-starving.
// prepare:false is required by the pooler. idle_timeout frees idle connections; connect_timeout fails fast
// instead of hanging a page. statement_timeout/idle_in_transaction_session_timeout cap how long a query — or a
// half-finished transaction whose function got killed — can hold a lock, so a single stuck write can't jam
// the whole database.
export const sql = g.__madaSql ?? postgres(url, {
  max: 8, prepare: false, idle_timeout: 20, connect_timeout: 10,
  connection: { statement_timeout: 8_000, idle_in_transaction_session_timeout: 10_000 },
  ssl: sslFor(url),
});
g.__madaSql = sql;

export const db = drizzle(sql, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { schema };
