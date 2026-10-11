import { describe, expect, it } from "vitest";
import { and, eq, sql as raw } from "drizzle-orm";
import { CircleDetail, InviteLink, InvitePreview } from "@mada/shared";
import { db } from "@/db";
import { appNotifications } from "@/db/app-schema";
import { pushOutbox } from "@/lib/app/push";
import { codeFor } from "@/lib/app/circles/invites";
import { POST as circlesPost } from "@/app/api/app/v1/circles/route";
import { POST as linkPost } from "@/app/api/app/v1/circles/[id]/link/route";
import { POST as invitesPost } from "@/app/api/app/v1/invites/route";
import { DELETE as inviteDelete, GET as invitePreview } from "@/app/api/app/v1/invites/[ref]/route";
import { POST as acceptPost } from "@/app/api/app/v1/invites/[ref]/accept/route";
import { POST as devicesPost } from "@/app/api/app/v1/devices/route";
import { call, person, withParams, type Who } from "./circles-helpers";
import { freshIp } from "./helpers";

/* Invite links end to end: how long they last, how many they let in, turning them off, who hears about a join, and
 * the limits that make codes impossible to list or guess. */

const auth = (w: Who, ip = freshIp()) => ({ token: w.token, ip });
async function circle(owner: Who, name: string) {
  const r = await call(circlesPost, { ...auth(owner), body: { name, cover: "alula" } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return CircleDetail.parse(r.json).circle.id;
}
const link = async (w: Who, id: string, body?: unknown) => {
  const r = await call(withParams(linkPost, { id }), { ...auth(w), body });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return InviteLink.parse(r.json);
};
const preview = async (code: string, ip = freshIp(), w?: Who) => call(withParams(invitePreview, { ref: code }), { method: "GET", ip, ...(w ? { token: w.token } : {}) });
const accept = (w: Who, ref: string, ip = freshIp()) => call(withParams(acceptPost, { ref }), { token: w.token, ip });

describe("invite links: options", () => {
  it("makes a link that lasts 1, 7 or 14 days, and nothing else", async () => {
    const omar = await person("Omar");
    const id = await circle(omar, "Weekend in AlUla");
    const week = await link(omar, id, { expiresInDays: 7 });
    const days = (Date.parse(week.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect(week).toMatchObject({ maxUses: null, uses: 0 });
    expect(week.id).toBeTruthy();
    const bad = await call(withParams(linkPost, { id }), { ...auth(omar), body: { expiresInDays: 30 } });
    expect(bad.status).toBe(400);
    expect((await call(withParams(linkPost, { id }), { ...auth(omar), body: { maxUses: 0 } })).status).toBe(400);
    expect((await call(withParams(linkPost, { id }), { ...auth(omar), body: { maxUses: 101 } })).status).toBe(400);
  });

  it("a new link (or new settings) turns the old one off; asking again without options gives the same link", async () => {
    const omar = await person("Omar");
    const id = await circle(omar, "Eid crew");
    const first = await link(omar, id);
    expect((await link(omar, id)).code).toBe(first.code);
    const second = await link(omar, id, { fresh: true });
    expect(second.code).not.toBe(first.code);
    expect(InvitePreview.parse((await preview(first.code)).json).status).toBe("cancelled");
    const third = await link(omar, id, { maxUses: 3 });
    expect(third.maxUses).toBe(3);
    expect(InvitePreview.parse((await preview(second.code)).json).status).toBe("cancelled");
    expect((await link(omar, id)).code).toBe(third.code);
  });

  it("a link for 2 people lets in 2, then says it's full; the count shows on the link", async () => {
    const omar = await person("Omar");
    const id = await circle(omar, "Two seats");
    const l = await link(omar, id, { maxUses: 2 });
    const [a, b, c] = [await person("Noor"), await person("Sara"), await person("Khalid")];
    expect((await accept(a, l.code)).status).toBe(200);
    expect((await accept(a, l.code)).json.already).toBe(true); // a second tap doesn't use a place
    expect((await accept(b, l.code)).status).toBe(200);
    const full = await accept(c, l.code);
    expect(full.status).toBe(404);
    expect(full.json.error.message).toBe("This link is full.");
    expect(InvitePreview.parse((await preview(l.code)).json).status).toBe("full");
    // Asking for the circle's link now gives a new one, since this one is used up.
    const next = await link(omar, id);
    expect(next.code).not.toBe(l.code);
    expect(next.uses).toBe(0);
  });

  it("only one person gets the last place when two join at once", async () => {
    const omar = await person("Omar");
    const id = await circle(omar, "One seat");
    const l = await link(omar, id, { maxUses: 1 });
    const people = await Promise.all([person("A1"), person("A2"), person("A3"), person("A4")]);
    const rs = await Promise.all(people.map((p) => accept(p, l.code)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 404)).toHaveLength(3);
    const [row] = await db.execute<{ uses: number }>(raw`SELECT uses FROM app_circle_invites WHERE id = ${l.id}`);
    expect(Number(row!.uses)).toBe(1);
  });

  it("turning a link off: the sender or the admin can; another member can't (403); a stranger learns nothing (404); it stops working at once", async () => {
    const omar = await person("Omar");
    const noor = await person("Noor");
    const id = await circle(omar, "Turn off");
    const l = await link(omar, id);
    expect((await accept(noor, l.code)).status).toBe(200);
    const noorLink = await link(noor, id);
    const stranger = await person("Stranger");
    expect((await call(withParams(inviteDelete, { ref: l.id! }), { method: "DELETE", ...auth(noor) })).status).toBe(403); // only the admin
    expect((await call(withParams(inviteDelete, { ref: l.id! }), { method: "DELETE", ...auth(stranger) })).status).toBe(404);
    expect((await call(withParams(inviteDelete, { ref: l.id! }), { method: "DELETE", ...auth(omar) })).status).toBe(200);
    expect(InvitePreview.parse((await preview(l.code)).json).status).toBe("cancelled");
    expect((await accept(stranger, l.code)).status).toBe(404);
    // The admin can turn off a member's link too.
    expect((await call(withParams(inviteDelete, { ref: noorLink.id! }), { method: "DELETE", ...auth(omar) })).status).toBe(200);
    expect(InvitePreview.parse((await preview(noorLink.code)).json).status).toBe("cancelled");
  });

  it("Mada links (not a circle) take the same options", async () => {
    const omar = await person("Omar");
    const r = await call(invitesPost, { ...auth(omar), body: { link: true, expiresInDays: 1, maxUses: 5 } });
    expect(r.status).toBe(200);
    const l = InviteLink.parse(r.json.link);
    expect(l.maxUses).toBe(5);
    expect((Date.parse(l.expiresAt) - Date.now()) / 3_600_000).toBeLessThan(24.1);
  });
});

describe("invite links: who hears about a join", () => {
  it("the person whose link it was gets \"Noor joined …\" in the inbox and on their phone", async () => {
    const omar = await person("Omar");
    await call(devicesPost, { ...auth(omar), body: { pushToken: "ExponentPushToken[abcdefghijklmnop]", platform: "ios" } });
    const id = await circle(omar, "Riyadh Season");
    const l = await link(omar, id);
    const noor = await person("Noor");
    expect((await accept(noor, l.code)).status).toBe(200);
    const [n] = await db.select().from(appNotifications).where(and(eq(appNotifications.userId, omar.id), eq(appNotifications.kind, "circle.joined")));
    expect(n).toMatchObject({ title: "Noor joined Riyadh Season", body: "They joined from your link. Say hello.", href: `/circle/${id}` });
    expect(pushOutbox.some((p) => p.to === "ExponentPushToken[abcdefghijklmnop]" && p.title === "Noor joined Riyadh Season")).toBe(true);
  });

  it("in the sender's own language", async () => {
    const omar = await person("Omar");
    await db.execute(raw`UPDATE app_users SET locale = 'ar' WHERE id = ${omar.id}`);
    const id = await circle(omar, "Abha");
    const l = await link(omar, id);
    const sara = await person("Sara");
    await accept(sara, l.code);
    const [n] = await db.select().from(appNotifications).where(and(eq(appNotifications.userId, omar.id), eq(appNotifications.kind, "circle.joined")));
    expect(n!.title).toContain("انضم");
  });

  it("a Mada link makes you friends and tells the sender, once", async () => {
    const omar = await person("Omar");
    const l = InviteLink.parse((await call(invitesPost, { ...auth(omar), body: { link: true } })).json.link);
    const maha = await person("Maha");
    expect((await accept(maha, l.code)).json).toMatchObject({ friendId: omar.id, already: false });
    expect((await accept(maha, l.code)).json.already).toBe(true);
    const ns = await db.select().from(appNotifications).where(and(eq(appNotifications.userId, omar.id), eq(appNotifications.kind, "friend.joined")));
    expect(ns).toHaveLength(1);
    expect(ns[0]!.title).toBe("Maha joined Mada");
  });
});

describe("invite links: abuse", () => {
  it("codes carry a MAC: a code we didn't issue is a plain 404, the same as an unknown one", async () => {
    const omar = await person("Omar");
    const id = await circle(omar, "Private");
    const l = await link(omar, id);
    const lookup = l.code.split("-")[0]!;
    // A real lookup with a wrong MAC, a made-up lookup with a right-looking MAC: both just "not found".
    const forged = `${lookup}-${"abcdef" === l.code.split("-")[1] ? "abcdeg" : "abcdef"}`;
    const ip = freshIp();
    const a = await preview(forged, ip);
    const b = await preview(codeFor("zzzzzzzz"), ip);
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(a.json.error.message).toBe(b.json.error.message);
  });

  it("one network may try 20 wrong codes in 10 minutes; then every lookup from it waits", async () => {
    const omar = await person("Omar");
    const id = await circle(omar, "Guessers");
    const good = await link(omar, id);
    const ip = freshIp();
    for (let i = 0; i < 20; i += 1) expect((await preview(`aaaaaaa${String.fromCharCode(97 + i)}-bbbbbb`, ip)).status).toBe(404);
    const blocked = await preview(good.code, ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // Somewhere else, the real link still works.
    expect((await preview(good.code, freshIp())).status).toBe(200);
  });

  it("one network may look at 60 invites a minute", async () => {
    const omar = await person("Omar");
    const id = await circle(omar, "Popular");
    const l = await link(omar, id);
    const ip = freshIp();
    const rs = [];
    for (let i = 0; i < 61; i += 1) rs.push((await preview(l.code, ip)).status);
    expect(rs.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(rs[60]).toBe(429);
  });

  it("the preview names first names and a count, never a phone number or a full name", async () => {
    const omar = await person("Omar");
    const id = await circle(omar, "Names");
    const l = await link(omar, id);
    const p = await preview(l.code);
    expect(JSON.stringify(p.json)).not.toContain(omar.phone);
    expect(p.json.circle.members[0].short).toBe("Omar");
  });
});
