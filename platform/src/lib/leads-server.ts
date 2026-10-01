import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export * from "./leads";

/** People who can work leads: active, with leads.view. */
export async function leadAssignees() {
  return db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .where(and(eq(schema.users.active, true), sql`'leads.view' = ANY(${schema.roles.permissions})`))
    .orderBy(schema.users.name);
}
