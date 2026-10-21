import {
  AskAttachmentMeta, AskDocTap, ERROR_CODES, dmyToIso, docLabel, endingOf, firstNameOf, fullDay, localeOr, maskPassportNumber, parseMrz, t,
  type AskAttachmentResponse, type AskDocCase, type ChatDocCard, type CopyKey, type ErrorCode, type Person,
} from '@mada/shared';
import type { WireResponse } from '../api';
import type { AreaMock, MockUser } from '../mock-api';
import { demoThread, recordDemoLine } from './ask-threads';

/*
 * EXPO_PUBLIC_API_MODE=mock for documents in Ask: the same contract as platform/src/app/api/app/v1/ask/attachments
 * (docs/app/ASK-INTEGRATED.md §6), in memory. The mock household keeps only masked numbers, so "the same passport" here
 * is the same mask, issuer and date of birth (the server compares a fingerprint of the full number).
 */

type Read = { kind: 'passport' | 'visa' | 'id'; given: string; surname: string; number: string; issuer: string; nationality: string; dob: string | null; expiry: string | null; sex: string | null };
type Att = { id: string; user: string; threadId: string; lang: 'en' | 'ar'; read: Read | null; card: ChatDocCard; status: 'read' | 'done'; self: boolean };

const store = new Map<string, Att>();
const ok = (json: unknown, status = 200): WireResponse => ({ status, json });
const err = (code: ErrorCode): WireResponse => ({ status: ERROR_CODES[code].status, json: { error: { code, message: t(ERROR_CODES[code].copy) } } });
const uuid = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
const key = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z]/g, '');

function readLines(lines: string[] | null | undefined): Read | null {
  if (!lines?.length) return null;
  const r = parseMrz(lines);
  if (!r.ok || !r.fields) return null;
  const f = r.fields;
  const c = f.type.charAt(0);
  const kind = c === 'P' ? 'passport' : c === 'V' ? 'visa' : 'id';
  return { kind, given: f.given, surname: f.surname, number: f.number.toUpperCase(), issuer: f.issuer, nationality: f.nationalityCode, dob: dmyToIso(f.dob), expiry: dmyToIso(f.expiry), sex: f.sex || null };
}

const samePerson = (p: Person, f: Read) => !!p.dateOfBirth && p.dateOfBirth === f.dob && key(p.surname) === key(f.surname) && key(p.givenNames.split(/\s+/)[0]) === key(f.given.split(/\s+/)[0]);
const consent = (p: Person | null) => !p || (!p.isSelf && ['friend', 'colleague', 'helper'].includes(p.relation));

function decide(user: MockUser, f: Read, chosen: Person | null = null): Omit<ChatDocCard, 'type' | 'attachmentId' | 'people' | 'hasFile' | 'expiry'> & { self: boolean } {
  const base = { kind: f.kind, ending: endingOf(maskPassportNumber(f.number)), validTo: f.expiry, old: null };
  const masked = maskPassportNumber(f.number);
  const pool = chosen ? [chosen] : user.people;
  const same = pool.find((p) => p.passport?.numberMasked === masked && p.passport.issuingCountry === f.issuer && (!p.dateOfBirth || p.dateOfBirth === f.dob));
  if (same) return { ...base, case: 'have_it', holder: same.firstName || firstNameOf(f.given), personId: same.id, self: same.isSelf, validTo: same.passport!.expiry };
  const named = chosen ? [chosen] : user.people.filter((p) => samePerson(p, f));
  if (named.length === 1) {
    const p = named[0]!;
    if (p.passport) return { ...base, case: 'renewed', holder: p.firstName, personId: p.id, self: p.isSelf, old: { ending: endingOf(p.passport.numberMasked), validTo: p.passport.expiry } };
    return { ...base, case: consent(p) ? 'consent' : 'add', holder: p.firstName || firstNameOf(f.given), personId: p.id, self: p.isSelf };
  }
  return { ...base, case: 'whose', holder: firstNameOf(f.given) || null, personId: null, self: false };
}

function say(c: ChatDocCard, self: boolean, lang: 'en' | 'ar'): string {
  const v = { name: c.holder ?? '', ending: c.ending ?? '', date: c.validTo ? fullDay(c.validTo, lang) : '', old: c.old?.ending ?? '' };
  const who = self ? 'self' : 'other';
  const k: Record<AskDocCase, CopyKey> = {
    have_it: `doc.say.haveIt.${who}`, renewed: 'doc.say.renewed', add: `doc.say.add.${who}`, consent: 'doc.say.consent',
    whose: c.kind === 'visa' ? 'doc.say.whose.visa' : c.kind === 'id' ? 'doc.say.whose.id' : 'doc.say.whose.passport', unreadable: 'doc.say.unreadable',
    used: `doc.say.used.${who}`, saved: `doc.say.saved.${who}`, replaced: 'doc.say.replaced', booking_only: 'doc.say.bookingOnly', discarded: 'doc.say.discarded',
  };
  return t(k[c.case], v, lang);
}

const words = (lang: 'en' | 'ar') => ({ passport: t('doc.kind.passport', undefined, lang), visa: t('doc.kind.visa', undefined, lang), id: t('doc.kind.id', undefined, lang), other: t('doc.kind.other', undefined, lang) });

function respond(user: MockUser, a: Att): WireResponse {
  const people = a.card.case === 'whose' ? user.people.slice(0, 8).map((p) => ({ id: p.id, name: p.isSelf ? t('doc.whose.me', undefined, a.lang) : p.firstName })).filter((p) => p.name) : [];
  const card = { ...a.card, people };
  const out: AskAttachmentResponse = { threadId: a.threadId, card, say: say(card, a.self, a.lang), next: [], label: a.read ? docLabel(card.kind, card.holder, card.ending, words(a.lang)) : t('doc.me.photo', undefined, a.lang) };
  return ok(out);
}

export const askDocsMock: AreaMock = async (w, ctx) => {
  const path = w.path.split('?')[0]!;
  if (path !== '/ask/attachments' && !path.startsWith('/ask/attachments/')) return null;
  if (!ctx.user) return err('UNAUTHORIZED');
  const user = ctx.user;
  const body = (w.body ?? {}) as Record<string, unknown>;
  if (w.method === 'POST' && path === '/ask/attachments') {
    // A file comes as { __file, meta } (wallet.ts multipart); the lines alone as the meta itself.
    const metaRaw = '__file' in body ? body.meta : body;
    const m = AskAttachmentMeta.safeParse(metaRaw ?? {});
    if (!m.success) return err('VALIDATION');
    const lang: 'en' | 'ar' = localeOr() === 'ar' ? 'ar' : 'en';
    const threadId = demoThread(user, m.data.threadId ?? null, lang);
    const read = readLines(m.data.mrz);
    const id = uuid();
    const d = read ? decide(user, read) : null;
    const card: ChatDocCard = d
      ? { type: 'document', attachmentId: id, kind: d.kind, case: d.case, holder: d.holder, personId: d.personId, ending: d.ending, validTo: d.validTo, old: d.old, people: [], expiry: null, hasFile: '__file' in body && d.case !== 'have_it' }
      : { type: 'document', attachmentId: id, kind: 'other', case: 'unreadable', holder: null, personId: null, ending: null, validTo: null, old: null, people: [], expiry: null, hasFile: '__file' in body };
    const a: Att = { id, user: user.id, threadId, lang, read, card, status: 'read', self: !!d?.self };
    store.set(id, a);
    const res = respond(user, a);
    const r = res.json as AskAttachmentResponse;
    recordDemoLine(user, threadId, { who: 'me', text: r.label, at: new Date().toISOString(), attachment: { kind: card.kind, label: r.label } }, lang);
    recordDemoLine(user, threadId, { who: 'mada', text: r.say, cards: ['document'] }, lang);
    return res;
  }
  const id = path.slice('/ask/attachments/'.length);
  const a = store.get(id);
  if (!a || a.user !== user.id) return err('NOT_FOUND');
  if (w.method !== 'POST') return err('NOT_FOUND');
  const tap = AskDocTap.safeParse(body);
  if (!tap.success) return err('VALIDATION');
  if (a.status === 'done') return respond(user, a);
  const c = tap.data.choice;
  const f = a.read;
  const set = (patch: Partial<ChatDocCard>, done = false, self = a.self) => { a.card = { ...a.card, ...patch }; a.self = self; if (done) a.status = 'done'; };
  if (c === 'use') set({ case: 'used', hasFile: false }, true);
  else if (c === 'discard' || c === 'keep_old') set({ case: 'discarded', hasFile: false }, true);
  else if (c === 'not_mine') set({ case: 'whose', personId: null, old: null }, false, false);
  else if (c === 'new_person' && f) set({ case: 'consent', personId: null, holder: firstNameOf(f.given) || null, old: null }, false, false);
  else if (c === 'person' && f) {
    const p = user.people.find((x) => x.id === tap.data.personId);
    if (!p) return err('NOT_FOUND');
    const d = decide(user, f, p);
    set(d.case === 'whose' ? { case: consent(p) ? 'consent' : 'add', personId: p.id, holder: p.firstName || firstNameOf(f.given) } : { case: d.case, personId: d.personId, holder: d.holder, old: d.old, validTo: d.validTo }, false, p.isSelf);
  } else if ((c === 'add' || c === 'replace' || c === 'keep' || c === 'booking_only') && f) {
    let p = a.card.personId ? user.people.find((x) => x.id === a.card.personId) ?? null : null;
    if (!p) {
      p = { id: uuid(), isSelf: false, givenNames: f.given, surname: f.surname, firstName: firstNameOf(f.given), relation: 'friend', dateOfBirth: f.dob, sex: (f.sex as Person['sex']) ?? null, nationality: f.nationality, passport: null, createdAt: new Date().toISOString() };
      user.people.push(p);
    }
    if (f.kind === 'passport' && f.expiry) p.passport = { numberMasked: maskPassportNumber(f.number), issuingCountry: f.issuer, nationality: f.nationality, expiry: f.expiry, source: 'scan', updatedAt: new Date().toISOString() };
    set({ case: c === 'replace' ? 'replaced' : c === 'booking_only' ? 'booking_only' : 'saved', personId: p.id, holder: p.firstName, validTo: f.expiry, old: null, hasFile: false, ending: endingOf(maskPassportNumber(f.number)) }, true, p.isSelf);
  }
  const res = respond(user, a);
  recordDemoLine(user, a.threadId, { who: 'mada', text: (res.json as AskAttachmentResponse).say, cards: ['document'] }, a.lang);
  return res;
};
