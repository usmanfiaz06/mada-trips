import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { sslFor } from "./ssl";

// Migrations run DDL and advisory locks, which the transaction pooler doesn't support. Use DIRECT_URL (the
// direct/session connection) when set, falling back to DATABASE_URL so a single-URL setup still works.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "postgres://mada:mada@localhost:5432/mada_ops";
const sql = postgres(url, { max: 1, prepare: false, ssl: sslFor(url) });
await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
await sql.end();
console.log("Migrations applied");
