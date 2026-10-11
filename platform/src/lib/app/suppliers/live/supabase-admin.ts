import type { SupabaseAdminSupplier, SupabaseContact } from "../types";
import { requireEnv } from "./not-configured";

/*
 * Supabase Auth's admin API (GoTrue), with the service-role key. Server only: the key bypasses every rule in the
 * project, so it never leaves the platform.
 *   SUPABASE_URL               https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  Project Settings › API › service_role (secret)
 * A phone goes to Supabase without its plus ("966501234567"), the way Supabase stores it.
 */

const fields = (c: SupabaseContact) =>
  c.kind === "phone" ? { phone: c.value.replace(/^\+/, ""), phone_confirm: true } : { email: c.value, email_confirm: true };

async function admin(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<unknown> {
  const env = requireEnv("Supabase admin", ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  const key = env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${env.SUPABASE_URL!.replace(/\/+$/, "")}/auth/v1/admin/users${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  // Never echo Supabase's body: it can carry the address or number.
  if (!res.ok) throw new Error(`Supabase admin ${method} answered ${res.status}`);
  return text ? (JSON.parse(text) as unknown) : null;
}

export const liveSupabaseAdmin: SupabaseAdminSupplier = {
  name: "supabase-admin",
  async setContact(userId, contact) {
    await admin("PUT", `/${encodeURIComponent(userId)}`, fields(contact));
  },
  async createUser(contact) {
    const r = (await admin("POST", "", fields(contact))) as { id?: string } | null;
    if (!r?.id) throw new Error("Supabase admin created a user without an id");
    return r.id;
  },
  async deleteUser(userId) {
    await admin("DELETE", `/${encodeURIComponent(userId)}`);
  },
};
