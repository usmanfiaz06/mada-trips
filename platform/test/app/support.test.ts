import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql as rawSql } from "drizzle-orm";
import { SendSupportMessageResponse, SupportThreadResponse, SupportThreadsResponse } from "@mada/shared";
import { db } from "@/db";
import { appSegments, appTrips } from "@/db/app-schema";
import { agentReply, getDeskThread, listDeskThreads, markReadByDesk, setThreadStatus } from "@/lib/app/support/desk";
import { GET as threadsGet, POST as threadsPost } from "@/app/api/app/v1/support/threads/route";
import { GET as threadGet } from "@/app/api/app/v1/support/threads/[id]/route";
import { POST as messagesPost } from "@/app/api/app/v1/support/threads/[id]/messages/route";
import { POST as attachPost } from "@/app/api/app/v1/support/threads/[id]/attachments/route";
import { POST as readPost } from "@/app/api/app/v1/support/threads/[id]/read/route";
import { GET as attachmentGet } from "@/app/api/app/v1/support/attachments/[id]/route";
import { GET as unreadGet } from "@/app/api/app/v1/support/unread/route";
import { call } from "./helpers";
import { EXE, JPEG, PDF, callP, form, signIn } from "./wallet-helpers";

let FAISAL = { opsUserId: "", name: "Faisal" };

/** The desk agent is an Ops user (app_messages.author_ops_user_id points at users). */
beforeAll(async () => {
  const [role] = await db.execute<{ id: string }>(rawSql`INSERT INTO roles (key, name, name_ar) VALUES (${`desk-${Date.now()}`}, $$Desk$$, $$Desk$$) RETURNING id`);
  const [u] = await db.execute<{ id: string }>(rawSql`INSERT INTO users (name, email, password_hash, role_id) VALUES ('Faisal Alqahtani', ${`faisal.${Date.now()}@madatrips.sa`}, 'x', ${role!.id}) RETURNING id`);
  FAISAL = { opsUserId: u!.id, name: "Faisal" };
});

async function open(token: string, body: Record<string, unknown> = {}) {
  const r = await call(threadsPost, { token, body });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return SupportThreadResponse.parse(r.json);
}
const send = async (token: string, id: string, body: Record<string, unknown>) => {
  const r = await callP(messagesPost, { id }, { method: "POST", token, body });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return SendSupportMessageResponse.parse(r.json).messages;
};

afterEach(() => { delete process.env.SUPPORT_AUTOREPLY; });

describe("talk to Mada", () => {
  it("opens one conversation for the account and one per trip", async () => {
    const { token, user } = await signIn();
    const a = await open(token);
    expect(a.thread.about).toBe("Your account");
    expect(a.messages).toEqual([]);
    expect((await open(token)).thread.id).toBe(a.thread.id);
    const [trip] = await db.insert(appTrips).values({ ownerId: user.id, city: "Istanbul", startDate: "2027-03-09", endDate: "2027-03-15" }).returning();
    const b = await open(token, { tripId: trip!.id });
    expect(b.thread.about).toBe("Istanbul trip · 9–15 Mar");
    expect(SupportThreadsResponse.parse((await call(threadsGet, { method: "GET", token })).json).threads).toHaveLength(2);
    const other = await signIn();
    expect((await call(threadsPost, { token: other.token, body: { tripId: trip!.id } })).status).toBe(404);
    expect((await callP(threadGet, { id: a.thread.id }, { token: other.token })).status).toBe(404);
    expect((await callP(messagesPost, { id: a.thread.id }, { method: "POST", token: other.token, body: { body: "hi" } })).status).toBe(404);
    expect((await call(threadsGet, { method: "GET" })).status).toBe(401);
  });

  it("answers in Mada's voice, for what was asked (mock mode)", async () => {
    const { token } = await signIn();
    const { thread } = await open(token);
    const urgent = await send(token, thread.id, { body: "Help, my son is hurt" });
    expect(urgent[0]).toMatchObject({ author: { kind: "user" }, body: "Help, my son is hurt", card: { intent: "urgent" } });
    expect(urgent[1]).toMatchObject({ author: { kind: "mada" }, card: { urgent: true } });
    expect(urgent[1]!.body).toContain("+966 11 520 0000");
    const bag = await send(token, thread.id, { body: "", topic: "bag" });
    expect(bag[0]!.body).toBe("A missing bag");
    expect(bag[1]!.card).toMatchObject({ form: "bag" });
    const filed = await send(token, thread.id, { body: "", bag: { ref: "sv 482913", kind: "Black suitcase", to: "Home" }, bagFor: bag[1]!.id });
    expect(filed[0]!.body).toBe("SV 482913 · black suitcase · deliver to home");
    expect(filed[1]!.card?.steps).toHaveLength(4);
    expect(filed[1]!.card?.resolved).toBe(true);
    const all = SupportThreadResponse.parse((await callP(threadGet, { id: thread.id }, { token })).json).messages;
    expect(all.find((m) => m.id === bag[1]!.id)!.card?.filed).toBe(true);
    const rated = await send(token, thread.id, { body: "", rating: "yes" });
    expect(rated).toHaveLength(1);
    expect(rated[0]).toMatchObject({ body: "Yes, thanks.", card: { rated: true } });
    // Software never says "I".
    for (const m of all.filter((x) => x.author.kind === "mada")) expect(m.body).not.toMatch(/\bI(’|')?(m|ve|ll)?\b/);
  });

  it("offers flights to choose when a flight is missed, and only claims what a person confirms", async () => {
    const { token, user } = await signIn();
    const [trip] = await db.insert(appTrips).values({ ownerId: user.id, city: "Istanbul", startDate: "2099-03-09", endDate: "2099-03-15" }).returning();
    await db.insert(appSegments).values({ tripId: trip!.id, direction: "out", carrier: "SV", carrierName: "Saudia", flightNumber: "SV263", fromAirport: "RUH", toAirport: "IST", departLocal: "2099-03-09T09:40", departTz: "Asia/Riyadh", arriveLocal: "2099-03-09T13:55", arriveTz: "Europe/Istanbul", durationMin: 255 });
    const { thread } = await open(token, { tripId: trip!.id });
    const missed = await send(token, thread.id, { body: "I missed my flight" });
    const choices = missed[1]!.card!.choices!;
    expect(choices.map((c) => c.key)).toEqual(["sv265", "xy125", "refund"]);
    const picked = await send(token, thread.id, { body: "", reply: { messageId: missed[1]!.id, choice: "sv265" } });
    expect(picked[0]!.body).toBe("Saudia SV265 · leaves 13:30");
    expect(picked[1]!.body).toContain("Faisal confirms it");
    expect((await callP(messagesPost, { id: thread.id }, { method: "POST", token, body: { body: "", reply: { messageId: missed[1]!.id, choice: "nope" } } })).status).toBe(400);
    const seat = await send(token, thread.id, { body: "Can I have a window seat?" });
    expect(seat[1]!.body).toMatch(/^We’ve asked Saudia for a window seat/);
  });

  it("never doubles a message sent again after being offline", async () => {
    const { token } = await signIn();
    const { thread } = await open(token);
    const first = await send(token, thread.id, { body: "Is my visa ready?", clientId: "c-123456" });
    const again = await send(token, thread.id, { body: "Is my visa ready?", clientId: "c-123456" });
    expect(again.map((m) => m.id)).toEqual(first.map((m) => m.id));
    expect(SupportThreadResponse.parse((await callP(threadGet, { id: thread.id }, { token })).json).messages).toHaveLength(2);
  });

  it("only sends the safety templates when instant answers are off", async () => {
    process.env.SUPPORT_AUTOREPLY = "off";
    const { token } = await signIn();
    const { thread } = await open(token);
    expect(await send(token, thread.id, { body: "Can I change my hotel?" })).toHaveLength(1);
    expect(await send(token, thread.id, { body: "I'm at the airport, which counter?" })).toHaveLength(2);
  });

  it("takes photos and PDFs, encrypted, and refuses anything else", async () => {
    const { token } = await signIn();
    const { thread } = await open(token);
    const r = await callP(attachPost, { id: thread.id }, { method: "POST", token, raw: form({ bytes: JPEG, name: "tag.jpg", type: "image/jpeg" }, { clientId: "c-photo-1" }) });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const [mine, reply] = SendSupportMessageResponse.parse(r.json).messages;
    expect(mine!.attachment).toMatchObject({ name: "tag.jpg", mime: "image/jpeg" });
    expect(reply!.body).toBe("Got it. We’ll look at it and reply here within 5 minutes.");
    const file = await callP(attachmentGet, { id: mine!.attachment!.id }, { token });
    expect(file.bytes.equals(JPEG)).toBe(true);
    const other = await signIn();
    expect((await callP(attachmentGet, { id: mine!.attachment!.id }, { token: other.token })).status).toBe(404);
    const pdf = await callP(attachPost, { id: thread.id }, { method: "POST", token, raw: form({ bytes: PDF, name: "statement.pdf", type: "application/pdf" }) });
    expect(pdf.json.messages[0].body).toBe("PDF · statement.pdf");
    expect((await callP(attachPost, { id: thread.id }, { method: "POST", token, raw: form({ bytes: EXE, name: "x.jpg", type: "image/jpeg" }) })).status).toBe(400);
  });
});

describe("the desk", () => {
  it("sees the conversation, replies as a named person, and the traveller's unread count follows", async () => {
    process.env.SUPPORT_AUTOREPLY = "off";
    const { token, user } = await signIn();
    const { thread } = await open(token);
    await send(token, thread.id, { body: "Can you add my mother to the Istanbul trip?" });
    const list = await listDeskThreads();
    const mine = list.find((x) => x.id === thread.id)!;
    expect(mine).toMatchObject({ unreadForDesk: 1, lastFrom: "user", urgent: false });
    expect(mine.phoneMasked).not.toContain(user.phone!.slice(-8, -4));
    const view = await getDeskThread(thread.id, FAISAL);
    expect(view.messages).toHaveLength(1);
    await markReadByDesk(thread.id, FAISAL);
    expect((await listDeskThreads()).find((x) => x.id === thread.id)!.unreadForDesk).toBe(0);

    const reply = await agentReply(thread.id, FAISAL, "I’ve added your mother. Same flights, seat 23C.");
    expect(reply.author).toMatchObject({ kind: "agent", name: "Faisal" });
    expect((await call(unreadGet, { method: "GET", token })).json.unread).toBe(1);
    const [n] = await db.execute<{ title: string; body: string; kind: string }>(rawSql`SELECT title, body, kind FROM app_notifications WHERE user_id = ${user.id} ORDER BY created_at DESC LIMIT 1`);
    expect(n).toMatchObject({ kind: "agent_reply", title: "Mada" });
    expect(n!.body).toMatch(/^Faisal: I’ve added your mother/);
    await callP(readPost, { id: thread.id }, { method: "POST", token });
    expect((await call(unreadGet, { method: "GET", token })).json.unread).toBe(0);
    await setThreadStatus(thread.id, "closed", FAISAL);
    expect((await listDeskThreads()).some((x) => x.id === thread.id)).toBe(false);
    await expect(agentReply(thread.id, FAISAL, "   ")).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
