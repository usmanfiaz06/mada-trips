/**
 * Reset one person's password from the server, for when a partner is locked out.
 * Partner passwords can't be reset inside the app (so no partner can take over another's vote).
 *
 *   DATABASE_URL=... npm run user:reset -- someone@madatrips.com
 *
 * Prints a one-time password. They must choose their own on first sign-in; every session they had is ended.
 */
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import * as schema from "./schema";
import { sslFor } from "./ssl";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email.includes("@")) { console.error("Usage: npm run user:reset -- <email>"); process.exit(1); }
const url = process.env.DATABASE_URL ?? "postgres://mada:mada@localhost:5432/mada_ops";
const client = postgres(url, { max: 1, prepare: false, ssl: sslFor(url) });
const db = drizzle(client, { schema });

const [u] = await db.select().from(schema.users).where(eq(sql`lower(${schema.users.email})`, email));
if (!u) { console.error("No one with that email"); await client.end(); process.exit(1); }
const pw = `Mada-${randomBytes(10).toString("hex").match(/.{4}/g)!.join("-")}`;
await db.transaction(async (tx) => {
  await tx.update(schema.users).set({ passwordHash: await bcrypt.hash(pw, 12), mustChangePassword: true }).where(eq(schema.users.id, u.id));
  await tx.delete(schema.sessions).where(eq(schema.sessions.userId, u.id));
  await tx.insert(schema.auditEvents).values({ action: "user.password_reset", entityType: "user", entityId: u.id, entityRef: u.name, summary: `${u.name}'s password was reset from the server and they were signed out everywhere` });
});
console.log(`One-time password for ${u.name}: ${pw}\nShare it with them privately. They choose their own on first sign-in.`);
await client.end();
