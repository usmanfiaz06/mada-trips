import { afterEach, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { CircleDetail, MessagesPage, PostsResponse, type Notification } from "@mada/shared";
import { db, schema } from "@/db";
import { appNotifications, appUsers } from "@/db/app-schema";
import { appDeskModeration } from "@/db/app-schema-desk";
import { appReports } from "@/db/app-schema-circles";
import { GET as postsGet, POST as postsPost } from "@/app/api/app/v1/posts/route";
import { POST as circlesPost } from "@/app/api/app/v1/circles/route";
import { GET as msgsGet, POST as msgsPost } from "@/app/api/app/v1/circles/[id]/messages/route";
import { POST as acceptPost } from "@/app/api/app/v1/invites/[ref]/accept/route";
import { POST as reportsPost } from "@/app/api/app/v1/reports/route";
import { GET as inboxGet } from "@/app/api/app/v1/notifications/route";
import { decideModeration, listModeration } from "@/lib/app/desk/moderation";
import { mockVision, setVisionProvider, stubVision, checkImage } from "@/lib/app/moderation/vision";
import type { DeskActor } from "@/lib/app/desk/core";
import { call, person, withParams, type Who } from "./circles-helpers";

/* Moderation for the public feed (audit item 28): the shared rules in screen(), chat held softly, the desk's queue. */

const auth = (w: Who) => ({ token: w.token });
const TIP = { city: "Istanbul", kind: "food", audience: "everyone" } as const;
let seq = 0;
async function moderator(): Promise<DeskActor> {
  seq += 1;
  const perms = ["desk.view", "desk.moderate"];
  const [role] = await db.insert(schema.roles).values({ key: `mod_test_${Date.now()}_${seq}`, name: `Mod ${seq}`, nameAr: "إشراف", permissions: perms }).returning();
  const [u] = await db.insert(schema.users).values({ name: "Lama", email: `mod${Date.now()}${seq}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
  return { id: u!.id, name: "Lama", permissions: new Set(perms) };
}
async function circleOf(owner: Who, other: Who) {
  const r = await call(circlesPost, { ...auth(owner), body: { name: `Trip ${Date.now()}`, invite: [other.id] } });
  const c = CircleDetail.parse(r.json);
  await call(withParams(acceptPost, { ref: c.invited[0]!.inviteId }), auth(other));
  return c.circle.id;
}
const msgs = async (w: Who, id: string) => MessagesPage.parse((await call(withParams(msgsGet, { id }), { method: "GET", path: `/api/app/v1/circles/${id}/messages`, ...auth(w) })).json).items;
const send = (w: Who, id: string, body: string) => call(withParams(msgsPost, { id }), { ...auth(w), body: { body } });

afterEach(() => { delete process.env.APP_MODERATION; setVisionProvider(null); });

describe("screen() on tips", () => {
  it("holds abuse in Arabic and Arabizi, and places Mada doesn't list, and tells the author why", async () => {
    process.env.APP_MODERATION = "auto";
    const reem = await person("Reem");
    for (const [place, text, code] of [
      ["كافيه البحر", "المكان حلو بس الموظف يا حيوان", "abuse"], ["Kunefe", "ya 7mar the waiter was rude", "abuse"], ["Sky Bar", "Great cocktails at sunset", "venue"], ["نادي ليلي", "سهرة حلوة للشباب كل خميس", "venue"],
    ] as const) {
      const r = await call(postsPost, { ...auth(reem), body: { ...TIP, place, text } });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect(r.json.post.status).toBe("pending");
      expect(r.json.post.held, `${code}: ${text}`).toBeTruthy();
    }
    const sara = await person("Sara"); // five tips an hour each (LIMITS.postsPerHour)
    const clean = await call(postsPost, { ...auth(sara), body: { ...TIP, place: "مطعم نجد فيليج", text: "اطلبوا الجريش والجلسات العائلية فوق." } });
    expect(clean.json.post.held).toBeNull();
    // The same words again are held as a duplicate.
    const again = await call(postsPost, { ...auth(sara), body: { ...TIP, place: "مطعم نجد فيليج", text: "اطلبوا الجريش، والجلسات العائلية فوق" } });
    expect(again.json.post.held).toBeTruthy();
  });

  it("the image hook holds a flagged photo for a person (mock provider); the stub lets it wait as before", async () => {
    setVisionProvider(mockVision);
    expect(await checkImage(Buffer.from("....MOCK-NUDITY...."), "image/jpeg")).toBe("image: nudity");
    expect(await checkImage(Buffer.from("a fine photo"), "image/jpeg")).toBeNull();
    setVisionProvider(stubVision);
    expect(await checkImage(Buffer.from("MOCK-HOLD"), "image/jpeg")).toBeNull();
    setVisionProvider(mockVision);
    process.env.APP_MODERATION = "auto";
    const noor = await person("Noor");
    const photo = `data:image/jpeg;base64,${Buffer.from("jpegbytes MOCK-FACES").toString("base64")}`;
    const r = await call(postsPost, { ...auth(noor), body: { ...TIP, place: "Galata Tower", text: "Go at opening time.", photo, photoConsent: true } });
    expect(r.json.post.held).toMatch(/photo/);
  });
});

describe("circle messages and DMs", () => {
  it("a held line shows to its author only, with the reason; the desk approves it (edited) or takes it out, and the author is told", async () => {
    const [omar, hessa] = [await person("Omar"), await person("Hessa")];
    const id = await circleOf(omar, hessa);
    const ok = await send(hessa, id, "Coffee at 5?");
    expect(ok.status).toBeLessThan(300);
    const held = await send(hessa, id, "كلمني على 0551234567");
    expect(held.json.items[0].held).toMatchObject({ status: "pending" });
    expect((await msgs(omar, id)).map((m) => m.body)).not.toContain("كلمني على 0551234567");
    expect((await msgs(hessa, id)).find((m) => m.held)?.held?.why).toMatch(/phone|رقم/);

    const lama = await moderator();
    const q = (await listModeration("open")).find((m) => m.kind === "message" && m.authorUserId === hessa.id)!;
    expect(q.snapshot.text).toContain("0551234567");
    await decideModeration(lama, q.id, { decision: "approved", edit: { body: "كلمني على الخاص" } });
    const seen = await msgs(omar, id);
    expect(seen.map((m) => m.body)).toContain("كلمني على الخاص");

    const bad = await send(hessa, id, "you are a bitch");
    expect(bad.json.items[0].held.status).toBe("pending");
    const q2 = (await listModeration("open")).find((m) => m.kind === "message" && m.authorUserId === hessa.id)!;
    await expect(decideModeration(lama, q2.id, { decision: "rejected" })).rejects.toThrow(/Say why/);
    await decideModeration(lama, q2.id, { decision: "rejected", reason: "Insults aren't allowed in Circles." });
    expect((await msgs(hessa, id)).find((m) => m.body === "you are a bitch")?.held).toMatchObject({ status: "removed" });
    const [n] = await db.select().from(appNotifications).where(and(eq(appNotifications.userId, hessa.id), eq(appNotifications.kind, "message.removed"))).orderBy(desc(appNotifications.createdAt)).limit(1);
    expect(n?.body).toContain("Insults");
    const [row] = await db.select().from(appDeskModeration).where(eq(appDeskModeration.id, q2.id));
    expect(row?.status).toBe("rejected");
  });
});

describe("reports", () => {
  it("the reporter hears back in their own language: \"Thanks, we removed it\"", async () => {
    process.env.APP_MODERATION = "manual";
    const [author, reporter] = [await person("Author"), await person("Reporter")];
    await db.update(appUsers).set({ locale: "ar" }).where(eq(appUsers.id, reporter.id));
    const tip = await call(postsPost, { ...auth(author), body: { ...TIP, place: "Baklava house", text: "Ask for the pistachio one." } });
    const lama = await moderator();
    await decideModeration(lama, tip.json.post.id, { decision: "approved" }, "post");
    const r = await call(reportsPost, { ...auth(reporter), body: { targetKind: "post", targetId: tip.json.post.id, reason: "unsafe" } });
    expect(r.status, JSON.stringify(r.json)).toBeLessThan(300);
    const [rep] = await db.select().from(appReports).where(eq(appReports.reporterId, reporter.id));
    await decideModeration(lama, rep!.id, { decision: "removed", reason: "Not a real place." }, "report");
    const inbox = (await call(inboxGet, { method: "GET", path: "/api/app/v1/notifications", ...auth(reporter) })).json as { items: Notification[] };
    expect(inbox.items[0]!.title).toBe("شكرًا، شلناه");
    // The author's tip is gone from the feed.
    const feed = PostsResponse.parse((await call(postsGet, { method: "GET", path: "/api/app/v1/posts?city=Istanbul", ...auth(reporter) })).json).posts;
    expect(feed.map((p) => p.id)).not.toContain(tip.json.post.id);
  });
});
