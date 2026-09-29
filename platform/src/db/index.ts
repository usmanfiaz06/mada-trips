import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "postgres://mada:mada@localhost:5432/mada_ops";

// Reuse one pool across hot reloads in dev.
const g = globalThis as unknown as { __madaSql?: ReturnType<typeof postgres> };
// Remote databases (Supabase, Neon) need SSL; prepare:false keeps us compatible with transaction poolers.
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
export const sql = g.__madaSql ?? postgres(url, { max: 10, prepare: false, ssl: local ? false : "require" });
if (process.env.NODE_ENV !== "production") g.__madaSql = sql;

export const db = drizzle(sql, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { schema };
