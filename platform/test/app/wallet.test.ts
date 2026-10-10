import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sql as rawSql } from "drizzle-orm";
import { CardsResponse, CreditResponse, DocumentResponse, DocumentsResponse, PeopleResponse, PersonDetailResponse, makeTd3, parseMrz } from "@mada/shared";
import { db } from "@/db";
import { appTrips } from "@/db/app-schema";
import { decryptField, passportAad } from "@/lib/app/crypto";
import { addCredit, getBalance, spendCredit } from "@/lib/app/credit";
import { agentReadDocument } from "@/lib/app/documents";
import { GET as docsGet, POST as docsPost } from "@/app/api/app/v1/documents/route";
import { DELETE as docDelete, GET as docGet } from "@/app/api/app/v1/documents/[id]/route";
import { GET as docFile } from "@/app/api/app/v1/documents/[id]/file/route";
import { DELETE as docUnshare, POST as docShare } from "@/app/api/app/v1/documents/[id]/share/route";
import { GET as peopleGet, POST as peoplePost } from "@/app/api/app/v1/people/route";
import { DELETE as personDelete, GET as personGet, PATCH as personPatch } from "@/app/api/app/v1/people/[id]/route";
import { PUT as personPassport } from "@/app/api/app/v1/people/[id]/passport/route";
import { PUT as selfPassport } from "@/app/api/app/v1/passport/route";
import { GET as cardsGet, POST as cardsPost } from "@/app/api/app/v1/cards/route";
import { DELETE as cardDelete } from "@/app/api/app/v1/cards/[id]/route";
import { PUT as cardsDefault } from "@/app/api/app/v1/cards/default/route";
import { GET as creditGet } from "@/app/api/app/v1/credit/route";
import { POST as creditMove } from "@/app/api/app/v1/credit/move/route";
import { call } from "./helpers";
import { EXE, JPEG, PDF, callP, form, signIn } from "./wallet-helpers";

async function selfId(token: string) {
  return PeopleResponse.parse((await call(peopleGet, { method: "GET", token })).json).people.find((p) => p.isSelf)!.id;
}
async function addPerson(token: string, givenNames = "Lina", relation = "helper") {
  return (await call(peoplePost, { token, body: { givenNames, surname: "Reyes", relation } })).json.person.id as string;
}
const upload = (token: string, file: Parameters<typeof form>[0], meta: unknown) => callP(docsPost, {}, { method: "POST", token, raw: form(file, meta) });

describe("passports from a scan", () => {
  it("reads the MRZ on the phone and saves only the encrypted number", async () => {
    const { token } = await signIn();
    // What the phone does: parse the two lines (here, made with real check digits).
    const [l1, l2] = makeTd3({ surname: "ALHARBI", given: "OMAR", number: "A08493141", nationality: "SAU", dob: "1984-03-11", sex: "M", expiry: "2031-06-22" });
    const read = parseMrz([l1, l2]);
    expect(read.ok).toBe(true);
    const r = await call(selfPassport, { method: "PUT", token, body: { givenNames: read.fields!.given, surname: read.fields!.surname, dateOfBirth: "1984-03-11", sex: "M", passport: { number: read.fields!.number, issuingCountry: "SAU", nationality: "SAU", expiry: "2031-06-22", source: "scan" } } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const { person } = PersonDetailResponse.parse(r.json);
    expect(person).toMatchObject({ isSelf: true, firstName: "Omar", surname: "ALHARBI", dateOfBirth: "1984-03-11" });
    expect(person.passport).toMatchObject({ numberMasked: "A08•••41", expiry: "2031-06-22", source: "scan" });
    expect(JSON.stringify(r.json)).not.toContain("A08493141");
    const [row] = await db.execute<{ passport_number_enc: string }>(rawSql`SELECT passport_number_enc FROM app_people WHERE id = ${person.id}`);
    expect(decryptField(row!.passport_number_enc, passportAad(person.id))).toBe("A08493141");
  });

  it("saves a passport for someone in the household, and only theirs", async () => {
    const a = await signIn();
    const lina = await addPerson(a.token);
    const body = { givenNames: "LINA", surname: "REYES", dateOfBirth: "1991-04-18", sex: "F", passport: { number: "P71493132", issuingCountry: "PHL", nationality: "PHL", expiry: "2028-11-02", source: "manual" } };
    const ok = await callP(personPassport, { id: lina }, { method: "PUT", token: a.token, body });
    expect(ok.status).toBe(200);
    expect(ok.json.person.passport.numberMasked).toBe("P71•••32");
    const b = await signIn();
    expect((await callP(personPassport, { id: lina }, { method: "PUT", token: b.token, body })).status).toBe(404);
    expect((await callP(personPassport, { id: "not-a-uuid" }, { method: "PUT", token: a.token, body })).status).toBe(404);
    expect((await callP(personPassport, { id: lina }, { method: "PUT", body })).status).toBe(401);
    const bad = await callP(personPassport, { id: lina }, { method: "PUT", token: a.token, body: { ...body, dateOfBirth: "18/04/1991" } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.json.error.fields)).toContain("dateOfBirth");
  });
});

describe("household details", () => {
  it("keeps the helper's iqama masked and the exit visa date", async () => {
    const { token } = await signIn();
    const lina = await addPerson(token);
    const r = await callP(personPatch, { id: lina }, { method: "PATCH", token, body: { iqama: "2123454561", exitVisa: { kind: "single", until: "2027-02-01" }, relationLabel: "Helper", meal: "halal" } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const { details } = PersonDetailResponse.parse(r.json);
    expect(details).toMatchObject({ iqamaMasked: "2•••••4561", exitVisa: { kind: "single", until: "2027-02-01" }, relationLabel: "Helper", meal: "halal" });
    expect(JSON.stringify(r.json)).not.toContain("2123454561");
    expect((await callP(personPatch, { id: lina }, { method: "PATCH", token, body: { iqama: "1123454561" } })).status).toBe(400);
    const again = PersonDetailResponse.parse((await callP(personGet, { id: lina }, { token })).json);
    expect(again.details.iqamaMasked).toBe("2•••••4561");
  });

  it("removes someone, but never the account holder", async () => {
    const { token } = await signIn();
    const sara = await addPerson(token, "Sara", "child");
    expect((await callP(personDelete, { id: sara }, { method: "DELETE", token })).status).toBe(200);
    const list = PeopleResponse.parse((await call(peopleGet, { method: "GET", token })).json).people;
    expect(list.map((p) => p.id)).not.toContain(sara);
    expect((await callP(personDelete, { id: await selfId(token) }, { method: "DELETE", token })).status).toBe(403);
    expect((await callP(personGet, { id: sara }, { token })).status).toBe(404);
  });
});

describe("the document vault", () => {
  it("stores a file encrypted, lists it, opens it for its owner only, and deletes it for good", async () => {
    const a = await signIn();
    const me = await selfId(a.token);
    const up = await upload(a.token, { bytes: PDF, name: "schengen.pdf", type: "application/pdf" }, { personId: me, kind: "visa", title: "Schengen visa", validUntil: "2028-06-11", fields: { Type: "Schengen, multiple entry" } });
    expect(up.status, JSON.stringify(up.json)).toBe(201);
    const { document } = DocumentResponse.parse(up.json);
    expect(document).toMatchObject({ title: "Schengen visa", detail: "Valid until Jun 2028", kind: "visa", removable: true, file: { mime: "application/pdf", name: "schengen.pdf" } });

    // On disk it's ciphertext, not the PDF.
    const dir = process.env.APP_BLOB_DIR!;
    const blob = readFileSync(join(dir, a.user.id, document.file!.id));
    expect(blob.includes(Buffer.from("%PDF"))).toBe(false);
    expect(statSync(join(dir, a.user.id, document.file!.id)).mode & 0o077).toBe(0);

    const file = await callP(docFile, { id: document.id }, { token: a.token });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(file.headers.get("cache-control")).toContain("no-store");
    expect(file.bytes.equals(PDF)).toBe(true);

    const b = await signIn();
    expect((await callP(docFile, { id: document.id }, { token: b.token })).status).toBe(404);
    expect((await callP(docGet, { id: document.id }, { token: b.token })).status).toBe(404);
    expect(DocumentsResponse.parse((await callP(docsGet, {}, { token: b.token })).json).documents).toHaveLength(0);
    expect((await upload(b.token, { bytes: PDF, name: "x.pdf", type: "application/pdf" }, { personId: me, kind: "visa" })).status).toBe(404);

    expect((await callP(docDelete, { id: document.id }, { method: "DELETE", token: a.token })).status).toBe(200);
    expect(readdirSync(join(dir, a.user.id))).not.toContain(document.file!.id);
    expect(DocumentsResponse.parse((await callP(docsGet, {}, { token: a.token })).json).documents).toHaveLength(0);
    const audit = await db.execute<{ action: string }>(rawSql`SELECT action FROM app_audit WHERE entity_id = ${document.id} ORDER BY created_at`);
    expect(audit.map((x) => x.action)).toEqual(["document.added", "document.viewed", "document.deleted"]);
  });

  it("checks type by content and size, as the app explains them", async () => {
    const { token } = await signIn();
    const me = await selfId(token);
    const exe = await upload(token, { bytes: EXE, name: "visa.pdf", type: "application/pdf" }, { personId: me, kind: "visa" });
    expect(exe.status).toBe(400);
    expect(exe.json.error.message).toBe("That file type won’t work. Use a photo or a PDF.");
    const big = await upload(token, { bytes: Buffer.concat([JPEG, Buffer.alloc(10 * 1024 * 1024)]), name: "big.jpg", type: "image/jpeg" }, { personId: me, kind: "visa" });
    expect(big.status).toBe(400);
    expect(big.json.error.message).toBe("That file is over 10 MB. Try a photo of the page instead.");
    const noKind = await upload(token, { bytes: JPEG, name: "a.jpg", type: "image/jpeg" }, { personId: me });
    expect(noKind.status).toBe(400);
    expect(Object.keys(noKind.json.error.fields)).toContain("kind");
    expect((await callP(docsPost, {}, { method: "POST", raw: form({ bytes: JPEG, name: "a.jpg", type: "image/jpeg" }, { personId: me, kind: "visa" }) })).status).toBe(401);
  });

  it("replaces a document: the old one goes once the new one is saved", async () => {
    const { token } = await signIn();
    const me = await selfId(token);
    const first = DocumentResponse.parse((await upload(token, { bytes: JPEG, name: "id.jpg", type: "image/jpeg" }, { personId: me, kind: "national_id" })).json).document;
    const second = await upload(token, { bytes: PDF, name: "id-new.pdf", type: "application/pdf" }, { personId: me, kind: "national_id", replaces: first.id, validUntil: "2031-01-01" });
    expect(second.status).toBe(201);
    const docs = DocumentsResponse.parse((await callP(docsGet, {}, { token, query: `?personId=${me}` })).json).documents;
    expect(docs.map((d) => d.id)).toEqual([second.json.document.id]);
    expect(docs[0]!.title).toBe("National ID");
  });

  it("shares with Mada for one trip, read-only, and stops when asked", async () => {
    const { token, user } = await signIn();
    const me = await selfId(token);
    const doc = DocumentResponse.parse((await upload(token, { bytes: JPEG, name: "visa.jpg", type: "image/jpeg" }, { personId: me, kind: "visa" })).json).document;
    await expect(agentReadDocument(doc.id, { opsUserId: "00000000-0000-0000-0000-000000000001", name: "Faisal" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [trip] = await db.insert(appTrips).values({ ownerId: user.id, city: "Istanbul", startDate: "2027-03-09", endDate: "2027-03-15" }).returning();
    const g = await callP(docShare, { id: doc.id }, { method: "POST", token, body: { tripId: trip!.id } });
    expect(g.status, JSON.stringify(g.json)).toBe(201);
    expect(g.json.grant.expiresAt.slice(0, 10)).toBe("2027-03-16");
    expect(DocumentResponse.parse((await callP(docGet, { id: doc.id }, { token })).json).document.sharedUntil).toBe(g.json.grant.expiresAt);
    const seen = await agentReadDocument(doc.id, { opsUserId: "00000000-0000-0000-0000-000000000001", name: "Faisal" });
    expect(seen.bytes!.equals(JPEG)).toBe(true);
    const audit = await db.execute<{ actor_kind: string }>(rawSql`SELECT actor_kind FROM app_audit WHERE entity_id = ${doc.id} AND action = 'document.agent_viewed'`);
    expect(audit).toHaveLength(1);
    // Someone else's trip can't be used.
    const other = await signIn();
    const [theirs] = await db.insert(appTrips).values({ ownerId: other.user.id, city: "Baku", startDate: "2027-04-01" }).returning();
    expect((await callP(docShare, { id: doc.id }, { method: "POST", token, body: { tripId: theirs!.id } })).status).toBe(404);
    expect((await callP(docUnshare, { id: doc.id }, { method: "DELETE", token })).status).toBe(200);
    await expect(agentReadDocument(doc.id, { opsUserId: "00000000-0000-0000-0000-000000000001", name: "Faisal" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("documents Mada added at set-up can't be deleted from the app", async () => {
    const { token, user } = await signIn();
    const me = await selfId(token);
    const [row] = await db.execute<{ id: string }>(rawSql`INSERT INTO app_documents (owner_id, person_id, kind, title, source, removable) VALUES (${user.id}, ${me}, 'national_id', 'National ID', 'setup', false) RETURNING id`);
    const r = await callP(docDelete, { id: row!.id }, { method: "DELETE", token });
    expect(r.status).toBe(403);
    expect(r.json.error.message).toBe("Added when you set up Mada. To remove it, talk to Mada.");
  });
});

describe("Mada credit", () => {
  it("is a ledger: add, spend, never below zero, append-only", async () => {
    const { token, user } = await signIn();
    expect(CreditResponse.parse((await call(creditGet, { method: "GET", token })).json).credit.balance.amount).toBe(0);
    await db.transaction((tx) => addCredit(tx, { userId: user.id, amount: 64_000, kind: "refund", note: "Galata rooms" }));
    await db.transaction((tx) => spendCredit(tx, { userId: user.id, amount: 14_000, note: "Booking X7K2QD" }));
    expect(await getBalance(user.id)).toBe(50_000);
    await expect(db.transaction((tx) => spendCredit(tx, { userId: user.id, amount: 50_001 }))).rejects.toMatchObject({ code: "VALIDATION" });
    // Two payments at once can't both spend the same riyals.
    const both = await Promise.allSettled([30_000, 30_000].map((amount) => db.transaction((tx) => spendCredit(tx, { userId: user.id, amount }))));
    expect(both.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await getBalance(user.id)).toBe(20_000);
    const { credit } = CreditResponse.parse((await call(creditGet, { method: "GET", token })).json);
    expect(credit.entries.map((e) => e.amount)).toEqual([-30_000, -14_000, 64_000]);
    await expect(db.execute(rawSql`UPDATE app_credit_ledger SET amount = 1 WHERE user_id = ${user.id}`)).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/append-only/) }) });
    expect((await call(creditGet, { method: "GET" })).status).toBe(401);
  });

  it("moves the balance to a saved card", async () => {
    const { token, user } = await signIn();
    await db.transaction((tx) => addCredit(tx, { userId: user.id, amount: 64_000, kind: "refund" }));
    const cards = CardsResponse.parse((await call(cardsPost, { token, body: { token: "tok_mock_visa", brand: "visa", last4: "4141", exp: "08/30" } })).json);
    const r = await call(creditMove, { token, body: { cardId: cards.cards[0]!.id } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ moved: 64_000, to: "Visa ending 41" });
    expect(r.json.credit.balance.amount).toBe(0);
    expect(r.json.credit.entries[0].note).toBe("Moved to Visa ending 41");
    expect((await call(creditMove, { token, body: { cardId: cards.cards[0]!.id } })).status).toBe(400);
    const other = await signIn();
    expect((await call(creditMove, { token: other.token, body: { cardId: cards.cards[0]!.id } })).status).toBe(404);
  });
});

describe("saved cards", () => {
  it("adds cards by token, keeps a default, asks for a new default before removing it", async () => {
    const { token } = await signIn();
    expect(CardsResponse.parse((await call(cardsGet, { method: "GET", token })).json)).toEqual({ cards: [], defaultId: "applepay" });
    const one = CardsResponse.parse((await call(cardsPost, { token, body: { token: "tok_mock_1", brand: "visa", last4: "4141", exp: "08/30" } })).json);
    const two = CardsResponse.parse((await call(cardsPost, { token, body: { token: "tok_mock_2", brand: "mada", last4: "8807", exp: "02/31", makeDefault: false } })).json);
    const [visa, mada] = [one.cards[0]!, two.cards[1]!];
    expect(two.defaultId).toBe(visa.id);
    expect(mada.label).toBe("mada ending 07");
    expect(JSON.stringify(two)).not.toContain("tok_mock");
    const [row] = await db.execute<{ token_enc: string }>(rawSql`SELECT token_enc FROM app_cards WHERE id = ${visa.id}`);
    expect(row!.token_enc).toMatch(/^v1\./);

    const refused = await callP(cardDelete, { id: visa.id }, { method: "DELETE", token });
    expect(refused.status).toBe(400);
    expect(refused.json.error.fields).toHaveProperty("newDefault");
    const swapped = CardsResponse.parse((await callP(cardDelete, { id: visa.id }, { method: "DELETE", token, query: `?newDefault=${mada.id}` })).json);
    expect(swapped).toMatchObject({ defaultId: mada.id });
    expect(swapped.cards.map((c) => c.id)).toEqual([mada.id]);
    // The only card: Apple Pay takes over.
    expect(CardsResponse.parse((await callP(cardDelete, { id: mada.id }, { method: "DELETE", token })).json)).toEqual({ cards: [], defaultId: "applepay" });
  });

  it("refuses expired cards, other people's cards, and no sign-in", async () => {
    const { token } = await signIn();
    const exp = await call(cardsPost, { token, body: { token: "tok_mock_1", brand: "visa", last4: "4141", exp: "01/20" } });
    expect(exp.status).toBe(400);
    expect(exp.json.error.message).toBe("This card has expired.");
    const mine = CardsResponse.parse((await call(cardsPost, { token, body: { token: "tok_mock_1", brand: "visa", last4: "4141", exp: "08/30" } })).json).cards[0]!;
    const other = await signIn();
    expect((await callP(cardDelete, { id: mine.id }, { method: "DELETE", token: other.token })).status).toBe(404);
    expect((await call(cardsDefault, { method: "PUT", token: other.token, body: { id: mine.id } })).status).toBe(404);
    expect((await call(cardsDefault, { method: "PUT", token, body: { id: "applepay" } })).json.defaultId).toBe("applepay");
    expect((await call(cardsGet, { method: "GET" })).status).toBe(401);
  });
});
