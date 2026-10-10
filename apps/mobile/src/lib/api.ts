import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { z } from 'zod';
import {
  API_PREFIX, ApiErrorBody, MeResponse, OtpStartResponse, PeopleResponse, PersonResponse, RefreshResponse, ROUTES, SignInResponse,
  type CreatePersonRequest, type DeviceInfo, type ErrorCode, type UpdateMeRequest,
} from '@mada/shared';
import { API_MODE, API_ORIGIN } from './config';
import { mockTransport } from './mock-api';
import { useSession } from './session';
import { t } from './i18n';

/*
 * The Core API client. Plain JSON; every response is checked against the shared zod schema, so a contract drift
 * shows up as an error here instead of a blank screen. Access tokens refresh themselves once, single-flight.
 */

export type ClientErrorCode = ErrorCode | 'OFFLINE' | 'BAD_RESPONSE';

export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status: number,
    readonly extra: { triesLeft?: number; retryAfter?: number; fields?: Record<string, string> } = {},
  ) { super(message); }
}

export type Wire = { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; body?: unknown; token?: string | null };
export type WireResponse = { status: number; json: unknown };

async function httpTransport(w: Wire): Promise<WireResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}${API_PREFIX}${w.path}`, {
      method: w.method,
      headers: { Accept: 'application/json', ...(w.body !== undefined ? { 'Content-Type': 'application/json' } : null), ...(w.token ? { Authorization: `Bearer ${w.token}` } : null) },
      body: w.body !== undefined ? JSON.stringify(w.body) : undefined,
    });
  } catch {
    throw new ApiError('OFFLINE', t('error.offline'), 0);
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { throw new ApiError('BAD_RESPONSE', t('error.internal'), res.status); }
  return { status: res.status, json };
}

const transport = API_MODE === 'mock' ? mockTransport : httpTransport;

function toError(r: WireResponse): ApiError {
  const parsed = ApiErrorBody.safeParse(r.json);
  if (!parsed.success) return new ApiError('BAD_RESPONSE', t('error.internal'), r.status);
  const { code, message, ...extra } = parsed.data.error;
  return new ApiError(code, message, r.status, extra);
}

let refreshing: Promise<boolean> | null = null;

/** Swap the refresh token for a new pair. Concurrent callers share one attempt. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const s = useSession.getState();
    if (!s.tokens) return false;
    try {
      const r = await transport({ method: 'POST', path: ROUTES.refresh, body: { refreshToken: s.tokens.refreshToken } });
      if (r.status !== 200) {
        // The server refused the token (revoked, reused, expired): this device is signed out.
        if (r.status === 401) await s.clear();
        return false;
      }
      await s.setTokens(RefreshResponse.parse(r.json).tokens);
      return true;
    } catch {
      return false; // offline: keep the session, try again later
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function request<S extends z.ZodType>(w: Omit<Wire, 'token'> & { auth?: boolean }, schema: S): Promise<z.infer<S>> {
  const auth = w.auth ?? true;
  const send = () => transport({ ...w, token: auth ? useSession.getState().tokens?.accessToken : null });
  let r = await send();
  if (auth && r.status === 401 && (r.json as { error?: { code?: string } } | null)?.error?.code === 'TOKEN_EXPIRED') {
    if (await refreshSession()) r = await send();
  }
  if (r.status >= 400) {
    const e = toError(r);
    if (auth && r.status === 401 && (e.code === 'SESSION_REVOKED' || e.code === 'UNAUTHORIZED') && useSession.getState().tokens) await useSession.getState().clear();
    throw e;
  }
  const parsed = schema.safeParse(r.json);
  if (!parsed.success) {
    console.warn('[api] response did not match the contract', w.path, parsed.error.issues);
    throw new ApiError('BAD_RESPONSE', t('error.internal'), r.status);
  }
  return parsed.data;
}

export function deviceInfo(): DeviceInfo {
  return {
    platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
    name: (Constants.deviceName ?? undefined)?.slice(0, 80),
    appVersion: Constants.expoConfig?.version,
  };
}

export const api = {
  startOtp: (phone: string) => request({ method: 'POST', path: ROUTES.otpStart, body: { phone }, auth: false }, OtpStartResponse),
  /** Sends the access token when there is one: a phone added after Apple/Google sign-in joins that account. */
  verifyOtp: (phone: string, code: string) => request({ method: 'POST', path: ROUTES.otpVerify, body: { phone, code, device: deviceInfo() }, auth: !!useSession.getState().tokens }, SignInResponse),
  signInWith: (provider: 'apple' | 'google', idToken: string, givenName?: string) =>
    request({ method: 'POST', path: provider === 'apple' ? ROUTES.apple : ROUTES.google, body: { idToken, givenName, device: deviceInfo() }, auth: false }, SignInResponse),
  me: () => request({ method: 'GET', path: ROUTES.me }, MeResponse),
  updateMe: (patch: UpdateMeRequest) => request({ method: 'PATCH', path: ROUTES.me, body: patch }, MeResponse),
  people: () => request({ method: 'GET', path: ROUTES.people }, PeopleResponse),
  addPerson: (p: CreatePersonRequest) => request({ method: 'POST', path: ROUTES.people, body: p }, PersonResponse),
  async logout() {
    const s = useSession.getState();
    try {
      if (s.tokens) await transport({ method: 'POST', path: ROUTES.logout, body: { refreshToken: s.tokens.refreshToken }, token: s.tokens.accessToken });
    } finally {
      await s.clear();
    }
  },
};

/** For area clients (lib/<area>.ts): the same checked, refreshing request. */
export { request, transport };
