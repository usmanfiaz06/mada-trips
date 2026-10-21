import "server-only";
import { and, desc, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm";
import {
  AskAttachmentMeta, dmyToIso, docLabel, endingOf, firstNameOf, fullDay, maskPassportNumber, parseMrz, passportCopyFields, passportReady, t,
  type AskAttachmentResponse, type AskDocCase, type AskDocKind, type AskDocTap, type ChatDocCard, type CopyKey, type Lang,
} from "@mada/shared";
import { db } from "@/db";
import { appPeople, appTrips } from "@/db/app-schema";
import { appDocuments } from "@/db/app-schema-wallet";
import { appAskAttachments } from "@/db/app-schema-ask";
import { appAuditLog } from "../audit";
import { decryptField, encryptField, passportAad } from "../crypto";
import { AppError } from "../http";
import { createPerson } from "../people";
import { savePassport } from "../account/people";
import { createDocument } from "../documents";
import { deleteFile, getFile, readFileBytes, storeFile } from "../documents/storage";
import { documentFingerprint, passportFingerprint } from "../documents/fingerprint";
import { appendLine, attachTrip, loadThread, newThread } from "./store";
import { ownTrip } from "./attach";

/*
 * Documents in chat (docs/app/ASK-INTEGRATED.md §6, U6). The phone reads the two lines of a passport, visa or ID on the
 * device and sends only them (the photo too only when it couldn't read them, or to keep a copy). Here:
 *   1. the lines are parsed again (ICAO check digits) and fingerprinted (documents/fingerprint.ts);
 *   2. matched against what the household already holds: the same document (fingerprint), the same person by name and
 *      date of birth (a renewed passport, or nothing on file yet), several or none ("Whose passport is this?");
 *   3. one card goes back, and nothing is saved: the full fields wait sealed on the row until the traveller taps it;
 *   4. the tap saves through the same functions as the Wallet (savePassport, createPerson, createDocument), uses what
 *      is on file, or drops it. Someone outside the family needs "Do you have their OK?" first (§5.4).
 * A photo is deleted on the tap, or after 24 hours by the documents job (jobs.ts), whichever comes first. The model
 * never reads any of this beyond the card's words: first name, the last two characters, the month it expires.
 */

const DAY = 86_400_000;
export const ATTACHMENT_KEEP_MS = DAY;
/** "This booking only" without a trip: the full number goes after a week. */
const BOOKING_ONLY_MS = 7 * DAY;
const CONSENT_RELATIONS = new Set(["friend", "colleague", "helper"]);

type Row = typeof appAskAttachments.$inferSelect;
type PersonRow = typeof appPeople.$inferSelect;
type Fields = {
  kind: "passport" | "visa" | "id"; given: string; surname: string; number: string; issuer: string; nationality: string;
  dob: string | null; expiry: string | null; sex: "M" | "F" | null;
};
type Result = {
  case: AskDocCase; kind: AskDocKind; holder: string | null; personId: string | null; ending: string | null; validTo: string | null;
  old: { ending: string | null; validTo: string | null } | null; expiry: ChatDocCard["expiry"]; hasFile: boolean; self?: boolean; tripId?: string | null;
};

const fieldsAad = (id: string) => `app_ask_attachments:${id}:fields`;

/** The two (or three) lines as fields, or null when they don't read with valid check digits. */
export function fieldsOfLines(lines: string[] | null | undefined): Fields | null {
  if (!lines?.length) return null;
  const r = parseMrz(lines);
  if (!r.ok || !r.fields) return null;
  const f = r.fields;
  const type = f.type.charAt(0);
  const kind = type === "P" ? "passport" : type === "V" ? "visa" : type === "I" || type === "A" || type === "C" ? "id" : null;
  if (!kind || !f.number) return null;
  return {
    kind, given: f.given.trim(), surname: f.surname.trim(), number: f.number.toUpperCase(), issuer: f.issuer, nationality: f.nationalityCode,
    dob: dmyToIso(f.dob), expiry: dmyToIso(f.expiry), sex: f.sex === "M" || f.sex === "F" ? f.sex : null,
  };
}

const fpOf = (f: Fields) => (f.kind === "passport" ? passportFingerprint({ issuer: f.issuer, number: f.number, dob: f.dob }) : documentFingerprint(f.kind, { issuer: f.issuer, number: f.number, dob: f.dob }));
const nameKey = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z]/g, "");
const firstKey = (given: string | null | undefined) => nameKey((given ?? "").trim().split(/[\s<]+/)[0]);

/** Same person: the same surname, first given name and date of birth. Never by name alone. */
const samePerson = (p: PersonRow, f: Fields) => !!p.dateOfBirth && !!f.dob && p.dateOfBirth === f.dob && !!nameKey(p.surname) && nameKey(p.surname) === nameKey(f.surname) && firstKey(p.givenNames) === firstKey(f.given);
const needsConsent = (p: PersonRow | null) => !p || (!p.isSelf && CONSENT_RELATIONS.has(p.relation));
const firstOf = (p: PersonRow | null, f: Fields | null) => (p ? firstNameOf(p.givenNames) : "") || (f ? firstNameOf(f.given) : "") || null;

async function household(ownerId: string): Promise<PersonRow[]> {
  return db.select().from(appPeople).where(and(eq(appPeople.ownerId, ownerId), isNull(appPeople.deletedAt))).orderBy(desc(appPeople.isSelf), appPeople.createdAt);
}

/**
 * Passports saved before fingerprints existed get theirs now (each number decrypted once, here or in the documents job),
 * so "the same passport again" never misses an older one.
 */
export async function fingerprintMissing(rows: PersonRow[]): Promise<number> {
  let n = 0;
  for (const p of rows) {
    if (!p.passportNumberEnc || p.passportFingerprint) continue;
    try {
      const fp = passportFingerprint({ issuer: p.passportIssuingCountry, number: decryptField(p.passportNumberEnc, passportAad(p.id)), dob: p.dateOfBirth });
      await db.update(appPeople).set({ passportFingerprint: fp }).where(eq(appPeople.id, p.id));
      p.passportFingerprint = fp;
      n += 1;
    } catch (e) {
      console.warn("[ask-docs] fingerprint not made", p.id, e instanceof Error ? e.message : "");
    }
  }
  return n;
}

function expiryFor(expiry: string | null, trip: { endDate: string | null; startDate: string } | null, today: string): ChatDocCard["expiry"] {
  if (!expiry || !trip) return null;
  const r = passportReady({ passport: { expiry } as never }, { today, travelEnds: trip.endDate ?? trip.startDate });
  if (r.state === "ready") return { state: "ready", needUntil: r.expiry, reason: null };
  if (r.state === "expiring") return { state: "expiring", needUntil: r.needUntil, reason: r.reason };
  return null;
}

/** What the household holds for these fields: the card's case, before any tap. */
async function decide(ownerId: string, f: Fields, fp: string, people: PersonRow[], chosen: PersonRow | null = null): Promise<Omit<Result, "expiry" | "hasFile" | "tripId">> {
  const base = { kind: f.kind as AskDocKind, ending: endingOf(maskPassportNumber(f.number)), validTo: f.expiry, old: null };
  if (f.kind === "passport") {
    await fingerprintMissing(chosen ? [chosen] : people);
    const same = chosen ? (chosen.passportFingerprint === fp ? chosen : null) : people.find((p) => p.passportFingerprint === fp) ?? null;
    if (same) return { ...base, case: "have_it", holder: firstOf(same, f), personId: same.id, self: same.isSelf, ending: endingOf(same.passportNumberMasked) ?? base.ending, validTo: same.passportExpiry ?? f.expiry };
    const named = chosen ? [chosen] : people.filter((p) => samePerson(p, f));
    if (named.length === 1) {
      const p = named[0]!;
      if (p.passportNumberEnc) return { ...base, case: "renewed", holder: firstOf(p, f), personId: p.id, self: p.isSelf, old: { ending: endingOf(p.passportNumberMasked), validTo: p.passportExpiry } };
      return { ...base, case: needsConsent(p) ? "consent" : "add", holder: firstOf(p, f), personId: p.id, self: p.isSelf };
    }
    return { ...base, case: "whose", holder: firstNameOf(f.given) || null, personId: null };
  }
  // A visa or an ID: against the household's documents.
  const [doc] = await db.select({ id: appDocuments.id, personId: appDocuments.personId, validUntil: appDocuments.validUntil }).from(appDocuments)
    .where(and(eq(appDocuments.ownerId, ownerId), eq(appDocuments.fingerprint, fp), isNull(appDocuments.deletedAt), ...(chosen ? [eq(appDocuments.personId, chosen.id)] : []))).limit(1);
  if (doc) {
    const p = people.find((x) => x.id === doc.personId) ?? null;
    return { ...base, case: "have_it", holder: firstOf(p, f), personId: doc.personId, self: !!p?.isSelf, validTo: doc.validUntil ?? f.expiry };
  }
  const named = chosen ? [chosen] : people.filter((p) => samePerson(p, f));
  if (named.length === 1) return { ...base, case: needsConsent(named[0]!) ? "consent" : "add", holder: firstOf(named[0]!, f), personId: named[0]!.id, self: named[0]!.isSelf };
  return { ...base, case: "whose", holder: firstNameOf(f.given) || null, personId: null };
}

/* ───────────── words ───────────── */

const KIND_WORD: Record<AskDocKind, CopyKey> = { passport: "doc.kind.passport", visa: "doc.kind.visa", id: "doc.kind.id", other: "doc.kind.other" };
const kindWords = (lang: Lang) => ({ passport: t("doc.kind.passport", undefined, lang), visa: t("doc.kind.visa", undefined, lang), id: t("doc.kind.id", undefined, lang), other: t("doc.kind.other", undefined, lang) });
export const labelOf = (r: Pick<Result, "kind" | "holder" | "ending">, lang: Lang) => docLabel(r.kind, r.holder, r.ending, kindWords(lang));

/** Mada's line for the card, from the catalogue (never written by the model). */
export function sayOf(r: Result, lang: Lang): string {
  const name = r.holder ?? "";
  const date = r.validTo ? fullDay(r.validTo, lang) : "";
  const ending = r.ending ?? "";
  const who = r.self ? "self" : "other";
  const passport = r.kind === "passport";
  const line = (() => {
    switch (r.case) {
      case "have_it": return passport ? t(`doc.say.haveIt.${who}`, { name, ending, date }, lang) : t("doc.say.haveItDoc", { name, date }, lang);
      case "renewed": return t("doc.say.renewed", { name, date, old: r.old?.ending ?? "" }, lang);
      case "add": return passport ? t(`doc.say.add.${who}`, { name, date }, lang) : t("doc.say.addDoc", { kind: t(KIND_WORD[r.kind], undefined, lang), name, date }, lang);
      case "consent": return t("doc.say.consent", { name }, lang);
      case "whose": return t(r.kind === "visa" ? "doc.say.whose.visa" : r.kind === "id" ? "doc.say.whose.id" : "doc.say.whose.passport", undefined, lang);
      case "unreadable": return t("doc.say.unreadable", undefined, lang);
      case "used": return t(`doc.say.used.${who}`, { name, ending }, lang);
      case "saved": return t(`doc.say.saved.${who}`, { name }, lang);
      case "replaced": return t("doc.say.replaced", { name }, lang);
      case "booking_only": return t("doc.say.bookingOnly", undefined, lang);
      case "discarded": return t("doc.say.discarded", undefined, lang);
    }
  })();
  // A passport against the trip this chat is about (§6.3).
  const ex = passport && ["have_it", "renewed", "add", "used", "saved", "replaced"].includes(r.case) ? r.expiry : null;
  const after = ex ? (ex.state === "ready" ? t("doc.expiry.ok", undefined, lang) : ex.reason === "expired" ? t("doc.expiry.expired", undefined, lang) : t("doc.expiry.short", { until: fullDay(ex.needUntil, lang) }, lang)) : "";
  return [line, after].filter(Boolean).join(" ");
}

function cardOf(row: Row, people: PersonRow[], lang: Lang): ChatDocCard {
  const r = row.result as Result;
  return {
    type: "document", attachmentId: row.id, kind: r.kind, case: r.case, holder: r.holder, personId: r.personId, ending: r.ending, validTo: r.validTo,
    old: r.old, expiry: r.expiry, hasFile: !!row.fileId,
    people: r.case === "whose" ? people.slice(0, 8).map((p) => ({ id: p.id, name: p.isSelf ? t("doc.whose.me", undefined, lang) : firstNameOf(p.givenNames) || "" })).filter((p) => p.name) : [],
  };
}

async function tripOf(ownerId: string, tripId: string | null | undefined) {
  if (!tripId) return null;
  const [row] = await db.select({ id: appTrips.id, startDate: appTrips.startDate, endDate: appTrips.endDate }).from(appTrips).where(and(eq(appTrips.id, tripId), eq(appTrips.ownerId, ownerId)));
  return row ?? null;
}

function langOf(v: unknown): Lang { return v === "ar" ? "ar" : "en"; }

/* ───────────── a photo or file arrives ───────────── */

export type Upload = { name: string; mime: string; bytes: Buffer } | null;

/**
 * POST /ask/attachments: read what the phone sent, into this chat (a new one when none is given), and answer with the
 * card. Nothing is saved but the row (redacted) and, when sent, the photo (encrypted, gone within 24 hours).
 */
export async function readAttachment(ownerId: string, rawMeta: unknown, file: Upload, opts: { lang: Lang; ipHash: string | null; today: string }): Promise<AskAttachmentResponse> {
  const parsed = AskAttachmentMeta.safeParse(rawMeta ?? {});
  if (!parsed.success) throw new AppError("VALIDATION", { fields: { meta: "shape" } });
  const meta = parsed.data;
  if (!meta.mrz && !file) throw new AppError("VALIDATION", { fields: { file: "missing" } });
  let thread = await loadThread(ownerId, meta.threadId);
  const onTrip = meta.tripId ? await ownTrip(ownerId, meta.tripId) : null;
  if (!thread) thread = await newThread(ownerId, opts.lang, onTrip?.id ?? null);
  else if (onTrip && !thread.tripId && thread.turns === 0) { await attachTrip(ownerId, thread.id, onTrip.id); thread.tripId = onTrip.id; }
  const lang = langOf(thread.lang || opts.lang);

  const f = fieldsOfLines(meta.mrz);
  const people = await household(ownerId);
  const fp = f ? fpOf(f) : null;
  const decided = f && fp ? await decide(ownerId, f, fp, people) : null;
  const trip = await tripOf(ownerId, thread.tripId);
  const kindGuess = f ? f.kind : file ? (file.mime === "application/pdf" ? "other" : "photo") : "other";
  // A photo of something already on file isn't kept even for a minute.
  const keepFile = !!file && decided?.case !== "have_it";

  const row = await db.transaction(async (tx) => {
    const [r] = await tx.insert(appAskAttachments).values({ ownerId, threadId: thread!.id, kindGuess, fingerprint: fp, personId: decided?.personId ?? null }).returning();
    const stored = keepFile ? await storeFile(tx, ownerId, "ask", file!) : null;
    const result: Result = decided
      ? { ...decided, expiry: decided.kind === "passport" ? expiryFor(decided.validTo, trip, opts.today) : null, hasFile: !!stored, tripId: thread!.tripId }
      : { case: "unreadable", kind: "other", holder: null, personId: null, ending: null, validTo: null, old: null, expiry: null, hasFile: !!stored, tripId: thread!.tripId };
    const [done] = await tx.update(appAskAttachments).set({
      result, fileId: stored?.id ?? null, fieldsEnc: f ? encryptField(JSON.stringify(f), fieldsAad(r!.id)) : null,
    }).where(eq(appAskAttachments.id, r!.id)).returning();
    await appAuditLog(tx, {
      actorKind: "user", actorId: ownerId, action: "ask.attachment_read", entityType: "app_ask_attachment", entityId: r!.id,
      summary: `Sent a ${kindGuess} in Ask (${result.case})${stored ? `, photo kept for 24 h (${Math.ceil(stored.size / 1024)} KB)` : ""}`, data: { threadId: thread!.id, case: result.case }, ipHash: opts.ipHash,
    });
    return done!;
  });
  const card = cardOf(row, people, lang);
  const r = row.result as Result;
  const label = f ? labelOf(r, lang) : t(file?.mime === "application/pdf" ? "doc.me.file" : "doc.me.photo", undefined, lang);
  const say = sayOf(r, lang);
  const at = new Date().toISOString();
  await appendLine(ownerId, thread.id, { who: "me", text: label, at, attachment: { kind: r.kind, label } });
  await appendLine(ownerId, thread.id, { who: "mada", text: say, cards: ["document"] });
  return { threadId: thread.id, card, say, next: [], label };
}

/* ───────────── the tap ───────────── */

async function ownRow(ownerId: string, id: string): Promise<Row> {
  const [row] = await db.select().from(appAskAttachments).where(and(eq(appAskAttachments.id, id), eq(appAskAttachments.ownerId, ownerId)));
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

function openFields(row: Row): Fields {
  if (!row.fieldsEnc) throw new AppError("NOT_FOUND", { copy: "doc.say.unreadable" });
  return JSON.parse(decryptField(row.fieldsEnc, fieldsAad(row.id))) as Fields;
}

async function dropFile(ownerId: string, row: Pick<Row, "fileId">) {
  if (!row.fileId) return;
  const f = await getFile(row.fileId, ownerId);
  if (f) await deleteFile(db, f);
}

/** The fields saved where they belong: the person's passport (and a copy of the photo if asked), or a document. */
async function save(ownerId: string, row: Row, f: Fields, personId: string, keepCopy: boolean, ipHash: string | null): Promise<string | null> {
  const file = keepCopy && row.fileId ? await getFile(row.fileId, ownerId) : null;
  const bytes = file ? await readFileBytes(file) : null;
  if (f.kind === "passport") {
    if (!f.dob || !f.expiry) throw new AppError("VALIDATION", { fields: { mrz: "dates" } });
    await savePassport(ownerId, personId, {
      givenNames: f.given, surname: f.surname, dateOfBirth: f.dob, ...(f.sex ? { sex: f.sex } : {}),
      passport: { number: f.number, issuingCountry: f.issuer, nationality: f.nationality, expiry: f.expiry, source: "scan" },
    }, ipHash);
    if (file && bytes) {
      const doc = await createDocument(ownerId, {
        personId, kind: "passport", validUntil: f.expiry, source: "scan",
        fields: passportCopyFields({ name: `${f.given} ${f.surname}`.trim(), nationality: f.nationality, issuer: f.issuer, sex: f.sex, dob: f.dob, expiry: f.expiry }),
      }, { name: file.name, mime: file.mime, bytes }, ipHash);
      return doc.id;
    }
    return null;
  }
  const doc = await createDocument(ownerId, {
    personId, kind: f.kind === "visa" ? "visa" : "national_id", validUntil: f.expiry ?? undefined, source: "scan",
    fields: { name: `${f.given} ${f.surname}`.trim().slice(0, 120), issuer: f.issuer, number: maskPassportNumber(f.number) },
  }, file && bytes ? { name: file.name, mime: file.mime, bytes } : null, ipHash);
  await db.update(appDocuments).set({ fingerprint: fpOf(f) }).where(eq(appDocuments.id, doc.id));
  return doc.id;
}

/** Which taps each case takes. Anything else is a stale card: it answers with the card as it stands. */
const TAPS: Record<AskDocCase, readonly AskDocTap["choice"][]> = {
  have_it: ["use", "not_mine", "discard"], renewed: ["replace", "keep_old", "not_mine"], add: ["add", "not_mine", "discard"],
  consent: ["keep", "booking_only", "discard", "not_mine"], whose: ["person", "new_person", "discard"], unreadable: ["discard"],
  used: [], saved: [], replaced: [], booking_only: [], discarded: [],
};

/**
 * POST /ask/attachments/{id}: the traveller's tap on the card. The only way anything from a chat is saved: the model
 * can't call it (its tools only read, use_document refuses until this has run).
 */
export async function decideAttachment(ownerId: string, id: string, tap: AskDocTap, opts: { ipHash: string | null; today: string }): Promise<AskAttachmentResponse> {
  const row = await ownRow(ownerId, id);
  const people = await household(ownerId);
  const thread = row.threadId ? await loadThread(ownerId, row.threadId) : null;
  const lang = langOf(thread?.lang);
  const r = row.result as Result;
  const reply = async (next: Row, said?: string) => {
    const nr = next.result as Result;
    const say = said ?? sayOf(nr, lang);
    if (thread) await appendLine(ownerId, thread.id, { who: "mada", text: say, cards: ["document"] });
    return { threadId: thread?.id ?? row.threadId ?? row.id, card: cardOf(next, people, lang), say, next: [], label: labelOf(nr, lang) };
  };
  if (row.status !== "read" || !TAPS[r.case].includes(tap.choice)) return { threadId: thread?.id ?? row.id, card: cardOf(row, people, lang), say: sayOf(r, lang), next: [], label: labelOf(r, lang) };
  const trip = await tripOf(ownerId, r.tripId ?? thread?.tripId);
  const update = async (set: Partial<typeof appAskAttachments.$inferInsert>, result: Result) => {
    const [next] = await db.update(appAskAttachments).set({ ...set, result }).where(eq(appAskAttachments.id, row.id)).returning();
    return next!;
  };
  const finish = async (status: "confirmed" | "booking_only" | "discarded", result: Result, extra: Partial<typeof appAskAttachments.$inferInsert> = {}) => {
    await dropFile(ownerId, row);
    const next = await update({ status, fieldsEnc: null, fileId: null, decidedAt: new Date(), ...extra }, { ...result, hasFile: false });
    await appAuditLog(db, { actorKind: "user", actorId: ownerId, action: `ask.attachment_${result.case}`, entityType: "app_ask_attachment", entityId: row.id, summary: `Chose "${tap.choice}" on a ${r.kind} sent in Ask`, data: { personId: result.personId }, ipHash: opts.ipHash });
    return next;
  };

  switch (tap.choice) {
    case "use": return reply(await finish("confirmed", { ...r, case: "used" }));
    case "discard": case "keep_old": return reply(await finish("discarded", { ...r, case: "discarded" }));
    case "not_mine": return reply(await update({ personId: null }, { ...r, case: "whose", personId: null, self: false, old: null }));
    case "person": case "new_person": {
      const f = openFields(row);
      if (tap.choice === "new_person") return reply(await update({ personId: null }, { ...r, case: "consent", personId: null, self: false, holder: firstNameOf(f.given) || null, old: null }));
      const chosen = people.find((p) => p.id === tap.personId);
      if (!chosen) throw new AppError("NOT_FOUND");
      const d = await decide(ownerId, f, row.fingerprint ?? fpOf(f), people, chosen);
      // Picking a person is a choice, not a save: the next card says what will happen and waits for its own tap.
      const next = d.case === "whose" ? { ...d, case: (needsConsent(chosen) ? "consent" : "add") as AskDocCase, personId: chosen.id, holder: firstOf(chosen, f), self: chosen.isSelf } : d;
      return reply(await update({ personId: next.personId }, { ...r, ...next, expiry: f.kind === "passport" ? expiryFor(next.validTo, trip, opts.today) : null }));
    }
    case "add": case "replace": case "keep": case "booking_only": {
      const f = openFields(row);
      let personId = r.personId;
      if (!personId) {
        // Someone new, read from the lines: their names, date of birth, sex and nationality; their passport with them.
        const p = await createPerson(ownerId, {
          givenNames: f.given || "-", surname: f.surname || "-", relation: "friend", dateOfBirth: f.dob ?? undefined, ...(f.sex ? { sex: f.sex } : {}), nationality: f.nationality,
        }, opts.ipHash);
        personId = p.id;
      }
      const documentId = await save(ownerId, row, f, personId, !!tap.keepCopy, opts.ipHash);
      const person = (await household(ownerId)).find((p) => p.id === personId) ?? null;
      const ending = f.kind === "passport" ? endingOf(person?.passportNumberMasked) ?? r.ending : r.ending;
      const result: Result = {
        ...r, personId, holder: firstOf(person, f), self: !!person?.isSelf, ending, validTo: f.expiry, old: null,
        case: tap.choice === "replace" ? "replaced" : tap.choice === "booking_only" ? "booking_only" : "saved",
        expiry: f.kind === "passport" ? expiryFor(f.expiry, trip, opts.today) : null,
      };
      const wipeAt = tap.choice === "booking_only"
        ? new Date(trip ? Date.parse(`${trip.endDate ?? trip.startDate}T23:59:59+03:00`) + DAY : Date.now() + BOOKING_ONLY_MS)
        : null;
      return reply(await finish(tap.choice === "booking_only" ? "booking_only" : "confirmed", result, { personId, documentId, wipeAt }));
    }
  }
}

/* ───────────── what the model reads ───────────── */

/** The documents sent in this chat in the last day, as the model may read them (§6.4). Null when there are none. */
export async function attachmentsContext(ownerId: string, threadId: string, now = new Date()): Promise<string | null> {
  const rows = await db.select({ id: appAskAttachments.id, result: appAskAttachments.result, status: appAskAttachments.status }).from(appAskAttachments)
    .where(and(eq(appAskAttachments.ownerId, ownerId), eq(appAskAttachments.threadId, threadId), gt(appAskAttachments.createdAt, new Date(now.getTime() - ATTACHMENT_KEEP_MS))))
    .orderBy(desc(appAskAttachments.createdAt)).limit(4);
  if (!rows.length) return null;
  return [
    "Documents sent in this chat (read by the app; the traveller decides on its card, never by typing; you never see or ask for numbers):",
    ...rows.map((x) => attachmentLine(x.id, x.result as Result, x.status)),
  ].join("\n");
}

export function attachmentLine(id: string, r: Result, status: string): string {
  const what = { have_it: "already on file (the same one)", renewed: "a newer one than the one on file", add: "new for this person", whose: "holder not known yet", consent: "someone else's: needs their OK", unreadable: "couldn't be read", used: "using the one on file", saved: "saved", replaced: "replaced the old one", booking_only: "for this booking only", discarded: "not kept" }[r.case];
  return `- attachment_id=${id} · ${r.kind}${r.holder ? ` · ${r.holder}` : ""}${r.ending ? ` · ending ${r.ending}` : ""}${r.validTo ? ` · valid to ${r.validTo.slice(0, 7)}` : ""} · ${what}${status === "read" && r.case !== "unreadable" ? " · waiting for their tap on the card" : ""}`;
}

/** For use_document: the attachment's state, owner-checked. */
export async function attachmentState(ownerId: string, id: string): Promise<{ status: string; result: Result } | null> {
  const [row] = await db.select({ status: appAskAttachments.status, result: appAskAttachments.result }).from(appAskAttachments).where(and(eq(appAskAttachments.id, id), eq(appAskAttachments.ownerId, ownerId)));
  return row ? { status: row.status, result: row.result as Result } : null;
}

/* ───────────── the documents job ───────────── */

/**
 * Hourly (jobs.ts "documents"): passports without a fingerprint get one (decrypted once); photos and read fields older
 * than 24 hours are deleted (an untapped card becomes "not kept"); "this booking only" numbers are wiped when due.
 */
export async function documentsJob(now = new Date()): Promise<Record<string, number>> {
  const missing = await db.select().from(appPeople).where(and(isNotNull(appPeople.passportNumberEnc), isNull(appPeople.passportFingerprint), isNull(appPeople.deletedAt))).limit(500);
  const fingerprinted = await fingerprintMissing(missing);

  const cutoff = new Date(now.getTime() - ATTACHMENT_KEEP_MS);
  const old = await db.select().from(appAskAttachments)
    .where(and(lte(appAskAttachments.createdAt, cutoff), or(isNotNull(appAskAttachments.fileId), isNotNull(appAskAttachments.fieldsEnc)))).limit(500);
  let filesDeleted = 0;
  for (const row of old) {
    if (row.fileId) { await dropFile(row.ownerId, row); filesDeleted += 1; }
    const r = row.result as Result;
    const open = row.status === "read";
    await db.update(appAskAttachments).set({
      fileId: null, fieldsEnc: null, ...(open ? { status: "discarded", decidedAt: now, result: { ...r, case: r.case === "unreadable" ? "unreadable" : "discarded", hasFile: false } } : { result: { ...r, hasFile: false } }),
    }).where(eq(appAskAttachments.id, row.id));
  }

  const due = await db.select({ id: appAskAttachments.id, personId: appAskAttachments.personId }).from(appAskAttachments)
    .where(and(eq(appAskAttachments.status, "booking_only"), lte(appAskAttachments.wipeAt, now))).limit(500);
  let wiped = 0;
  for (const d of due) {
    if (d.personId) {
      await db.update(appPeople).set({ passportNumberEnc: null, passportFingerprint: null, updatedAt: now }).where(eq(appPeople.id, d.personId));
      wiped += 1;
    }
    await db.update(appAskAttachments).set({ status: "wiped" }).where(eq(appAskAttachments.id, d.id));
  }
  return { fingerprinted, attachmentsCleared: old.length, filesDeleted, bookingOnlyWiped: wiped };
}
