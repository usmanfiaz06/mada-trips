import "server-only";
import { cookies } from "next/headers";
import { BASE } from "@/lib/base";
import { z } from "zod";

export type ActionState = { error?: string; ok?: string; fields?: Record<string, string> } | null;

/** A short message shown as a toast on the next page the user lands on. */
export async function flash(message: string) {
  (await cookies()).set("mada_flash", encodeURIComponent(message), { path: BASE || "/", maxAge: 20, sameSite: "lax" });
}

export function zodError(e: z.ZodError): ActionState {
  const fields: Record<string, string> = {};
  for (const i of e.issues) fields[String(i.path[0])] ??= i.message;
  return { error: Object.values(fields)[0] ?? "Please check the form", fields };
}

/** Next.js redirects are thrown; let them through, turn real errors into a message. */
export function toState(e: unknown): ActionState {
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
  console.error(e);
  return { error: e instanceof Error ? e.message : "Something went wrong" };
}

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const optStr = (fd: FormData, k: string) => { const v = str(fd, k); return v ? v : null; };
