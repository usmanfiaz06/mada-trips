import {
  CreateDocumentMeta, DESK_PHONE, ERROR_CODES, SavePassportRequest, SendSupportMessageRequest, TravelPrefs, UpdateAccountRequest,
  UpdatePersonRequest, checkSaudiMobile, firstNameOf, maskPassportNumber, supportIntent, supportReplies, t, tn,
  type Account, type CopyKey, type Credit, type Device, type ErrorCode, type ExportStatus, type Notification, type Person, type PersonDetails,
  type SavedCard, type SupportIntent, type SupportMessage, type SupportThread, type SupportTopic, type WalletDocument,
} from '@mada/shared';
import type { Wire, WireResponse } from '../api';
import type { AreaMock, MockUser } from '../mock-api';

/*
 * EXPO_PUBLIC_API_MODE=mock for the Wallet area: documents, the household, passports, account, cards, credit,
 * support and the inbox, in memory, with the Core API's rules (owner checks, 10 MB and type checks, the last sign-in
 * method, the default card, 30 days to delete). The demo account (+966 50 000 4127, "Omar") gets the prototype's
 * family, documents, cards and devices on first use.
 */

type Thread = SupportThread & { messages: SupportMessage[]; readAt: number };
type State = {
  docs: WalletDocument[];
  details: Record<string, PersonDetails>;
  account: Account;
  cards: SavedCard[];
  defaultId: string;
  credit: Credit['entries'];
  devices: Device[];
  consentHistory: { consent: 'marketing' | 'analytics'; granted: boolean; at: string }[];
  exportStatus: ExportStatus | null;
  threads: Thread[];
  inbox: (Notification & { readAt: string | null })[];
  emailCode: { email: string; tries: number } | null;
  phoneCode: { phone: string; tries: number } | null;
  files: Map<string, string>;
};

const states = new Map<string, State>();
const now = () => new Date().toISOString();
const uuid = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
const ok = (json: unknown, status = 200): WireResponse => ({ status, json });
function err(code: ErrorCode, opts: { message?: string; copy?: CopyKey; vars?: Record<string, string | number>; fields?: Record<string, string>; triesLeft?: number } = {}): WireResponse {
  const message = opts.message ?? t(opts.copy ?? ERROR_CODES[code].copy, opts.vars);
  return { status: ERROR_CODES[code].status, json: { error: { code, message, ...(opts.fields ? { fields: opts.fields } : null), ...(opts.triesLeft !== undefined ? { triesLeft: opts.triesLeft } : null) } } };
}
const fieldsOf = (issues: { path: PropertyKey[]; message: string }[]) => Object.fromEntries(issues.map((i) => [i.path.map(String).join('.') || '_', i.message]));

const DEFAULT_PREFS = { seat: 'any' as const, together: true, meal: 'halal' as const, assist: [], loyalty: [], notes: '' };
const blankDetails = (): PersonDetails => ({ relationLabel: null, meal: null, iqamaMasked: null, iqamaAt: null, exitVisa: { kind: 'none', until: null } });

function fresh(): State {
  return {
    docs: [], details: {}, cards: [], defaultId: 'applepay', credit: [], consentHistory: [], exportStatus: null, threads: [], inbox: [], emailCode: null, phoneCode: null, files: new Map(),
    account: { preferredName: null, preferredAt: null, home: 'RUH', homeAt: null, currency: 'SAR', arabicNotify: false, prefs: DEFAULT_PREFS, faceId: true, consents: { marketing: false, analytics: true }, photo: null, emailVerifiedAt: null, phoneVerifiedAt: null, deleteAt: null, exportRequestedAt: null },
    devices: [{ id: uuid(), name: 'This iPhone', platform: 'ios', current: true, lastUsedAt: now(), createdAt: now() }],
  };
}

/* ───────────── the demo family (prototype store.jsx demoAccount) ───────────── */

function person(p: Partial<Person> & { givenNames: string; surname: string; relation: Person['relation'] }, pp?: { number: string; nat: string; expiry: string }): Person {
  return {
    id: uuid(), isSelf: p.relation === 'self', firstName: firstNameOf(p.givenNames), dateOfBirth: null, sex: null, nationality: pp?.nat ?? null, createdAt: now(), ...p,
    passport: pp ? { numberMasked: maskPassportNumber(pp.number), issuingCountry: pp.nat, nationality: pp.nat, expiry: pp.expiry, source: 'scan', updatedAt: now() } : null,
  };
}

function seedDemo(u: MockUser, s: State) {
  const self = u.people[0]!;
  Object.assign(self, person({ givenNames: 'OMAR', surname: 'ALHARBI', relation: 'self', dateOfBirth: '1984-03-11', sex: 'M' }, { number: 'A08493141', nat: 'SAU', expiry: '2031-06-22' }), { id: self.id });
  const hessa = person({ givenNames: 'HESSA', surname: 'ALHARBI', relation: 'spouse', dateOfBirth: '1988-07-24', sex: 'F' }, { number: 'A11493107', nat: 'SAU', expiry: '2029-01-15' });
  const sara = person({ givenNames: 'SARA', surname: 'ALHARBI', relation: 'child', dateOfBirth: '2013-05-12', sex: 'F' }, { number: 'A23493196', nat: 'SAU', expiry: '2027-08-14' });
  const ahmed = person({ givenNames: 'AHMED', surname: 'ALHARBI', relation: 'child', dateOfBirth: '2016-09-03', sex: 'M' }, { number: 'A23493197', nat: 'SAU', expiry: '2030-03-21' });
  u.people.push(hessa, sara, ahmed);
  s.details[hessa.id] = { ...blankDetails(), relationLabel: 'Spouse' };
  s.details[sara.id] = { ...blankDetails(), relationLabel: 'Daughter', meal: 'child' };
  s.details[ahmed.id] = { ...blankDetails(), relationLabel: 'Son', meal: 'child' };
  const doc = (personId: string, kind: WalletDocument['kind'], title: string, detail: string): WalletDocument => ({ id: uuid(), personId, kind, title, detail, validUntil: null, fields: {}, file: null, source: 'setup', removable: false, sharedUntil: null, createdAt: now(), updatedAt: now() });
  s.docs.push(
    doc(self.id, 'national_id', 'National ID', 'Valid until 2030'), doc(self.id, 'visa', 'Schengen visa', 'Multi-entry until Jun 2028'),
    doc(hessa.id, 'national_id', 'National ID', 'Valid until 2031'), doc(hessa.id, 'visa', 'Schengen visa', 'Multi-entry until Jun 2028'),
    doc(sara.id, 'other', 'Family card entry', 'Valid'), doc(ahmed.id, 'other', 'Family card entry', 'Valid'),
  );
  const visa: SavedCard = { id: uuid(), brand: 'visa', label: 'Visa ending 41', last4: '4141', exp: '08/28', createdAt: now() };
  const mada: SavedCard = { id: uuid(), brand: 'mada', label: 'mada ending 07', last4: '8807', exp: '02/27', createdAt: now() };
  s.cards = [visa, mada];
  s.defaultId = visa.id;
  u.email = 'k7x2m9q4pz@privaterelay.appleid.com';
  u.emailRelay = true;
  u.methods.apple = true;
  s.account.prefs = { ...DEFAULT_PREFS, seat: 'window', loyalty: [{ id: 'l1', program: 'alfursan', number: '48213377' }] };
  const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  s.devices.push({ id: uuid(), name: 'iPad', platform: 'ios', current: false, lastUsedAt: ago(2), createdAt: ago(90) }, { id: uuid(), name: 'madatrips.sa on a Mac', platform: 'web', current: false, lastUsedAt: ago(21), createdAt: ago(120) });
}

function stateOf(u: MockUser): State {
  let s = states.get(u.id);
  if (!s) {
    s = fresh();
    states.set(u.id, s);
    if (u.phone === '+966500004127') seedDemo(u, s);
  }
  return s;
}

/** mock-api calls this once for the demo account, so the family is there before the first /people. */
export function walletSeed(u: MockUser) { stateOf(u); }

/* ───────────── helpers ───────────── */

const balance = (s: State) => s.credit.reduce((a, e) => a + e.amount, 0);
const cardsJson = (s: State) => ({ cards: s.cards, defaultId: s.cards.some((c) => c.id === s.defaultId) ? s.defaultId : 'applepay' });
const creditJson = (s: State) => ({ balance: { amount: balance(s), currency: 'SAR' }, entries: [...s.credit].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
const threadJson = ({ messages: _m, readAt: _r, ...th }: Thread) => th;
const unreadOf = (th: Thread) => th.messages.filter((m) => m.author.kind !== 'user' && Date.parse(m.createdAt) > th.readAt).length;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const UPLOAD_OK = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf'];
const TITLE: Record<WalletDocument['kind'], CopyKey> = { passport: 'docs.title.passport', visa: 'docs.title.visa', national_id: 'docs.title.national_id', iqama: 'docs.title.iqama', exit_reentry: 'docs.title.exit_reentry', insurance: 'docs.title.insurance', other: 'docs.title.other' };
const TOPIC_INTENT: Record<SupportTopic, SupportIntent> = { change: 'change', refund: 'refund', bag: 'bag', docs: 'docs', airport: 'airport', other: 'other' };
const TOPIC_KEY: Record<SupportTopic, CopyKey> = { change: 'support.topic.change', refund: 'support.topic.refund', bag: 'support.topic.bag', docs: 'support.topic.docs', airport: 'support.topic.airport', other: 'support.topic.other' };

type Upload = { __file?: { name: string; type: string; size: number; uri: string }; meta?: unknown };
function checkFile(f: Upload['__file'], allow = UPLOAD_OK): WireResponse | null {
  if (!f) return err('VALIDATION', { fields: { file: 'missing' } });
  if (f.size > 10 * 1024 * 1024) return err('VALIDATION', { copy: 'error.documentSize', fields: { file: 'too_big' } });
  if (!allow.includes(f.type)) return err('VALIDATION', { copy: 'error.documentType', fields: { file: 'type' } });
  return null;
}

/** Riyadh hour 22:00–08:00: Noura covers for Faisal (the desk's presence contract). */
function presence() {
  const h = (new Date().getUTCHours() + 3) % 24;
  const night = h >= 22 || h < 8;
  const faisal = { id: 'faisal', name: 'Faisal', initial: 'F', photoUrl: null, languages: ['en', 'ar'] };
  const noura = { id: 'noura', name: 'Noura', initial: 'N', photoUrl: null, languages: ['en', 'ar'] };
  const agent = night ? noura : faisal;
  return {
    title: 'Mada', agent, usual: night ? faisal : null, covering: night, online: true, typing: false, replyMinutes: 2,
    line: night ? t('presence.covering', { agent: 'Noura', usual: 'Faisal', pronoun: 'She' }) : `${t('presence.online', { agent: 'Faisal' })} · ${t('presence.replies', { minutes: 2 })}`,
  };
}

/* ───────────── the handler ───────────── */

export const walletMock: AreaMock = async (w: Wire, { user, byPhone }) => {
  const [path, query = ''] = w.path.split('?');
  const q = new URLSearchParams(query);
  const m = (re: RegExp) => re.exec(path!);
  const owned = /^\/(documents|people\/[^/]+(\/passport)?|passport|account|me\/(email|phone|methods)|consents|export|cards|credit|support|notifications)/.test(path!);
  if (!owned) return null;
  // /people (GET, POST) is M0's.
  if (path === '/people') return null;
  if (!user) return err('UNAUTHORIZED');
  const s = stateOf(user);
  const body = (w.body ?? {}) as Record<string, unknown>;
  const key = `${w.method} ${path}`;
  const ownPerson = (id: string) => user.people.find((p) => p.id === id) ?? null;

  /* documents */
  if (key === 'GET /documents') {
    const pid = q.get('personId');
    return ok({ documents: s.docs.filter((d) => !pid || d.personId === pid) });
  }
  if (key === 'POST /documents') {
    const up = body as Upload;
    if (up.__file) { const bad = checkFile(up.__file); if (bad) return bad; }
    const parsed = CreateDocumentMeta.safeParse(up.__file ? up.meta : body);
    if (!parsed.success) return err('VALIDATION', { fields: fieldsOf(parsed.error.issues) });
    const meta = parsed.data;
    if (!ownPerson(meta.personId)) return err('NOT_FOUND');
    const old = meta.replaces ? s.docs.find((d) => d.id === meta.replaces) : null;
    if (meta.replaces && !old) return err('NOT_FOUND');
    const fileId = up.__file ? uuid() : null;
    if (fileId && up.__file) s.files.set(fileId, up.__file.uri);
    const doc: WalletDocument = {
      id: uuid(), personId: meta.personId, kind: meta.kind, title: meta.title ?? t(TITLE[meta.kind]),
      detail: meta.detail ?? (meta.validUntil ? t('wallet.docs.validUntil', { date: `${MONTHS[Number(meta.validUntil.slice(5, 7)) - 1]} ${meta.validUntil.slice(0, 4)}` }) : t('wallet.docs.added')),
      validUntil: meta.validUntil ?? null, fields: meta.fields ?? {}, file: fileId && up.__file ? { id: fileId, name: up.__file.name, mime: up.__file.type, size: up.__file.size } : null,
      source: meta.source, removable: true, sharedUntil: null, createdAt: now(), updatedAt: now(),
    };
    s.docs = [...s.docs.filter((d) => d.id !== old?.id), doc];
    return ok({ document: doc }, 201);
  }
  let r = m(/^\/documents\/([^/]+)$/);
  if (r) {
    const d = s.docs.find((x) => x.id === r![1]);
    if (!d) return err('NOT_FOUND');
    if (w.method === 'GET') return ok({ document: d });
    if (w.method === 'DELETE') {
      if (!d.removable) return err('FORBIDDEN', { copy: 'wallet.docs.setup' });
      s.docs = s.docs.filter((x) => x.id !== d.id);
      return ok({ ok: true });
    }
  }
  r = m(/^\/documents\/([^/]+)\/share$/);
  if (r) {
    const d = s.docs.find((x) => x.id === r![1]);
    if (!d) return err('NOT_FOUND');
    if (w.method === 'DELETE') { d.sharedUntil = null; return ok({ ok: true }); }
    const until = new Date(Date.now() + 30 * 86_400_000).toISOString();
    d.sharedUntil = until;
    return ok({ grant: { id: uuid(), documentId: d.id, tripId: (body.tripId as string) ?? null, expiresAt: until, revokedAt: null, createdAt: now() } }, 201);
  }

  /* people and passports */
  r = m(/^\/people\/([^/]+)$/);
  if (r) {
    const p = ownPerson(r[1]!);
    if (!p) return err('NOT_FOUND');
    const details = () => s.details[p.id] ?? blankDetails();
    const out = () => ok({ person: p.isSelf ? { ...p, firstName: p.firstName || user.name } : p, details: details() });
    if (w.method === 'GET') return out();
    if (w.method === 'DELETE') {
      if (p.isSelf) return err('FORBIDDEN');
      user.people = user.people.filter((x) => x.id !== p.id);
      s.docs = s.docs.filter((d) => d.personId !== p.id);
      delete s.details[p.id];
      return ok({ ok: true });
    }
    if (w.method === 'PATCH') {
      const patch = UpdatePersonRequest.safeParse(body);
      if (!patch.success) return err('VALIDATION', { fields: fieldsOf(patch.error.issues) });
      const d = { ...details() };
      const v = patch.data;
      if (v.relationLabel !== undefined) d.relationLabel = v.relationLabel;
      if (v.meal !== undefined) d.meal = v.meal;
      if (v.iqama !== undefined) { d.iqamaMasked = v.iqama ? `${v.iqama.slice(0, 1)}•••••${v.iqama.slice(-4)}` : null; d.iqamaAt = v.iqama ? now() : null; }
      if (v.exitVisa !== undefined) d.exitVisa = { kind: v.exitVisa.kind, until: v.exitVisa.kind === 'none' ? null : v.exitVisa.until };
      s.details[p.id] = d;
      return out();
    }
  }
  r = m(/^\/people\/([^/]+)\/passport$/) ?? (path === '/passport' ? (['', user.people.find((p) => p.isSelf)!.id] as unknown as RegExpExecArray) : null);
  if (r && w.method === 'PUT') {
    const p = ownPerson(r[1]!);
    if (!p) return err('NOT_FOUND');
    const v = SavePassportRequest.safeParse(body);
    if (!v.success) return err('VALIDATION', { fields: fieldsOf(v.error.issues) });
    const pp = v.data.passport;
    const number = pp.number.toUpperCase();
    Object.assign(p, {
      givenNames: v.data.givenNames.toUpperCase(), surname: v.data.surname.toUpperCase(), firstName: firstNameOf(v.data.givenNames), dateOfBirth: v.data.dateOfBirth,
      sex: v.data.sex ?? p.sex, nationality: pp.nationality,
      passport: { numberMasked: maskPassportNumber(number), issuingCountry: pp.issuingCountry, nationality: pp.nationality, expiry: pp.expiry, source: pp.source ?? 'manual', updatedAt: now() },
    });
    if (p.isSelf && !user.name) user.name = firstNameOf(v.data.givenNames);
    return ok({ person: p, details: s.details[p.id] ?? blankDetails() });
  }

  /* account */
  if (key === 'GET /account') return ok({ account: s.account });
  if (key === 'PATCH /account') {
    const v = UpdateAccountRequest.safeParse(body);
    if (!v.success) return err('VALIDATION', { fields: fieldsOf(v.error.issues) });
    const p = v.data;
    const a = s.account;
    if (p.preferredName !== undefined) { a.preferredName = p.preferredName; a.preferredAt = p.preferredName ? now() : null; }
    if (p.home) { a.home = p.home; a.homeAt = now(); }
    if (p.currency) a.currency = p.currency;
    if (p.arabicNotify !== undefined) a.arabicNotify = p.arabicNotify;
    if (p.prefs) a.prefs = TravelPrefs.parse(p.prefs);
    if (p.faceId !== undefined) a.faceId = p.faceId;
    return ok({ account: a });
  }
  if (path === '/account/photo') {
    if (w.method === 'DELETE') { s.account.photo = null; s.files.delete('photo'); return ok({ account: s.account }); }
    if (w.method === 'PUT') {
      const up = body as Upload;
      const bad = checkFile(up.__file, ['image/jpeg', 'image/png', 'image/heic', 'image/webp']);
      if (bad) return bad;
      s.files.set('photo', up.__file!.uri);
      s.account.photo = { updatedAt: now() };
      return ok({ account: s.account });
    }
  }
  if (key === 'GET /account/devices') return ok({ devices: s.devices });
  if (key === 'POST /account/devices/signout-all') { s.devices = s.devices.filter((d) => d.current); return ok({ ok: true }); }
  r = m(/^\/account\/devices\/([^/]+)$/);
  if (r && w.method === 'DELETE') {
    if (!s.devices.some((d) => d.id === r![1])) return err('NOT_FOUND');
    s.devices = s.devices.filter((d) => d.id !== r![1]);
    return ok({ ok: true });
  }
  if (path === '/account/deletion') {
    if (w.method === 'DELETE') { s.account.deleteAt = null; return ok({ deleteAt: null }); }
    if (body.confirm !== 'DELETE') return err('VALIDATION', { fields: { confirm: 'Type DELETE' } });
    s.account.deleteAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    return ok({ deleteAt: s.account.deleteAt });
  }

  /* email, phone, methods */
  const pubUser = () => { const { people: _p, ...u } = user; return u; };
  if (key === 'POST /me/email/start') {
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err('VALIDATION', { fields: { email: 'bad' } });
    if (user.email && user.email.toLowerCase() === email) return err('VALIDATION', { copy: 'account.email.same', fields: { email: 'same' } });
    s.emailCode = { email, tries: 0 };
    return ok({ to: email, resendAfter: 30, expiresIn: 600 });
  }
  if (key === 'POST /me/email/verify') {
    const c = s.emailCode;
    if (!c || c.email !== String(body.email ?? '').toLowerCase()) return err('OTP_EXPIRED');
    if (c.tries >= 3) return err('OTP_LOCKED', { triesLeft: 0 });
    if (body.code !== '123456') {
      c.tries += 1;
      const left = 3 - c.tries;
      return left <= 0 ? err('OTP_LOCKED', { triesLeft: 0 }) : err('OTP_WRONG', { triesLeft: left, message: tn('account.code.wrong', left) });
    }
    s.emailCode = null;
    user.email = c.email; user.emailRelay = false; s.account.emailVerifiedAt = now();
    return ok({ user: pubUser() });
  }
  if (key === 'POST /me/phone/start') {
    const p = checkSaudiMobile(String(body.phone ?? ''));
    if (!p.ok) return err('PHONE_INVALID', { fields: { phone: p.problem } });
    if (p.e164 === user.phone) return err('VALIDATION', { copy: 'account.phone.same', fields: { phone: 'same' } });
    if (p.e164 === '+966555555555' || (byPhone.has(p.e164) && byPhone.get(p.e164) !== user.id)) return err('PHONE_TAKEN', { copy: 'account.phone.taken' });
    s.phoneCode = { phone: p.e164, tries: 0 };
    return ok({ to: p.e164, resendAfter: 30, expiresIn: 600 });
  }
  if (key === 'POST /me/phone/verify') {
    const p = checkSaudiMobile(String(body.phone ?? ''));
    const c = s.phoneCode;
    if (!p.ok || !c || c.phone !== p.e164) return err('OTP_EXPIRED');
    if (c.tries >= 3) return err('OTP_LOCKED', { triesLeft: 0 });
    if (body.code !== '123456') {
      c.tries += 1;
      const left = 3 - c.tries;
      return left <= 0 ? err('OTP_LOCKED', { triesLeft: 0 }) : err('OTP_WRONG', { triesLeft: left, message: tn('otp.wrong', left) });
    }
    if (user.phone) byPhone.delete(user.phone);
    user.phone = p.e164; user.methods.phone = true; byPhone.set(p.e164, user.id); s.phoneCode = null; s.account.phoneVerifiedAt = now();
    return ok({ user: pubUser() });
  }
  r = m(/^\/me\/methods\/(apple|google|phone)$/);
  if (r) {
    const prov = r[1] as 'apple' | 'google' | 'phone';
    if (w.method === 'POST' && prov !== 'phone') { user.methods[prov] = true; return ok({ user: pubUser() }); }
    if (w.method === 'DELETE') {
      if (!user.methods[prov]) return err('NOT_FOUND');
      if (Object.values(user.methods).filter(Boolean).length <= 1) return err('FORBIDDEN', { copy: 'error.lastMethod' });
      user.methods[prov] = false;
      if (prov === 'phone' && user.phone) { byPhone.delete(user.phone); user.phone = null; }
      return ok({ user: pubUser() });
    }
  }

  /* consents and the copy */
  if (path === '/consents') {
    if (w.method === 'PATCH') {
      for (const k of ['marketing', 'analytics'] as const) {
        if (typeof body[k] === 'boolean' && body[k] !== s.account.consents[k]) {
          s.account.consents = { ...s.account.consents, [k]: body[k] };
          s.consentHistory.unshift({ consent: k, granted: body[k] as boolean, at: now() });
        }
      }
    }
    return ok({ consents: s.account.consents, history: s.consentHistory });
  }
  if (path === '/export') {
    if (w.method === 'POST') {
      if (!user.email) return err('VALIDATION', { copy: 'error.emailNeeded', fields: { email: 'missing' } });
      if (!s.exportStatus || Date.now() - Date.parse(s.exportStatus.requestedAt) > 86_400_000) {
        s.exportStatus = { id: uuid(), status: 'pending', email: user.email, requestedAt: now(), readyAt: null, expiresAt: null };
        s.account.exportRequestedAt = s.exportStatus.requestedAt;
      }
      return ok({ export: s.exportStatus }, 202);
    }
    return ok({ export: s.exportStatus });
  }

  /* cards and credit */
  if (key === 'GET /cards') return ok(cardsJson(s));
  if (key === 'POST /cards') {
    const brand = String(body.brand ?? '') as SavedCard['brand'];
    const last4 = String(body.last4 ?? '');
    const exp = String(body.exp ?? '');
    const [mm, yy] = exp.split('/').map(Number) as [number, number];
    const d = new Date();
    if (!/^\d{2}\/\d{2}$/.test(exp) || mm < 1 || mm > 12 || 2000 + yy < d.getFullYear() || (2000 + yy === d.getFullYear() && mm < d.getMonth() + 1)) return err('VALIDATION', { copy: 'cards.problem.expired', fields: { exp: 'expired' } });
    const card: SavedCard = { id: uuid(), brand, last4, exp, label: t('cards.label', { brand: brand === 'visa' ? 'Visa' : brand === 'mastercard' ? 'Mastercard' : 'mada', last: last4.slice(-2) }), createdAt: now() };
    s.cards.push(card);
    if (body.makeDefault !== false) s.defaultId = card.id;
    return ok(cardsJson(s), 201);
  }
  if (key === 'PUT /cards/default') {
    const id = String(body.id ?? '');
    if (id !== 'applepay' && !s.cards.some((c) => c.id === id)) return err('NOT_FOUND');
    s.defaultId = id;
    return ok(cardsJson(s));
  }
  r = m(/^\/cards\/([^/]+)$/);
  if (r && w.method === 'DELETE') {
    const id = r[1]!;
    if (!s.cards.some((c) => c.id === id)) return err('NOT_FOUND');
    const others = s.cards.filter((c) => c.id !== id);
    if (cardsJson(s).defaultId === id) {
      const nd = q.get('newDefault');
      if (others.length && !nd) return err('VALIDATION', { copy: 'error.defaultCard', fields: { newDefault: 'required' } });
      s.defaultId = nd ?? 'applepay';
    }
    s.cards = others;
    return ok(cardsJson(s));
  }
  if (key === 'GET /credit') return ok({ credit: creditJson(s) });
  if (key === 'POST /credit/move') {
    const card = s.cards.find((c) => c.id === body.cardId);
    if (!card) return err('NOT_FOUND');
    const b = balance(s);
    if (b <= 0) return err('VALIDATION', { copy: 'money.credit.nothing' });
    s.credit.push({ id: uuid(), amount: -b, kind: 'adjustment', note: `Moved to ${card.label}`, createdAt: now() });
    return ok({ credit: creditJson(s), moved: b, to: card.label });
  }

  /* support */
  if (key === 'GET /support/presence') return ok(presence());
  if (key === 'GET /support/unread') return ok({ unread: s.threads.reduce((a, th) => a + unreadOf(th), 0) });
  if (key === 'GET /support/threads') return ok({ threads: s.threads.map((th) => ({ ...threadJson(th), unread: unreadOf(th) })) });
  if (key === 'POST /support/threads') {
    const tripId = (body.tripId as string | undefined) ?? null;
    let th = s.threads.find((x) => x.tripId === tripId);
    if (!th) {
      th = { id: uuid(), tripId, about: (body.about as string | undefined) ?? t('support.aboutAccount'), status: 'open', unread: 0, lastMessageAt: null, createdAt: now(), messages: [], readAt: 0 };
      s.threads.push(th);
    }
    return ok({ thread: { ...threadJson(th), unread: unreadOf(th) }, messages: th.messages });
  }
  r = m(/^\/support\/threads\/([^/]+)(\/messages|\/attachments|\/read)?$/);
  if (r) {
    const th = s.threads.find((x) => x.id === r![1]);
    if (!th) return err('NOT_FOUND');
    if (w.method === 'GET' && !r[2]) return ok({ thread: { ...threadJson(th), unread: unreadOf(th) }, messages: th.messages });
    if (r[2] === '/read') { th.readAt = Date.now(); return ok({ ok: true }); }
    let at = Date.now();
    const msg = (author: SupportMessage['author'], text: string, card: SupportMessage['card'] = null, extra: Partial<SupportMessage> = {}): SupportMessage => {
      at += 1;
      return { id: uuid(), threadId: th.id, author, body: text, card, attachment: null, clientId: null, createdAt: new Date(at).toISOString(), ...extra };
    };
    const me = (text: string, card: SupportMessage['card'] = null, extra: Partial<SupportMessage> = {}) => msg({ kind: 'user', id: user.id, name: user.name }, text, card, extra);
    const ctx = { trip: null, refund: null, deskPhone: DESK_PHONE };
    const mada = (rs: ReturnType<typeof supportReplies>) => rs.map((x) => msg({ kind: 'mada' }, x.body, x.card ?? null));
    let out: SupportMessage[];
    if (r[2] === '/attachments') {
      const up = body as Upload;
      const bad = checkFile(up.__file);
      if (bad) return bad;
      const clientId = ((up.meta ?? {}) as { clientId?: string }).clientId ?? null;
      const fileId = uuid();
      s.files.set(fileId, up.__file!.uri);
      const mine = me(up.__file!.type === 'application/pdf' ? t('support.pdf', { name: up.__file!.name }) : '', { intent: 'photo' }, { attachment: { id: fileId, name: up.__file!.name, mime: up.__file!.type, size: up.__file!.size }, clientId });
      const open = [...th.messages].reverse().find((x) => x.card?.form === 'bag' && !x.card.filed);
      if (open) open.card = { ...open.card, filed: true };
      out = [mine, ...mada(open ? supportReplies({ kind: 'bag', ref: 'SV 482913', to: th.tripId ? 'Our hotel' : 'Home' }, ctx) : supportReplies({ kind: 'intent', intent: 'photo', text: '' }, ctx))];
    } else {
      const v = SendSupportMessageRequest.safeParse(body);
      if (!v.success) return err('VALIDATION', { fields: fieldsOf(v.error.issues) });
      const req = v.data;
      if (req.clientId) {
        const seen = th.messages.findIndex((x) => x.clientId === req.clientId);
        if (seen >= 0) return ok({ messages: th.messages.slice(seen, seen + 3) }, 201);
      }
      if (req.reply) {
        const target = th.messages.find((x) => x.id === req.reply!.messageId);
        const choice = target?.card?.choices?.find((c) => c.key === req.reply!.choice);
        if (!target || !choice) return err('VALIDATION', { fields: { 'reply.choice': 'Not one of the choices' } });
        target.card = { ...target.card, picked: choice.key };
        out = [me(choice.label), ...mada(supportReplies({ kind: 'pick', choice: choice.key, label: choice.label }, ctx))];
      } else if (req.bag) {
        if ('none' in req.bag) {
          const target = th.messages.find((x) => x.id === (req.bag as { messageId: string }).messageId);
          if (target) target.card = { ...target.card, filed: true };
          out = [me(t('support.reply.bagNoneSaid')), ...mada(supportReplies({ kind: 'bagNone' }, ctx))];
        } else {
          const target = req.bagFor ? th.messages.find((x) => x.id === req.bagFor) : null;
          if (target) target.card = { ...target.card, filed: true };
          const ref = req.bag.ref.trim().toUpperCase();
          out = [me(t('support.bag.summary', { ref, kind: req.bag.kind.toLowerCase(), to: req.bag.to.toLowerCase() })), ...mada(supportReplies({ kind: 'bag', ref, to: req.bag.to }, ctx))];
        }
      } else if (req.rating) {
        out = [me(t(req.rating === 'yes' ? 'support.rate.yesSaid' : 'support.rate.noSaid'), { rated: true })];
        if (req.rating === 'not_yet') out.push(...mada(supportReplies({ kind: 'intent', intent: 'other', text: '' }, ctx)));
      } else {
        const intent: SupportIntent = req.topic ? TOPIC_INTENT[req.topic] : supportIntent(req.body);
        const text = req.body || (req.topic ? t(TOPIC_KEY[req.topic]) : '');
        const replies = supportReplies({ kind: 'intent', intent, text }, ctx);
        out = [me(text, { intent }, { clientId: req.clientId ?? null }), ...mada(replies)];
      }
    }
    th.messages.push(...out);
    th.lastMessageAt = out[out.length - 1]!.createdAt;
    return ok({ messages: out }, 201);
  }

  /* inbox (the Trips area owns notifications; this answers until its endpoint lands) */
  if (key === 'GET /notifications') return ok({ notifications: s.inbox });
  if (key === 'POST /notifications/read') {
    const ids = (body.ids as string[] | undefined) ?? s.inbox.map((n) => n.id);
    s.inbox = s.inbox.map((n) => (ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now() } : n));
    return ok({ ok: true });
  }
  return null;
};

/** For the demo and the web e2e (mock mode only): what the desk or a refund would normally do. */
export const walletMockTools = {
  /** Mada credit for every signed-in mock account, as a refund taken as credit. */
  addCredit(amount: number, note: string) {
    for (const s of states.values()) s.credit.push({ id: uuid(), amount, kind: 'refund', note, createdAt: now() });
  },
  /** A notification in every mock inbox. */
  notify(n: { kind: Notification['kind']; title: string; body: string }) {
    for (const s of states.values()) s.inbox.unshift({ id: uuid(), level: 'active', href: null, readAt: null, createdAt: now(), ...n });
  },
  /** A reply from a named person at the desk, in the newest conversation. */
  agentReply(name: string, body: string) {
    for (const s of states.values()) {
      const th = s.threads[s.threads.length - 1];
      if (!th) continue;
      th.messages.push({ id: uuid(), threadId: th.id, author: { kind: 'agent', id: name.toLowerCase(), name, photoUrl: null }, body, card: null, attachment: null, clientId: null, createdAt: now() });
      th.lastMessageAt = now();
    }
  },
};
(globalThis as { __madaWallet?: typeof walletMockTools }).__madaWallet = walletMockTools;
