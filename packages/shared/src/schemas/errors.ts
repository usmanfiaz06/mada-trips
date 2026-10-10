import { z } from 'zod';
import type { CopyKey } from '../copy/en';

/**
 * Every API failure has the same shape: { error: { code, message } }, plus optional fields some codes carry.
 * `message` is a finished sentence from the catalogue, safe to show as is. The app may also pick its own words by code.
 */
export const ERROR_CODES = {
  VALIDATION: { status: 400, copy: 'error.validation' },
  PHONE_INVALID: { status: 400, copy: 'error.phoneInvalid' },
  UNAUTHORIZED: { status: 401, copy: 'error.unauthorized' },
  TOKEN_EXPIRED: { status: 401, copy: 'error.sessionExpired' },
  SESSION_REVOKED: { status: 401, copy: 'error.sessionExpired' },
  OTP_WRONG: { status: 401, copy: 'otp.wrong.other' },
  OTP_LOCKED: { status: 423, copy: 'otp.locked' },
  OTP_EXPIRED: { status: 410, copy: 'otp.expired' },
  FORBIDDEN: { status: 403, copy: 'error.forbidden' },
  NOT_FOUND: { status: 404, copy: 'error.notFound' },
  PHONE_TAKEN: { status: 409, copy: 'error.phoneTaken' },
  RATE_LIMITED: { status: 429, copy: 'error.rateLimited' },
  OTP_COOLDOWN: { status: 429, copy: 'error.otpCooldown' },
  OTP_RATE_LIMITED: { status: 429, copy: 'error.otpRateLimited' },
  NOT_CONFIGURED: { status: 501, copy: 'error.notConfigured' },
  SUPPLIER_UNAVAILABLE: { status: 503, copy: 'error.notConfigured' },
  INTERNAL: { status: 500, copy: 'error.internal' },
  /** Signed in with Apple, Google or email and no verified mobile yet: booking needs one (docs/app/AUTH.md). */
  PHONE_REQUIRED: { status: 403, copy: 'auth.error.phoneRequired' },
  /** The Supabase identity belongs to a different Mada account than the one signed in. */
  IDENTITY_TAKEN: { status: 409, copy: 'auth.error.identityTaken' },
  // Resilience (FLOWS.md §12; status.ts has the client-side codes and what the app does with each).
  /** A supplier's circuit is open or it didn't answer in time; `details.supplier` names it. Fails fast, never hangs. */
  SUPPLIER_DOWN: { status: 503, copy: 'error.supplierDown' },
  /** Planned maintenance (GET /config `maintenance.on`): the app shows its maintenance screen. */
  MAINTENANCE: { status: 503, copy: 'error.maintenance' },
  /** The app is older than GET /config `minVersion`: the app shows its update screen. */
  UPGRADE_REQUIRED: { status: 426, copy: 'error.upgradeRequired' },
  /** An Idempotency-Key was reused with a different request. */
  IDEMPOTENCY_CONFLICT: { status: 422, copy: 'error.idempotencyConflict' },
  /** The first request with this Idempotency-Key is still running. Retry after `retryAfter`. */
  IN_PROGRESS: { status: 409, copy: 'error.inProgress' },
  /** The server gave up waiting on something (a supplier, the database). */
  TIMEOUT: { status: 504, copy: 'error.timeout' },
} as const satisfies Record<string, { status: number; copy: CopyKey }>;

export type ErrorCode = keyof typeof ERROR_CODES;
export const ErrorCodeSchema = z.enum(Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]]);

export const ApiErrorBody = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    /** Field problems for VALIDATION: path → first message. */
    fields: z.record(z.string(), z.string()).optional(),
    /** OTP_WRONG: tries left on this code. */
    triesLeft: z.number().int().optional(),
    /** 429s: seconds until trying again makes sense. */
    retryAfter: z.number().int().optional(),
    /** Code-specific facts, e.g. SUPPLIER_DOWN { supplier }, MAINTENANCE { until }, UPGRADE_REQUIRED { minVersion }. */
    details: z.record(z.string(), z.unknown()).optional(),
    /** The x-request-id of the request, for "Reference …" lines and support. */
    requestId: z.string().max(80).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
