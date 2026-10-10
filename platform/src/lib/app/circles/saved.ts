import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { PostSnapshot, planById, type SaveRequest, type SavedItem } from "@mada/shared";
import { db } from "@/db";
import { appSaved } from "@/db/app-schema-circles";
import { AppError } from "../http";
import { getPost } from "./posts";

/* Saves: tips and Mada's plans, sorted by city. A saved tip is a copy, so it stays even if the post goes. */

const toItem = (r: typeof appSaved.$inferSelect): SavedItem => {
  const post = r.snapshot ? PostSnapshot.safeParse(r.snapshot) : null;
  return { id: r.id, kind: r.kind === "plan" ? "plan" : "post", refId: r.refId, city: r.city, post: post?.success ? post.data : null, savedAt: r.createdAt.toISOString() };
};

export async function listSaved(me: string): Promise<SavedItem[]> {
  const rows = await db.select().from(appSaved).where(eq(appSaved.userId, me)).orderBy(desc(appSaved.createdAt));
  return rows.map(toItem);
}

export async function save(me: string, req: SaveRequest): Promise<SavedItem> {
  let city: string;
  let snapshot: Record<string, unknown> | null = null;
  if (req.kind === "plan") {
    const plan = planById(req.refId);
    if (!plan) throw new AppError("NOT_FOUND");
    city = plan.city;
  } else {
    const p = await getPost(me, req.refId);
    if (p.status !== "approved" && p.author.id !== me) throw new AppError("NOT_FOUND");
    city = p.city;
    snapshot = { id: p.id, author: p.author, city: p.city, place: p.place, text: p.text, kind: p.kind, photoKey: p.photoKey, photoUrl: p.photoUrl };
  }
  const [row] = await db.insert(appSaved).values({ userId: me, kind: req.kind, refId: req.refId, city, snapshot })
    .onConflictDoUpdate({ target: [appSaved.userId, appSaved.kind, appSaved.refId], set: { city } }).returning();
  return toItem(row!);
}

export async function unsave(me: string, id: string) {
  const r = await db.delete(appSaved).where(and(eq(appSaved.id, id), eq(appSaved.userId, me))).returning({ id: appSaved.id });
  if (!r.length) throw new AppError("NOT_FOUND");
}
