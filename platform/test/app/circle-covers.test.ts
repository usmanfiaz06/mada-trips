import { afterEach, describe, expect, it } from "vitest";
import { eq, sql as raw } from "drizzle-orm";
import { CircleDetail, CirclesResponse, InviteLink, UploadCoverResponse, type CircleCover } from "@mada/shared";
import { db, schema } from "@/db";
import { appCircleDetails } from "@/db/app-schema-circles";
import { appFiles } from "@/db/app-schema-wallet";
import { GET as circlesGet, POST as circlesPost } from "@/app/api/app/v1/circles/route";
import { POST as coversPost } from "@/app/api/app/v1/circles/covers/route";
import { GET as circleGet, PATCH as circlePatch } from "@/app/api/app/v1/circles/[id]/route";
import { GET as coverGet } from "@/app/api/app/v1/circles/[id]/cover/route";
import { POST as linkPost } from "@/app/api/app/v1/circles/[id]/link/route";
import { GET as invitePreview } from "@/app/api/app/v1/invites/[ref]/route";
import { POST as acceptPost } from "@/app/api/app/v1/invites/[ref]/accept/route";
import { GET as joinGet } from "@/app/join/[code]/route";
import { GET as joinCoverGet } from "@/app/links/join-cover/[code]/route";
import { GET as ogJoinGet } from "@/app/links/og/join/[code]/route";
import type { DeskActor } from "@/lib/app/desk/core";
import { decideModeration, listModeration } from "@/lib/app/desk/moderation";
import { call, person, withParams, type Who } from "./circles-helpers";
import { freshIp } from "./helpers";
import { callP, EXE, form, JPEG, PDF } from "./wallet-helpers";

/* A circle's cover: a drawing on a colour, a photo we ship, or an upload that's checked before anyone else sees it. */

afterEach(() => { delete process.env.APP_MODERATION; delete process.env.APP_MODERATION_DELAY_SECONDS; });

const auth = (w: Who) => ({ token: w.token, ip: freshIp() });
const upload = (w: Who, bytes: Buffer = JPEG, type = "image/jpeg", name = "cover.jpg") => callP(coversPost, {}, { method: "POST", token: w.token, raw: form({ bytes, name, type }), headers: { "x-forwarded-for": freshIp() } });
async function make(owner: Who, name: string, cover: unknown, invite: Who[] = []) {
  const r = await call(circlesPost, { ...auth(owner), body: { name, cover, invite: invite.map((w) => w.id) } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return CircleDetail.parse(r.json);
}
const coverOf = async (w: Who, id: string): Promise<CircleCover | null> => CircleDetail.parse((await call(withParams(circleGet, { id }), { method: "GET", ...auth(w) })).json).circle.cover;
const patch = (w: Who, id: string, body: unknown) => call(withParams(circlePatch, { id }), { method: "PATCH", ...auth(w), body });
const picture = (w: Who, id: string) => callP(coverGet, { id }, { token: w.token });
async function joinVia(owner: Who, circleId: string, ...people: Who[]) {
  const link = InviteLink.parse((await call(withParams(linkPost, { id: circleId }), auth(owner))).json);
  for (const p of people) expect((await call(withParams(acceptPost, { ref: link.code }), auth(p))).status).toBe(200);
  return link;
}
let opsSeq = 0;
async function moderator(): Promise<DeskActor> {
  opsSeq += 1;
  const perms = ["desk.view", "desk.moderate"];
  const [role] = await db.insert(schema.roles).values({ key: `cover_test_${Date.now()}_${opsSeq}`, name: `Covers ${opsSeq}`, nameAr: "مراجعة", permissions: perms }).returning();
  const [u] = await db.insert(schema.users).values({ name: "Lama", email: `covers${Date.now()}${opsSeq}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
  return { id: u!.id, name: "Lama", permissions: new Set(perms) };
}

describe("circle covers: drawings and photos", () => {
  it("makes a circle with a drawing on a colour; everyone in it, and anyone invited, sees the same", async () => {
    const omar = await person("Omar");
    const hessa = await person("Hessa");
    const c = await make(omar, "Desert weekend", { kind: "icon", icon: "camel", color: "sand" }, [hessa]);
    expect(c.circle.cover).toEqual({ kind: "icon", icon: "camel", color: "sand" });
    const list = CirclesResponse.parse((await call(circlesGet, { method: "GET", ...auth(hessa) })).json);
    expect(list.incoming[0]!.circle.cover).toEqual({ kind: "icon", icon: "camel", color: "sand" });
    // The admin changes it to a library photo, then back to a drawing.
    expect((await patch(omar, c.circle.id, { cover: { kind: "photo", id: "baku-old-city" } })).json.circle.cover).toEqual({ kind: "photo", id: "baku-old-city" });
    expect((await patch(omar, c.circle.id, { cover: { kind: "icon", icon: "lantern", color: "green" } })).json.circle.cover).toEqual({ kind: "icon", icon: "lantern", color: "green" });
    expect((await patch(omar, c.circle.id, { cover: null })).json.circle.cover).toBeNull();
  });

  it("checks what a cover can be: known drawings, colours and photos; uploads by file only", async () => {
    const omar = await person("Omar");
    for (const cover of [{ kind: "icon", icon: "kaaba", color: "green" }, { kind: "icon", icon: "plane", color: "purple" }, { kind: "photo", id: "makkah-clock-tower" }, { kind: "photo", id: "../../etc/passwd" }, { kind: "upload", url: "https://example.com/x.jpg" }, { kind: "upload", fileId: "nope" }, "nowhere"]) {
      const r = await call(circlesPost, { ...auth(omar), body: { name: `Bad ${Math.random()}`.slice(0, 20), cover } });
      expect(r.status, JSON.stringify(cover)).toBe(400);
      expect(r.json.error.code).toBe("VALIDATION");
    }
  });

  it("keeps older circles working: a stored key is a photo, a row with no cover is plain green", async () => {
    const omar = await person("Omar");
    const a = await make(omar, "Old style", "riyadh");
    expect(a.circle.cover).toEqual({ kind: "photo", id: "riyadh" });
    // A row written before covers had kinds (cover_kind null), as the migration leaves untouched ones.
    await db.update(appCircleDetails).set({ coverKind: null, cover: "alula" }).where(eq(appCircleDetails.circleId, a.circle.id));
    expect(await coverOf(omar, a.circle.id)).toEqual({ kind: "photo", id: "alula" });
    await db.update(appCircleDetails).set({ coverKind: null, cover: "somewhere-else" }).where(eq(appCircleDetails.circleId, a.circle.id));
    expect(await coverOf(omar, a.circle.id)).toBeNull();
    await db.execute(raw`UPDATE app_circle_details SET cover = 'istanbul', cover_kind = NULL WHERE circle_id = ${a.circle.id}`);
    await db.execute(raw`UPDATE app_circle_details SET cover_kind = 'photo' WHERE cover IN ('istanbul', 'alula', 'riyadh') AND cover_kind IS NULL AND circle_id = ${a.circle.id}`);
    expect((await db.select().from(appCircleDetails).where(eq(appCircleDetails.circleId, a.circle.id)))[0]!.coverKind).toBe("photo");
    // A circle made without a cover is plain green.
    expect((await make(omar, "Plain", null)).circle.cover).toBeNull();
  });

  it("only the admin changes the cover", async () => {
    const omar = await person("Omar");
    const noor = await person("Noor");
    const c = await make(omar, "Admins only", { kind: "icon", icon: "sun", color: "gold" });
    await joinVia(omar, c.circle.id, noor);
    const r = await patch(noor, c.circle.id, { cover: { kind: "icon", icon: "heart", color: "rose" } });
    expect(r.status).toBe(403);
    expect(await coverOf(omar, c.circle.id)).toEqual({ kind: "icon", icon: "sun", color: "gold" });
  });
});

describe("circle covers: your own photo", () => {
  it("uploads a photo (signed in, photos only) and nobody else can use it", async () => {
    const omar = await person("Omar");
    const noor = await person("Noor");
    expect((await callP(coversPost, {}, { method: "POST", raw: form({ bytes: JPEG, name: "a.jpg", type: "image/jpeg" }) })).status).toBe(401);
    expect((await upload(omar, PDF, "application/pdf", "a.pdf")).status).toBe(400);
    expect((await upload(omar, EXE, "image/jpeg", "sneaky.jpg")).status).toBe(400);
    const up = await upload(omar);
    expect(up.status).toBe(201);
    const { fileId, status } = UploadCoverResponse.parse(up.json);
    expect(status).toBe("pending");
    const [f] = await db.select().from(appFiles).where(eq(appFiles.id, fileId));
    expect(f).toMatchObject({ ownerId: omar.id, purpose: "cover", mime: "image/jpeg" });
    // Noor can't put Omar's upload on her circle.
    const r = await call(circlesPost, { ...auth(noor), body: { name: "Borrowed", cover: { kind: "upload", fileId } } });
    expect(r.status).toBe(400);
  });

  it("is pending until checked: only the uploader sees it; the circle keeps the cover it had; then everyone sees it", async () => {
    process.env.APP_MODERATION = "auto";
    process.env.APP_MODERATION_DELAY_SECONDS = "3600";
    const omar = await person("Omar");
    const noor = await person("Noor");
    const c = await make(omar, "Beach week", { kind: "icon", icon: "beach", color: "sky" });
    await joinVia(omar, c.circle.id, noor);
    const { fileId } = UploadCoverResponse.parse((await upload(omar)).json);
    const r = await patch(omar, c.circle.id, { cover: { kind: "upload", fileId } });
    expect(r.status).toBe(200);
    expect(r.json.circle.cover).toEqual({ kind: "upload", fileId, status: "pending", url: `/api/app/v1/circles/${c.circle.id}/cover` });
    // Noor still sees the drawing, and can't fetch the photo.
    expect(await coverOf(noor, c.circle.id)).toEqual({ kind: "icon", icon: "beach", color: "sky" });
    expect((await picture(noor, c.circle.id)).status).toBe(404);
    const mine = await picture(omar, c.circle.id);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("image/jpeg");
    expect(mine.headers.get("cache-control")).toContain("no-store");
    expect(mine.bytes.equals(JPEG)).toBe(true);
    // The invite link shows the drawing too, never the unchecked photo.
    const link = await joinVia(omar, c.circle.id);
    const pv = await call(withParams(invitePreview, { ref: link.code }), { method: "GET", ip: freshIp() });
    expect(pv.json.circle.cover).toEqual({ kind: "icon", icon: "beach", color: "sky" });
    expect((await joinCoverGet(new Request(`https://madatrips.sa/links/join-cover/${link.code}`, { headers: { "x-forwarded-for": freshIp() } }), { params: Promise.resolve({ code: link.code }) })).status).toBe(404);
    // Renaming sends the same cover back: the check stands.
    await patch(omar, c.circle.id, { name: "Beach week 2", cover: { kind: "upload", fileId } });
    expect((await coverOf(omar, c.circle.id))?.kind).toBe("upload");
    expect((await coverOf(noor, c.circle.id))?.kind).toBe("icon");
    // Its wait is over (auto mode): approved, for everyone, the invite page included.
    await db.update(appCircleDetails).set({ coverAutoApproveAt: new Date(Date.now() - 1000) }).where(eq(appCircleDetails.circleId, c.circle.id));
    expect(await coverOf(noor, c.circle.id)).toEqual({ kind: "upload", fileId, status: "approved", url: `/api/app/v1/circles/${c.circle.id}/cover` });
    expect((await picture(noor, c.circle.id)).status).toBe(200);
    const pv2 = await call(withParams(invitePreview, { ref: link.code }), { method: "GET", ip: freshIp() });
    expect(pv2.json.circle.cover).toEqual({ kind: "upload", fileId, status: "approved", url: `/links/join-cover/${link.code}` });
    const pub = await joinCoverGet(new Request(`https://madatrips.sa/links/join-cover/${link.code}`, { headers: { "x-forwarded-for": freshIp() } }), { params: Promise.resolve({ code: link.code }) });
    expect(pub.status).toBe(200);
    expect(Buffer.from(await pub.arrayBuffer()).equals(JPEG)).toBe(true);
    const html = await (await joinGet(new Request(`https://madatrips.sa/join/${link.code}`, { headers: { "x-forwarded-for": freshIp() } }), { params: Promise.resolve({ code: link.code }) })).text();
    expect(html).toContain(`src="/links/join-cover/${link.code}"`);
    // Someone who isn't in the circle and wasn't invited gets nothing.
    const stranger = await person("Stranger");
    expect((await picture(stranger, c.circle.id)).status).toBe(404);
    // Back to a drawing: the photo goes for good.
    await patch(omar, c.circle.id, { cover: { kind: "icon", icon: "wave", color: "sky" } });
    expect((await db.select().from(appFiles).where(eq(appFiles.id, fileId)))[0]!.deletedAt).not.toBeNull();
    expect((await picture(omar, c.circle.id)).status).toBe(404);
  });

  it("waits for the desk in manual mode; turned down, the uploader is told and the circle keeps its cover", async () => {
    process.env.APP_MODERATION = "manual";
    const lama = await moderator();
    const omar = await person("Omar");
    const noor = await person("Noor");
    const { fileId } = UploadCoverResponse.parse((await upload(omar)).json);
    // A new circle with an upload from the start: everyone else sees plain green until it's checked.
    const c = await make(omar, "Our photo", { kind: "upload", fileId });
    expect(c.circle.cover).toMatchObject({ kind: "upload", status: "pending" });
    await joinVia(omar, c.circle.id, noor);
    expect(await coverOf(noor, c.circle.id)).toBeNull();
    const q = await listModeration("open");
    const item = q.find((m) => m.id === c.circle.id);
    expect(item).toMatchObject({ source: "cover", kind: "cover", targetKind: "circle", authorUserId: omar.id, snapshot: { name: "Our photo", photoUrl: `/adminwork/desk/moderation/cover/${c.circle.id}` } });
    await expect(decideModeration(lama, c.circle.id, { decision: "rejected" }, "cover")).rejects.toThrow(/Say why/);
    await decideModeration(lama, c.circle.id, { decision: "rejected", reason: "Shows someone's home address" }, "cover");
    expect(await coverOf(omar, c.circle.id)).toMatchObject({ kind: "upload", status: "rejected" });
    expect(await coverOf(noor, c.circle.id)).toBeNull();
    expect((await listModeration("open")).some((m) => m.id === c.circle.id)).toBe(false);
    await expect(decideModeration(lama, c.circle.id, { decision: "approved" }, "cover")).rejects.toThrow();
    const audit = await db.execute<{ action: string }>(raw`SELECT action FROM app_audit WHERE entity_id = ${c.circle.id} ORDER BY created_at`);
    expect(audit.map((a) => a.action)).toContain("circle.cover_rejected");
    // A second photo, approved by the desk.
    const second = UploadCoverResponse.parse((await upload(omar)).json);
    await patch(omar, c.circle.id, { cover: { kind: "upload", fileId: second.fileId } });
    await decideModeration(lama, c.circle.id, { decision: "approved" }, "cover");
    expect(await coverOf(noor, c.circle.id)).toMatchObject({ kind: "upload", fileId: second.fileId, status: "approved" });
  });
});

describe("circle covers on the invite page and its picture", () => {
  it("draws a drawing cover inline on the page and in the link preview, in English and Arabic", async () => {
    const omar = await person("Omar");
    const c = await make(omar, "Ice cream crew", { kind: "icon", icon: "icecream", color: "rose" });
    const link = await joinVia(omar, c.circle.id);
    for (const lang of ["en", "ar"]) {
      const res = await joinGet(new Request(`https://madatrips.sa/join/${link.code}?lang=${lang}`, { headers: { "x-forwarded-for": freshIp() } }), { params: Promise.resolve({ code: link.code }) });
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain('<div class="bg art" aria-hidden="true"><svg');
      expect(html).not.toContain("/links/cover/");
      const og = await ogJoinGet(new Request(`https://madatrips.sa/links/og/join/${link.code}?lang=${lang}`, { headers: { "x-forwarded-for": freshIp() } }), { params: Promise.resolve({ code: link.code }) });
      expect(og.status).toBe(200);
      expect(og.headers.get("content-type")).toBe("image/png");
      expect((await og.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
    }
    // A library photo is served from the page's own files.
    await patch(omar, c.circle.id, { cover: { kind: "photo", id: "desert-camp" } });
    const html = await (await joinGet(new Request(`https://madatrips.sa/join/${link.code}`, { headers: { "x-forwarded-for": freshIp() } }), { params: Promise.resolve({ code: link.code }) })).text();
    expect(html).toContain('src="/links/cover/desert-camp.jpg"');
  });
});
