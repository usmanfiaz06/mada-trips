import { randomUUID } from "node:crypto";
import type { SupabaseAdminSupplier } from "../types";

/*
 * Supabase's admin API without a project or a service-role key: every call is recorded (newest first) so tests and the
 * dev console can see what the desk would have changed in Supabase Auth.
 */
export type SupabaseAdminCall =
  | { op: "setContact"; userId: string; kind: "phone" | "email"; value: string; at: string }
  | { op: "createUser"; userId: string; kind: "phone" | "email"; value: string; at: string }
  | { op: "deleteUser"; userId: string; at: string };

const g = globalThis as unknown as { __madaSupabaseAdminLog?: SupabaseAdminCall[] };
export const mockSupabaseAdminLog: SupabaseAdminCall[] = (g.__madaSupabaseAdminLog ??= []);

const keep = (c: SupabaseAdminCall) => {
  mockSupabaseAdminLog.unshift(c);
  if (mockSupabaseAdminLog.length > 200) mockSupabaseAdminLog.length = 200;
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) console.info(`[mock supabase admin] ${c.op} ${c.userId}`);
};

export const mockSupabaseAdmin: SupabaseAdminSupplier = {
  name: "mock-supabase-admin",
  async setContact(userId, contact) { keep({ op: "setContact", userId, kind: contact.kind, value: contact.value, at: new Date().toISOString() }); },
  async createUser(contact) {
    const userId = `mock-${randomUUID()}`;
    keep({ op: "createUser", userId, kind: contact.kind, value: contact.value, at: new Date().toISOString() });
    return userId;
  },
  async deleteUser(userId) { keep({ op: "deleteUser", userId, at: new Date().toISOString() }); },
};
