import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { appDevices } from "@/db/app-schema";
import { isProductionDeploy } from "./config";

/*
 * Push notifications through the Expo Push API (APNs and FCM behind it; INTEGRATIONS.md).
 *   PUSH_MODE        mock | live. Live by default on a production deployment, mock everywhere else.
 *   EXPO_ACCESS_TOKEN optional; required when the Expo project has enhanced push security on.
 * Mock mode records what would have been sent (pushOutbox) and logs one line, never the body.
 * Tickets that come back DeviceNotRegistered disable that device so we stop sending to it.
 */

export type PushMessage = { title: string; body: string; data?: Record<string, unknown>; timeSensitive?: boolean };
export type PushResult = { sent: number; failed: number; mode: "mock" | "live" };

const g = globalThis as unknown as { __madaPushOutbox?: { to: string; title: string; body: string; at: string }[] };
/** What the mock push sender "sent", newest first, for tests and the dev console. */
export const pushOutbox = (g.__madaPushOutbox ??= []);

export const pushMode = (): "mock" | "live" => {
  const raw = (process.env.PUSH_MODE ?? (isProductionDeploy() ? "live" : "mock")).toLowerCase();
  return raw === "live" ? "live" : "mock";
};

export const isExpoToken = (t: string) => /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,}\]$/.test(t);

/** Send one message to every live device of a user. Never throws: a push is a nudge, the inbox is the record. */
export async function pushToUser(userId: string, msg: PushMessage): Promise<PushResult> {
  const devices = await db.select({ id: appDevices.id, token: appDevices.pushToken }).from(appDevices)
    .where(and(eq(appDevices.userId, userId), isNull(appDevices.disabledAt)));
  const tokens = devices.filter((d) => d.token && isExpoToken(d.token)) as { id: string; token: string }[];
  if (!tokens.length) return { sent: 0, failed: 0, mode: pushMode() };
  if (pushMode() === "mock") {
    for (const d of tokens) {
      pushOutbox.unshift({ to: d.token, title: msg.title, body: msg.body, at: new Date().toISOString() });
      if (pushOutbox.length > 200) pushOutbox.length = 200;
    }
    if (process.env.NODE_ENV !== "test" && !process.env.VITEST) console.info(`[mock push] ${tokens.length} device(s): ${msg.title}`);
    return { sent: tokens.length, failed: 0, mode: "mock" };
  }
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
      body: JSON.stringify(tokens.map((d) => ({
        to: d.token, title: msg.title, body: msg.body, data: msg.data ?? {}, sound: "default",
        priority: msg.timeSensitive ? "high" : "default", interruptionLevel: msg.timeSensitive ? "time-sensitive" : "active",
      }))),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
    const tickets = json?.data ?? [];
    const dead = tickets.map((tk, i) => (tk.details?.error === "DeviceNotRegistered" ? tokens[i]?.id : null)).filter((x): x is string => !!x);
    if (dead.length) await db.update(appDevices).set({ disabledAt: new Date() }).where(inArray(appDevices.id, dead));
    const failed = tickets.filter((tk) => tk.status !== "ok").length;
    return { sent: tickets.length - failed, failed, mode: "live" };
  } catch {
    console.warn("[push] Expo push request did not complete");
    return { sent: 0, failed: tokens.length, mode: "live" };
  }
}
