import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql as rawSql } from "drizzle-orm";
import { DocumentResponse, DocumentsResponse, PeopleResponse } from "@mada/shared";
import { db, schema } from "@/db";
import { appRequests, appTrips } from "@/db/app-schema";
import type { DeskActor } from "@/lib/app/desk/core";
import { copyWindowOpen, readPassportCopy, travellersWithCopy } from "@/lib/app/desk/passport-copy";
import { GET as docsGet, POST as docsPost } from "@/app/api/app/v1/documents/route";
import { DELETE as docDelete } from "@/app/api/app/v1/documents/[id]/route";
import { GET as docFile } from "@/app/api/app/v1/documents/[id]/file/route";
import { GET as peopleGet } from "@/app/api/app/v1/people/route";
import { call } from "./helpers";
import { JPEG, PDF, callP, form, signIn } from "./wallet-helpers";

/* The passport copy: kept encrypted with the person's documents, one per person, and opened on the desk only through a booking that needs it. */

const upload = (token: string, file: Parameters<typeof form>[0], meta: unknown) => callP(docsPost, {}, { method: "POST", token, raw: form(file, meta) });
async function selfId(token: string) {
  return PeopleResponse.parse((await call(peopleGet, { method: "GET", token })).json).people.find((p) => p.isSelf)!.id;
}
let seq = 0;
async function agent(perms: string[]): Promise<DeskActor> {
  seq += 1;
  const [role] = await db.insert(schema.roles).values({ key: `pp_copy_${Date.now()}_${seq}`, name: `Copy ${seq}`, nameAr: "نسخة", permissions: perms }).returning();
  const [u] = await db.insert(schema.users).values({ name: "Faisal", email: `ppcopy${Date.now()}${seq}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
  return { id: u!.id, name: "Faisal", permissions: new Set(perms) };
}

describe("the passport copy", () => {
  it("keeps one copy per person, encrypted, with the confirmed fields but never the number", async () => {
    const { token, user } = await signIn();
    const me = await selfId(token);
    const first = await upload(token, { bytes: JPEG, name: "passport.jpg", type: "image/jpeg" }, {
      personId: me, kind: "passport", source: "scan", validUntil: "2031-06-22",
      fields: { name: "OMAR ALHARBI", nationality: "SAU", issued: "2021-06-23", expiry: "2031-06-22", number: "A08493141" },
    });
    expect(first.status, JSON.stringify(first.json)).toBe(201);
    const doc1 = DocumentResponse.parse(first.json).document;
    expect(doc1.fields).toEqual({ name: "OMAR ALHARBI", nationality: "SAU", issued: "2021-06-23", expiry: "2031-06-22" });
    expect(JSON.stringify(doc1)).not.toContain("A08493141");
    const dir = process.env.APP_BLOB_DIR!;
    expect(readFileSync(join(dir, user.id, doc1.file!.id)).includes(JPEG.subarray(0, 64))).toBe(false);

    // A new copy replaces the old one: the old file is removed for good.
    const second = DocumentResponse.parse((await upload(token, { bytes: PDF, name: "page.pdf", type: "application/pdf" }, { personId: me, kind: "passport", source: "upload" })).json).document;
    const docs = DocumentsResponse.parse((await callP(docsGet, {}, { token })).json).documents.filter((d) => d.kind === "passport");
    expect(docs.map((d) => d.id)).toEqual([second.id]);
    expect(readdirSync(join(dir, user.id))).not.toContain(doc1.file!.id);

    // The traveller opens it, then deletes it: the file goes.
    const own = await callP(docFile, { id: second.id }, { token });
    expect(own.status).toBe(200);
    expect(own.bytes.equals(PDF)).toBe(true);
    expect((await callP(docDelete, { id: second.id }, { method: "DELETE", token })).status).toBe(200);
    expect(readdirSync(join(dir, user.id))).not.toContain(second.file!.id);
  });

  it("needs the file itself", async () => {
    const { token } = await signIn();
    const me = await selfId(token);
    const r = await callP(docsPost, {}, { method: "POST", token, body: { personId: me, kind: "passport" } });
    expect(r.status).toBe(400);
  });

  it("opens on the desk only through a booking that needs it, and logs every look", async () => {
    const { token, user } = await signIn();
    const me = await selfId(token);
    const doc = DocumentResponse.parse((await upload(token, { bytes: JPEG, name: "passport.jpg", type: "image/jpeg" }, { personId: me, kind: "passport", source: "scan" })).json).document;
    const [trip] = await db.insert(appTrips).values({ ownerId: user.id, city: "Istanbul", startDate: "2099-03-09", endDate: "2099-03-15" }).returning();
    const [visa] = await db.insert(appRequests).values({ ownerId: user.id, kind: "visa", status: "sent", summary: "Schengen visa", travellerIds: [me], tripId: trip!.id }).returning();
    const [stay] = await db.insert(appRequests).values({ ownerId: user.id, kind: "stay", status: "sent", summary: "A hotel", travellerIds: [me] }).returning();
    const [other] = await db.insert(appRequests).values({ ownerId: user.id, kind: "flight", status: "sent", summary: "Without them", travellerIds: [] }).returning();
    const [gone] = await db.insert(appRequests).values({ ownerId: user.id, kind: "umrah", status: "cancelled", summary: "Cancelled", travellerIds: [me] }).returning();
    const [old] = await db.insert(appRequests).values({ ownerId: user.id, kind: "flight", status: "done", summary: "Last year", travellerIds: [me], updatedAt: new Date(Date.now() - 200 * 86_400_000) }).returning();

    const faisal = await agent(["desk.view", "desk.act"]);
    const seen = await readPassportCopy(faisal, visa!.id, me);
    expect(seen.bytes.equals(JPEG)).toBe(true);
    expect([...(await travellersWithCopy([me]))]).toEqual([me]);
    for (const r of [stay!, other!, gone!, old!]) await expect(readPassportCopy(faisal, r.id, me)).rejects.toMatchObject({ kind: "FORBIDDEN" });
    expect(await copyWindowOpen(old!)).toBe(false);
    await expect(readPassportCopy(await agent(["desk.view"]), visa!.id, me)).rejects.toMatchObject({ kind: "FORBIDDEN" });

    const audit = await db.execute<{ actor_kind: string; summary: string }>(rawSql`SELECT actor_kind, summary FROM app_audit WHERE entity_id = ${doc.id} AND action = 'document.agent_viewed'`);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_kind).toBe("agent");
    const ops = await db.execute<{ action: string }>(rawSql`SELECT action FROM audit_events WHERE entity_id = ${doc.id}`);
    expect(ops.map((x) => x.action)).toEqual(["document.agent_viewed"]);

    // Deleted by the traveller: nothing left to open.
    await callP(docDelete, { id: doc.id }, { method: "DELETE", token });
    await expect(readPassportCopy(faisal, visa!.id, me)).rejects.toMatchObject({ kind: "NOT_FOUND" });
  });
});
