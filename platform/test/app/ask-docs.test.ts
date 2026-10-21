import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { AskAttachmentResponse, makeTd3, readSseFrames, todayIn, addDays, type AskChatEvent } from "@mada/shared";
import { db } from "@/db";
import { appNotifications, appPeople, appTrips } from "@/db/app-schema";
import { appDocuments, appFiles } from "@/db/app-schema-wallet";
import { appAskAttachments } from "@/db/app-schema-ask";
import { appFriendships } from "@/db/app-schema-circles";
import { decryptField, passportAad } from "@/lib/app/crypto";
import { POST as attachPost } from "@/app/api/app/v1/ask/attachments/route";
import { POST as tapPost } from "@/app/api/app/v1/ask/attachments/[id]/route";
import { GET as shareGet, POST as sharePost } from "@/app/api/app/v1/ask/shares/[id]/route";
import { POST as chatPost } from "@/app/api/app/v1/ask/chat/route";
import { GET as threadGet } from "@/app/api/app/v1/ask/threads/[id]/route";
import { PUT as selfPassport } from "@/app/api/app/v1/passport/route";
import { POST as peoplePost } from "@/app/api/app/v1/people/route";
import { documentsJob } from "@/lib/app/ask-chat/attachments";
import { setChatApi } from "@/lib/app/ask-chat/engine";
import { runTool } from "@/lib/app/ask-chat/tools";
import { householdOf } from "@/lib/app/booking/common";
import { fakeApi, lastToolText } from "./ask-chat-fake";
import { freshIp } from "./helpers";
import { JPEG, callP, form, signIn } from "./wallet-helpers";

/*
 * Documents in chat (docs/app/ASK-INTEGRATED.md §6, U6). The specimen passport (Omar Alharbi, A08493141, made with real
 * check digits by makeTd3), read twice, renewed, held by someone else; the photo gone after 24 hours; the companion's
 * tap; and the model never reading the number.
 */

const OMAR = { surname: "ALHARBI", given: "OMAR", number: "A08493141", nationality: "SAU", dob: "1984-03-11", sex: "M", expiry: "2031-06-22" };
const OMAR_RENEWED = { ...OMAR, number: "B12345678", expiry: "2036-05-30" };
const STRANGER = { surname: "ERIKSSON", given: "ANNA MARIA", number: "L898902C3", nationality: "SWE", dob: "1974-08-12", sex: "F", expiry: "2032-04-15" };
const lines = (p: typeof OMAR) => makeTd3(p);

async function savePassportOf(token: string, p = OMAR) {
  const r = await callP(selfPassport, {}, { method: "PUT", token, body: { givenNames: p.given, surname: p.surname, dateOfBirth: p.dob, sex: p.sex, passport: { number: p.number, issuingCountry: p.nationality, nationality: p.nationality, expiry: p.expiry, source: "scan" } } });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json.person.id as string;
}
async function send(token: string, body: Record<string, unknown>) {
  const r = await callP(attachPost, {}, { method: "POST", token, body });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return AskAttachmentResponse.parse(r.json);
}
async function tap(token: string, id: string, body: Record<string, unknown>) {
  const r = await callP(tapPost, { id }, { method: "POST", token, body });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return AskAttachmentResponse.parse(r.json);
}
const passports = async (ownerId: string) => db.select().from(appPeople).where(and(eq(appPeople.ownerId, ownerId), isNull(appPeople.deletedAt)));

beforeEach(() => { process.env.ASK_CHAT = "on"; process.env.ANTHROPIC_API_KEY = "test-key-not-real"; });
afterEach(() => { setChatApi(null); delete process.env.ASK_CHAT; delete process.env.ANTHROPIC_API_KEY; });

describe("the same passport twice", () => {
  it("says we already have it, and never makes a second row", async () => {
    const me = await signIn();
    const selfId = await savePassportOf(me.token);
    const first = await send(me.token, { mrz: lines(OMAR), source: "camera" });
    expect(first.card).toMatchObject({ case: "have_it", kind: "passport", personId: selfId, ending: "41", validTo: "2031-06-22", hasFile: false });
    expect(first.say).toBe("We already have your passport, ending 41, valid to 22 Jun 2031. Use it?");
    expect(JSON.stringify(first)).not.toContain(OMAR.number);
    const used = await tap(me.token, first.card.attachmentId, { choice: "use" });
    expect(used.card.case).toBe("used");
    // Again, in the same chat: the same answer, still one person, no document copy.
    const again = await send(me.token, { mrz: lines(OMAR), threadId: first.threadId });
    expect(again.card.case).toBe("have_it");
    expect(again.threadId).toBe(first.threadId);
    expect((await passports(me.user.id)).length).toBe(1);
    expect((await db.select().from(appDocuments).where(eq(appDocuments.ownerId, me.user.id))).length).toBe(0);
    // The chat shows the traveller's line by its masked label, and Mada's.
    const t = await callP(threadGet, { id: first.threadId }, { token: me.token });
    expect(t.json.lines[0]).toMatchObject({ who: "me", text: "Passport · Omar · ••41", attachment: { kind: "passport", label: "Passport · Omar · ••41" } });
    expect(JSON.stringify(t.json)).not.toContain(OMAR.number);
  });

  it("finds a passport saved before fingerprints existed (decrypted once, then kept)", async () => {
    const me = await signIn();
    const selfId = await savePassportOf(me.token);
    await db.update(appPeople).set({ passportFingerprint: null }).where(eq(appPeople.id, selfId));
    expect((await send(me.token, { mrz: lines(OMAR) })).card.case).toBe("have_it");
    const [p] = await db.select({ fp: appPeople.passportFingerprint }).from(appPeople).where(eq(appPeople.id, selfId));
    expect(p!.fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the documents job fills fingerprints for older passports", async () => {
    const me = await signIn();
    const selfId = await savePassportOf(me.token);
    await db.update(appPeople).set({ passportFingerprint: null }).where(eq(appPeople.id, selfId));
    const r = await documentsJob();
    expect(r.fingerprinted).toBeGreaterThanOrEqual(1);
    const [p] = await db.select({ fp: appPeople.passportFingerprint }).from(appPeople).where(eq(appPeople.id, selfId));
    expect(p!.fp).toBeTruthy();
  });
});

describe("a renewed passport", () => {
  it("offers to replace the old one, and replaces it only on the tap", async () => {
    const me = await signIn();
    const selfId = await savePassportOf(me.token);
    const r = await send(me.token, { mrz: lines(OMAR_RENEWED) });
    expect(r.card).toMatchObject({ case: "renewed", personId: selfId, ending: "78", old: { ending: "41", validTo: "2031-06-22" } });
    expect(r.say).toBe("A newer passport for Omar, valid to 30 May 2036. Replace the old one, ending 41?");
    // Nothing changed yet.
    const [before] = await db.select().from(appPeople).where(eq(appPeople.id, selfId));
    expect(decryptField(before!.passportNumberEnc!, passportAad(selfId))).toBe(OMAR.number);
    const done = await tap(me.token, r.card.attachmentId, { choice: "replace" });
    expect(done.card.case).toBe("replaced");
    const [after] = await db.select().from(appPeople).where(eq(appPeople.id, selfId));
    expect(decryptField(after!.passportNumberEnc!, passportAad(selfId))).toBe(OMAR_RENEWED.number);
    expect(after!.passportExpiry).toBe("2036-05-30");
    expect((await passports(me.user.id)).length).toBe(1);
    // The fields read from the photo are gone from the row once tapped.
    const [row] = await db.select().from(appAskAttachments).where(eq(appAskAttachments.id, r.card.attachmentId));
    expect(row!.fieldsEnc).toBeNull();
    // A second tap is answered with the card as it stands, nothing more.
    expect((await tap(me.token, r.card.attachmentId, { choice: "replace" })).card.case).toBe("replaced");
  });
});

describe("whose passport is this", () => {
  it("asks, never guesses, and someone outside the family needs their OK first", async () => {
    const me = await signIn();
    await savePassportOf(me.token);
    const lina = (await callP(peoplePost, {}, { method: "POST", token: me.token, body: { givenNames: "Lina", surname: "Reyes", relation: "helper" } })).json.person.id as string;
    const r = await send(me.token, { mrz: lines(STRANGER) });
    expect(r.card.case).toBe("whose");
    expect(r.say).toBe("Whose passport is this?");
    expect(r.card.people.map((p) => p.name)).toEqual(["Me", "Lina"]);
    // Picking Lina is a choice, not a save: she's not family, so the next card asks for her OK.
    const picked = await tap(me.token, r.card.attachmentId, { choice: "person", personId: lina });
    expect(picked.card).toMatchObject({ case: "consent", personId: lina });
    const [stillNone] = await db.select().from(appPeople).where(eq(appPeople.id, lina));
    expect(stillNone!.passportNumberEnc).toBeNull();
    const kept = await tap(me.token, r.card.attachmentId, { choice: "keep" });
    expect(kept.card.case).toBe("saved");
    const [saved] = await db.select().from(appPeople).where(eq(appPeople.id, lina));
    expect(decryptField(saved!.passportNumberEnc!, passportAad(lina))).toBe(STRANGER.number);
    expect(saved!.passportFingerprint).toBeTruthy();
  });

  it("someone new is made from the lines, for this booking only, and the number goes when it's due", async () => {
    const me = await signIn();
    await savePassportOf(me.token);
    const r = await send(me.token, { mrz: lines(STRANGER) });
    const fresh = await tap(me.token, r.card.attachmentId, { choice: "new_person" });
    expect(fresh.card).toMatchObject({ case: "consent", holder: "Anna", personId: null });
    expect(fresh.say).toBe("This is Anna’s passport. Do you have their OK to keep it in your documents?");
    expect((await passports(me.user.id)).length).toBe(1);
    const once = await tap(me.token, r.card.attachmentId, { choice: "booking_only" });
    expect(once.card.case).toBe("booking_only");
    const anna = (await passports(me.user.id)).find((p) => p.surname === "ERIKSSON")!;
    expect(anna).toMatchObject({ relation: "friend", dateOfBirth: "1974-08-12", passportNumberMasked: "L89•••C3" });
    const [row] = await db.select().from(appAskAttachments).where(eq(appAskAttachments.id, r.card.attachmentId));
    expect(row!.wipeAt!.getTime()).toBeGreaterThan(Date.now());
    await documentsJob(new Date(row!.wipeAt!.getTime() + 1000));
    const [after] = await db.select().from(appPeople).where(eq(appPeople.id, anna.id));
    expect(after).toMatchObject({ passportNumberEnc: null, passportNumberMasked: "L89•••C3", passportExpiry: "2032-04-15" });
  });

  it("someone else's tap on the card is not found", async () => {
    const me = await signIn();
    const r = await send(me.token, { mrz: lines(STRANGER) });
    const other = await signIn();
    expect((await callP(tapPost, { id: r.card.attachmentId }, { method: "POST", token: other.token, body: { choice: "new_person" } })).status).toBe(404);
  });
});

describe("photos", () => {
  it("an unreadable photo is kept encrypted for 24 hours at most, then deleted", async () => {
    const me = await signIn();
    const up = await callP(attachPost, {}, { method: "POST", token: me.token, raw: form({ bytes: JPEG, name: "page.jpg", type: "image/jpeg" }, { source: "library" }) });
    expect(up.status, JSON.stringify(up.json)).toBe(200);
    const r = AskAttachmentResponse.parse(up.json);
    expect(r.card).toMatchObject({ case: "unreadable", hasFile: true });
    expect(r.label).toBe("A photo");
    const [row] = await db.select().from(appAskAttachments).where(eq(appAskAttachments.id, r.card.attachmentId));
    const [file] = await db.select().from(appFiles).where(eq(appFiles.id, row!.fileId!));
    expect(file).toMatchObject({ purpose: "ask", deletedAt: null });
    const blob = join(process.env.APP_BLOB_DIR!, file!.storageKey);
    expect(existsSync(blob)).toBe(true);
    // Not yet: under a day old.
    await documentsJob(new Date(Date.now() + 23 * 3600_000));
    expect(existsSync(blob)).toBe(true);
    const out = await documentsJob(new Date(Date.now() + 25 * 3600_000));
    expect(out.filesDeleted).toBeGreaterThanOrEqual(1);
    expect(existsSync(blob)).toBe(false);
    const [gone] = await db.select().from(appFiles).where(eq(appFiles.id, file!.id));
    expect(gone!.deletedAt).not.toBeNull();
    const [cleared] = await db.select().from(appAskAttachments).where(eq(appAskAttachments.id, r.card.attachmentId));
    expect(cleared).toMatchObject({ fileId: null, fieldsEnc: null, status: "discarded" });
  });

  it("a photo of a passport already on file is never stored", async () => {
    const me = await signIn();
    await savePassportOf(me.token);
    const up = await callP(attachPost, {}, { method: "POST", token: me.token, raw: form({ bytes: JPEG, name: "page.jpg", type: "image/jpeg" }, { mrz: lines(OMAR) }) });
    const r = AskAttachmentResponse.parse(up.json);
    expect(r.card).toMatchObject({ case: "have_it", hasFile: false });
    expect((await db.select().from(appFiles).where(and(eq(appFiles.ownerId, me.user.id), eq(appFiles.purpose, "ask")))).length).toBe(0);
  });

  it("a passport added with a copy keeps the photo as the passport document, and the chat's copy goes", async () => {
    const me = await signIn();
    const up = await callP(attachPost, {}, { method: "POST", token: me.token, raw: form({ bytes: JPEG, name: "page.jpg", type: "image/jpeg" }, { mrz: lines(OMAR) }) });
    const r = AskAttachmentResponse.parse(up.json);
    // Nobody in the household has a date of birth yet: whose, then the account holder.
    expect(r.card.case).toBe("whose");
    const self = r.card.people[0]!;
    const add = await tap(me.token, r.card.attachmentId, { choice: "person", personId: self.id });
    expect(add.card.case).toBe("add");
    expect(add.say).toBe("Your passport, valid to 22 Jun 2031. Add it to your documents?");
    const saved = await tap(me.token, r.card.attachmentId, { choice: "add", keepCopy: true });
    expect(saved.card).toMatchObject({ case: "saved", hasFile: false });
    const docs = await db.select().from(appDocuments).where(and(eq(appDocuments.ownerId, me.user.id), eq(appDocuments.kind, "passport")));
    expect(docs.length).toBe(1);
    expect(JSON.stringify(docs[0]!.fields)).not.toContain(OMAR.number);
    const askFiles = await db.select().from(appFiles).where(and(eq(appFiles.ownerId, me.user.id), eq(appFiles.purpose, "ask")));
    expect(askFiles.every((f) => f.deletedAt !== null)).toBe(true);
  });
});

describe("expiry against the trip", () => {
  it("says when the passport won't last 6 months past the return", async () => {
    const me = await signIn();
    await savePassportOf(me.token, { ...OMAR, expiry: addDays(todayIn(), 120) });
    const [trip] = await db.insert(appTrips).values({ ownerId: me.user.id, city: "Istanbul", startDate: addDays(todayIn(), 30), endDate: addDays(todayIn(), 36) }).returning();
    const r = await send(me.token, { mrz: lines({ ...OMAR, expiry: addDays(todayIn(), 120) }), tripId: trip!.id });
    expect(r.card.case).toBe("have_it");
    expect(r.card.expiry).toMatchObject({ state: "expiring", reason: "short" });
    expect(r.say).toMatch(/It needs to be valid until .+, 6 months after you’re back\. Renew it first\.$/);
  });
});

describe("what the model reads", () => {
  it("never the number or the lines: only the card's words, in the context and from the tools", async () => {
    const me = await signIn();
    await savePassportOf(me.token);
    const sent = await send(me.token, { mrz: lines(OMAR) });
    const api = fakeApi((p, n) => {
      if (n === 0) return { blocks: [{ type: "tool_use", name: "documents_on_file", input: { traveller_ids: [], trip_id: null } }, { type: "tool_use", name: "use_document", input: { attachment_id: sent.card.attachmentId, person_id: null, action: "use" } }] };
      return { blocks: [{ type: "text", text: `We have it. ${lastToolText(p).includes("ending 41") ? "Tap Use it." : ""}` }] };
    });
    setChatApi(api);
    const req = new Request("http://localhost/api/app/v1/ask/chat", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${me.token}`, "x-forwarded-for": freshIp(), "user-agent": "vitest" },
      body: JSON.stringify({ text: `Use my passport ${OMAR.number} for the hotel`, threadId: sent.threadId }),
    });
    const events = readSseFrames(await (await chatPost(req)).text()).events as AskChatEvent[];
    expect(events.find((e) => e.type === "done")).toBeTruthy();
    const everything = JSON.stringify(api.requests);
    expect(everything).not.toContain(OMAR.number);
    for (const l of lines(OMAR)) expect(everything).not.toContain(l);
    expect(everything).not.toContain("1984-03-11");
    expect(everything).toContain(`attachment_id=${sent.card.attachmentId}`);
    expect(everything).toContain("ending 41");
    expect(everything).toContain("waiting for their tap");
    expect(lastToolText(api.requests[1]!)).toContain("Not done: nothing is saved or used until the traveller taps the card");
    // The tool never saved anything.
    const [row] = await db.select().from(appAskAttachments).where(eq(appAskAttachments.id, sent.card.attachmentId));
    expect(row!.status).toBe("read");
  });
});

describe("a companion's passport", () => {
  it("is asked for only on the owner's tap, and shared only on the companion's", async () => {
    const owner = await signIn();
    const friend = await signIn();
    const stranger = await signIn();
    await db.insert(appFriendships).values({ requesterId: owner.user.id, addresseeId: friend.user.id, status: "accepted", acceptedAt: new Date() });
    const [trip] = await db.insert(appTrips).values({ ownerId: owner.user.id, city: "AlUla", startDate: addDays(todayIn(), 20), endDate: addDays(todayIn(), 22) }).returning();
    const ctx = { ownerId: owner.user.id, people: await householdOf(owner.user.id), today: todayIn(), lang: "en" as const, ipHash: null, demo: new Set<never>(), threadId: null };

    // Not someone they know: nothing to ask.
    expect((await runTool("request_document_share", { trip_id: trip!.id, user_id: stranger.user.id, kind: "passport" }, ctx)).isError).toBe(true);
    const out = await runTool("request_document_share", { trip_id: trip!.id, user_id: friend.user.id, kind: "passport" }, ctx);
    expect(out.text).toMatch(/Nothing is sent until the traveller taps it/);
    const card = out.cards![0]!;
    expect(card.type).toBe("doc_share");
    const shareId = (card as { shareId: string }).shareId;
    // A draft isn't a request: the companion can't see it, and nothing was sent.
    expect((await callP(shareGet, { id: shareId }, { token: friend.token })).status).toBe(404);
    expect((await db.select().from(appNotifications).where(eq(appNotifications.userId, friend.user.id))).length).toBe(0);
    // The companion can't send it themselves; the owner's tap does.
    expect((await callP(sharePost, { id: shareId }, { method: "POST", token: friend.token, body: { action: "send" } })).status).toBe(404);
    const sent = await callP(sharePost, { id: shareId }, { method: "POST", token: owner.token, body: { action: "send" } });
    expect(sent.json.share.status).toBe("sent");
    const [note] = await db.select().from(appNotifications).where(eq(appNotifications.userId, friend.user.id));
    expect(note!.href).toBe(`/ask/share/${shareId}`);
    // The owner can't share for them.
    expect((await callP(sharePost, { id: shareId }, { method: "POST", token: owner.token, body: { action: "share" } })).status).toBe(403);
    expect((await callP(shareGet, { id: shareId }, { token: stranger.token })).status).toBe(404);
    // No passport yet: they add theirs first.
    expect((await callP(sharePost, { id: shareId }, { method: "POST", token: friend.token, body: { action: "share" } })).status).toBe(400);
    await savePassportOf(friend.token, STRANGER);
    const shared = await callP(sharePost, { id: shareId }, { method: "POST", token: friend.token, body: { action: "share" } });
    expect(shared.json.share.status).toBe("shared");
    const seen = await callP(shareGet, { id: shareId }, { token: owner.token });
    expect(seen.json.share).toMatchObject({ status: "shared", mine: true, ending: "C3", validTo: "2032-04-15" });
    expect(JSON.stringify(seen.json)).not.toContain(STRANGER.number);
    // documents_on_file says it for the trip, by the mask only; nothing was copied into the owner's household.
    const doc = await runTool("documents_on_file", { traveller_ids: [friend.user.id], trip_id: trip!.id }, ctx);
    expect(doc.text).toContain("shared for this trip · ending C3 · valid to 2032-04");
    expect(doc.text).not.toContain(STRANGER.number);
    expect((await passports(owner.user.id)).some((p) => p.surname === "ERIKSSON")).toBe(false);
  });
});

