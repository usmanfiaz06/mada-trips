import { z } from 'zod';
import type { CopyKey } from '../copy/en';
import type { ErrorCode } from './errors';

/*
 * Resilience: what the app and the Core API agree on when things go wrong (FLOWS.md §12).
 *   GET /config   public, cached: versions, maintenance, feature switches, the server's clock.
 *   GET /status   public, cached: which suppliers are slow or not answering right now.
 * Every error is { error: { code, message, retryAfter?, details?, requestId? } } (errors.ts). The app adds its own
 * codes for things that never reach a server (CLIENT_ERROR_CODES), and `errorKind` sorts any code into the one
 * state the app shows for it.
 */

export const RESILIENCE_ROUTES = { config: '/config', status: '/status' } as const;

export const HEADERS = {
  /** Sent on mutations. The server answers a repeat with the first response instead of doing it twice. */
  idempotencyKey: 'Idempotency-Key',
  /** Set by the server on every response (and accepted from the app); logged with the request. */
  requestId: 'X-Request-Id',
  /** The app's version, e.g. "1.4.0". Below `minVersion` the server answers 426 UPGRADE_REQUIRED. */
  appVersion: 'X-App-Version',
  /** Set when a response was replayed from the idempotency store. */
  replayed: 'Idempotency-Replayed',
} as const;

export const MaintenanceSchema = z.object({
  on: z.boolean(),
  /** A finished sentence for the maintenance screen, or null for the catalogue's default. */
  message: z.string().max(200).nullable(),
  /** When booking opens again (ISO), if known. */
  until: z.string().nullable(),
});
export type Maintenance = z.infer<typeof MaintenanceSchema>;

export const ConfigResponse = z.object({
  /** Older apps are asked to update before anything else (426 on every request). */
  minVersion: z.string(),
  /** The newest version in the stores; older apps show a quiet "A new version is ready". */
  latestVersion: z.string(),
  maintenance: MaintenanceSchema,
  /** Feature switches. Unknown names are ignored by older apps. */
  features: z.record(z.string(), z.boolean()),
  /** The server's clock (ISO). Countdowns use it, never the phone's clock, which may be wrong. */
  serverTime: z.string(),
  /** Where "Update Mada" goes, per store. */
  storeUrls: z.object({ ios: z.string(), android: z.string() }),
});
export type ConfigResponse = z.infer<typeof ConfigResponse>;

export const SupplierStateSchema = z.enum(['up', 'degraded', 'down']);
export type SupplierState = z.infer<typeof SupplierStateSchema>;

export const SupplierHealth = z.object({
  /** The supplier slot: flights, hotels, payments, sms, … */
  name: z.string(),
  /** The traveller-facing name ("Saudia", "Card payments"), for "Saudia's system isn't answering." */
  label: z.string(),
  state: SupplierStateSchema,
  /** When it went into this state (ISO), or null when up. */
  since: z.string().nullable(),
});
export type SupplierHealth = z.infer<typeof SupplierHealth>;

export const StatusResponse = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  /** Only suppliers that aren't fully up, so the list is usually empty. */
  degraded: z.array(SupplierHealth),
  maintenance: MaintenanceSchema,
  time: z.string(),
});
export type StatusResponse = z.infer<typeof StatusResponse>;

/** Codes the app makes itself: the request never got a usable answer. */
export const CLIENT_ERROR_CODES = {
  OFFLINE: { copy: 'error.offline' },
  TIMEOUT: { copy: 'error.timeout' },
  /** The answer didn't match the contract (a newer or older server): a soft "part of this didn't load". */
  BAD_RESPONSE: { copy: 'problem.partial.title' },
  /** The person stopped waiting. */
  CANCELLED: { copy: 'slow.cancel' },
  /** The phone couldn't save something (disk full). */
  STORAGE_FULL: { copy: 'storage.full.title' },
} as const satisfies Record<string, { copy: CopyKey }>;
export type ClientOnlyErrorCode = keyof typeof CLIENT_ERROR_CODES;

/** The one state the app shows for a failure. Screens switch on this, not on codes. */
export type ErrorKind =
  | 'offline' | 'timeout' | 'busy' | 'maintenance' | 'update' | 'auth' | 'supplier' | 'gone' | 'forbidden'
  | 'input' | 'contract' | 'cancelled' | 'storage' | 'server';

export function errorKind(code: ErrorCode | ClientOnlyErrorCode | string, status = 0): ErrorKind {
  switch (code) {
    case 'OFFLINE': return 'offline';
    case 'TIMEOUT': return 'timeout';
    case 'CANCELLED': return 'cancelled';
    case 'STORAGE_FULL': return 'storage';
    case 'BAD_RESPONSE': return 'contract';
    case 'RATE_LIMITED': case 'OTP_COOLDOWN': case 'OTP_RATE_LIMITED': case 'IN_PROGRESS': return 'busy';
    case 'MAINTENANCE': return 'maintenance';
    case 'UPGRADE_REQUIRED': return 'update';
    case 'UNAUTHORIZED': case 'TOKEN_EXPIRED': case 'SESSION_REVOKED': return 'auth';
    case 'SUPPLIER_DOWN': case 'SUPPLIER_UNAVAILABLE': case 'NOT_CONFIGURED': return 'supplier';
    case 'NOT_FOUND': case 'OTP_EXPIRED': return 'gone';
    case 'FORBIDDEN': return 'forbidden';
    default:
      if (status === 426) return 'update';
      if (status === 429) return 'busy';
      if (status === 404 || status === 410) return 'gone';
      if (status >= 400 && status < 500) return 'input';
      return 'server';
  }
}

/** Retrying can help: the network, a timeout, a busy or broken server. Never for things the server refused on purpose. */
export const isTransient = (kind: ErrorKind) => kind === 'offline' || kind === 'timeout' || kind === 'busy' || kind === 'server' || kind === 'supplier';

/** Compare "1.4.0"-style versions. Missing parts count as 0; anything non-numeric counts as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Client timeouts (ms): searches and payments wait longer because suppliers do. */
export const TIMEOUTS = { default: 8_000, long: 20_000 } as const;
