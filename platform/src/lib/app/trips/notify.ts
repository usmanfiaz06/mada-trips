import "server-only";
import { eq } from "drizzle-orm";
import { t, type CopyKey, type Vars } from "@mada/shared";
import { db } from "@/db";
import { appNotifications } from "@/db/app-schema";
import { pushToUser } from "../push";
import { localeOfUser } from "../locale";
import type { Exec } from "./core";

/*
 * Everything that happens to a trip lands in the inbox first (so a missed push is never lost), then goes out as a push.
 * Words come from the catalogue: `copy` is a notify.* base key with .title (≤ 32) and .body (≤ 90). Mada is the sender;
 * the body names the person only when they acted (COPY.md §1).
 */

export type NotifyKind = "gate_change" | "leave_now" | "driver_here" | "booking_confirmed" | "connection_risk" | "flight_cancelled" | "flight_delayed" | "refund_moved" | "agent_reply" | "agent_needs_answer" | "document_problem" | "digest" | "circle" | "other";

export async function notify(userId: string, n: { kind: NotifyKind; level: "time_sensitive" | "active" | "passive"; copy: string; vars?: Vars; href?: string | null; data?: Record<string, unknown> }, tx: Exec = db) {
  // In the traveller's own language, whoever's action caused it.
  const locale = await localeOfUser(userId, tx);
  const title = t(`${n.copy}.title` as CopyKey, n.vars, locale).slice(0, 32);
  const body = t(`${n.copy}.body` as CopyKey, n.vars, locale).slice(0, 90);
  const [row] = await tx.insert(appNotifications).values({ userId, kind: n.kind, level: n.level, title, body, href: n.href ?? null, data: n.data ?? null }).returning({ id: appNotifications.id });
  // Quiet hours and the notification budget are applied by the sender later (SCOPE.md §7); passive ones never push.
  if (n.level !== "passive") {
    void pushToUser(userId, { title, body, data: { href: n.href ?? null, id: row!.id }, timeSensitive: n.level === "time_sensitive" })
      .then(async (r) => { if (r.sent) await db.update(appNotifications).set({ pushedAt: new Date() }).where(eq(appNotifications.id, row!.id)); })
      .catch(() => {});
  }
  return row!.id;
}
