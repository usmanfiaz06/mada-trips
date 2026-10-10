import {
  ACCESS_TOKEN_TTL_SECONDS, OTP_MAX_TRIES, OTP_RESEND_SECONDS, OTP_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS, ROUTES, checkSaudiMobile,
  firstNameOf, maskPassportNumber, t, tn, type AuthTokens, type ErrorCode, type Person, type User, ERROR_CODES, CreatePersonRequest,
  UpdateMeRequest, PassportInput,
} from '@mada/shared';
import type { Wire, WireResponse } from './api';
import { walletMock, walletSeed } from './mock/wallet';
import { bookingMock } from './mock/booking';
import { circlesMock } from './mock/circles';
import { tripsMock } from './mock/trips';
import { resilienceMock } from './mock/resilience';

/** Extra endpoints per area: each returns null for paths it doesn't own. `user` is the signed-in mock user (mutable). */
export type MockUser = User & { people: Person[] };
export type AreaMock = (w: Wire, ctx: { user: MockUser | null; byPhone: Map<string, string> }) => Promise<WireResponse | null>;
const AREA_MOCKS: AreaMock[] = [tripsMock, walletMock, circlesMock, bookingMock, resilienceMock];

/*
 * EXPO_PUBLIC_API_MODE=mock: the Core API's rules, in memory, for design work and screenshots without a server.
 * Same contract as platform/src/app/api/app/v1 (shared schemas), same edge cases: code 123456, 3 tries then locked,
 * 30 s before a new code, and the demo account +966 50 000 4127 ("Omar") that already exists.
 */

const users = new Map<string, MockUser>();
const byPhone = new Map<string, string>();
const access = new Map<string, { userId: string; exp: number }>();
const refresh = new Map<string, string>();
const otp = new Map<string, { sentAt: number; attempts: number; used: boolean }>();

const now = () => Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
const uuid = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

function err(code: ErrorCode, extra: Record<string, unknown> = {}, message?: string): WireResponse {
  return { status: ERROR_CODES[code].status, json: { error: { code, message: message ?? t(ERROR_CODES[code].copy, extra as Record<string, string | number>), ...extra } } };
}
const ok = (json: unknown, status = 200): WireResponse => ({ status, json });

function self(): Person {
  return { id: uuid(), isSelf: true, givenNames: '', surname: '', firstName: '', relation: 'self', dateOfBirth: null, sex: null, nationality: null, passport: null, createdAt: iso(now()) };
}

function newUser(phone: string | null, extra: Partial<User> = {}): MockUser {
  const u: MockUser = {
    id: uuid(), name: '', phone, email: null, emailRelay: false, locale: 'en', alerts: 'quiet', notifications: 'unknown',
    methods: { apple: false, google: false, phone: !!phone }, onboardedAt: null, createdAt: iso(now()), people: [self()], ...extra,
  };
  users.set(u.id, u);
  if (phone) byPhone.set(phone, u.id);
  return u;
}

// The demo account the prototype ships with.
walletSeed(newUser('+966500004127', { name: 'Omar', notifications: 'allowed', onboardedAt: '2026-04-01T09:00:00.000Z' }));

function issue(userId: string): AuthTokens {
  const a = `mock.${rid()}.${rid()}`;
  const r = `mrt_${rid()}${rid()}${rid()}`;
  access.set(a, { userId, exp: now() + ACCESS_TOKEN_TTL_SECONDS * 1000 });
  refresh.set(r, userId);
  return { accessToken: a, accessExpiresAt: iso(now() + ACCESS_TOKEN_TTL_SECONDS * 1000), refreshToken: r, refreshExpiresAt: iso(now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000) };
}

const userOf = (token?: string | null) => {
  const a = token ? access.get(token) : undefined;
  if (!a) return { error: err('UNAUTHORIZED') };
  if (a.exp < now()) return { error: err('TOKEN_EXPIRED') };
  return { user: users.get(a.userId)! };
};
const pub = ({ people: _p, ...u }: MockUser): User => u;
const delay = () => new Promise((r) => setTimeout(r, 250 + Math.random() * 250));

export async function mockTransport(w: Wire): Promise<WireResponse> {
  await delay();
  const body = (w.body ?? {}) as Record<string, unknown>;
  switch (`${w.method} ${w.path}`) {
    case `POST ${ROUTES.otpStart}`: {
      const p = checkSaudiMobile(String(body.phone ?? ''));
      if (!p.ok) return err('PHONE_INVALID', { fields: { phone: p.problem } });
      const prev = otp.get(p.e164);
      const wait = prev ? OTP_RESEND_SECONDS - Math.floor((now() - prev.sentAt) / 1000) : 0;
      if (wait > 0) return err('OTP_COOLDOWN', { retryAfter: wait }, t('error.otpCooldown', { seconds: wait }));
      otp.set(p.e164, { sentAt: now(), attempts: 0, used: false });
      console.info(`[mock sms] ${p.e164}: ${t('sms.otp', { code: '123456' })}`);
      return ok({ phone: p.e164, resendAfter: OTP_RESEND_SECONDS, expiresIn: OTP_TTL_SECONDS, length: 6 });
    }
    case `POST ${ROUTES.otpVerify}`: {
      const p = checkSaudiMobile(String(body.phone ?? ''));
      if (!p.ok) return err('PHONE_INVALID');
      const o = otp.get(p.e164);
      if (!o || o.used || now() - o.sentAt > OTP_TTL_SECONDS * 1000) return err('OTP_EXPIRED');
      if (o.attempts >= OTP_MAX_TRIES) return err('OTP_LOCKED', { triesLeft: 0 });
      if (body.code !== '123456') {
        o.attempts += 1;
        const left = OTP_MAX_TRIES - o.attempts;
        return left <= 0 ? err('OTP_LOCKED', { triesLeft: 0 }) : err('OTP_WRONG', { triesLeft: left }, tn('otp.wrong', left));
      }
      o.used = true;
      let user: MockUser;
      const current = w.token ? access.get(w.token) : undefined;
      if (current) {
        const owner = byPhone.get(p.e164);
        if (owner && owner !== current.userId) return err('PHONE_TAKEN');
        user = users.get(current.userId)!;
        user.phone = p.e164; user.methods.phone = true; byPhone.set(p.e164, user.id);
      } else {
        const id = byPhone.get(p.e164);
        user = id ? users.get(id)! : newUser(p.e164);
      }
      return ok({ tokens: issue(user.id), user: pub(user), isNew: !user.onboardedAt });
    }
    case `POST ${ROUTES.apple}`:
    case `POST ${ROUTES.google}`: {
      const provider = w.path === ROUTES.apple ? 'apple' : 'google';
      const sub = String(body.idToken ?? '');
      const found = [...users.values()].find((u) => u.methods[provider] && (u as MockUser & { sub?: string }).sub === sub);
      const user = found ?? Object.assign(newUser(null, {
        name: String(body.givenName ?? ''), email: provider === 'apple' ? `${rid()}@privaterelay.appleid.com` : 'you@gmail.com', emailRelay: provider === 'apple',
        methods: { apple: provider === 'apple', google: provider === 'google', phone: false },
      }), { sub });
      return ok({ tokens: issue(user.id), user: pub(user), isNew: !user.onboardedAt });
    }
    case `POST ${ROUTES.refresh}`: {
      const userId = refresh.get(String(body.refreshToken ?? ''));
      if (!userId) return err('UNAUTHORIZED');
      refresh.delete(String(body.refreshToken));
      return ok({ tokens: issue(userId) });
    }
    case `POST ${ROUTES.logout}`: {
      refresh.delete(String(body.refreshToken ?? ''));
      if (w.token) access.delete(w.token);
      return ok({ ok: true });
    }
    case `GET ${ROUTES.me}`: {
      const r = userOf(w.token);
      return r.error ?? ok({ user: pub(r.user) });
    }
    case `PATCH ${ROUTES.me}`: {
      const r = userOf(w.token);
      if (r.error) return r.error;
      const patch = UpdateMeRequest.safeParse(body);
      if (!patch.success) return err('VALIDATION');
      const { onboarded, name, ...rest } = patch.data;
      Object.assign(r.user, rest, name !== undefined ? { name: name.trim() } : null, onboarded && !r.user.onboardedAt ? { onboardedAt: iso(now()) } : null);
      return ok({ user: pub(r.user) });
    }
    case `GET ${ROUTES.people}`: {
      const r = userOf(w.token);
      return r.error ?? ok({ people: r.user.people.map((p) => (p.isSelf ? { ...p, firstName: firstNameOf(p.givenNames) || r.user.name } : p)) });
    }
    case `POST ${ROUTES.people}`: {
      const r = userOf(w.token);
      if (r.error) return r.error;
      const c = CreatePersonRequest.safeParse(body);
      if (!c.success) return err('VALIDATION');
      const pp = c.data.passport ? PassportInput.parse(c.data.passport) : null;
      const person: Person = {
        id: uuid(), isSelf: false, givenNames: c.data.givenNames, surname: c.data.surname, firstName: firstNameOf(c.data.givenNames), relation: c.data.relation,
        dateOfBirth: c.data.dateOfBirth ?? null, sex: c.data.sex ?? null, nationality: c.data.nationality ?? pp?.nationality ?? null,
        passport: pp ? { numberMasked: maskPassportNumber(pp.number), issuingCountry: pp.issuingCountry, nationality: pp.nationality, expiry: pp.expiry, source: pp.source, updatedAt: iso(now()) } : null,
        createdAt: iso(now()),
      };
      r.user.people.push(person);
      return ok({ person }, 201);
    }
    default: {
      // Area mocks (src/lib/mock/<area>.ts) answer their own paths.
      for (const area of AREA_MOCKS) {
        const r = await area(w, { user: w.token ? users.get(access.get(w.token)?.userId ?? '') ?? null : null, byPhone });
        if (r) return r;
      }
      return err('NOT_FOUND');
    }
  }
}
