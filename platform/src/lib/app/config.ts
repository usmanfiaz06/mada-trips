import "server-only";
import { createHash } from "node:crypto";

/*
 * Configuration for the app's Core API, read from the environment on each call (tests and serverless both set env
 * before first use). Nothing here is ever sent to a client.
 *
 *   APP_JWT_SECRET       ≥ 32 chars. Signs access tokens. Required in production.
 *   APP_DATA_KEY         base64 of 32 random bytes. Encrypts passport numbers. Required to store passports.
 *   APP_DATA_KEYS_OLD    comma-separated older keys, still accepted for decryption after a rotation.
 *   APP_OTP_PEPPER       keys the hashes of sign-in codes and IPs (defaults to a value derived from APP_JWT_SECRET).
 *   SUPPLIER_MODE        mock | live for every supplier; SUPPLIER_MODE_<NAME> overrides one (e.g. SUPPLIER_MODE_SMS=live).
 *   APP_ALLOW_MOCKS      "yes" to allow mock suppliers on a production deployment (never for the real launch).
 *   SUPABASE_URL         the Supabase project whose access tokens /auth/session accepts (SUPPLIER_MODE_SUPABASE=live).
 *   SUPABASE_SMS_HOOK_SECRET  "v1,whsec_…" from Supabase's Send SMS hook; signs the calls to /auth/sms-hook.
 *   APP_LEGACY_AUTH      "yes" keeps the direct /auth/otp, /auth/apple and /auth/google routes on a production
 *                        deployment ("no" turns them off anywhere). Supabase Auth replaces them (docs/app/AUTH.md).
 */

const DEV_JWT_SECRET = "dev-only-mada-core-jwt-secret-do-not-use-in-production";

export const isProductionDeploy = () => process.env.VERCEL_ENV === "production" || process.env.APP_ENV === "production";

export function jwtSecret(): Uint8Array {
  const s = process.env.APP_JWT_SECRET;
  if (s && s.length >= 32) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV === "production" && isProductionDeploy()) throw new Error("APP_JWT_SECRET must be set (32+ characters)");
  return new TextEncoder().encode(DEV_JWT_SECRET);
}

export function pepper(): string {
  const p = process.env.APP_OTP_PEPPER;
  if (p && p.length >= 16) return p;
  return createHash("sha256").update("mada-otp-pepper:").update(jwtSecret()).digest("hex");
}

export type SupplierName = (typeof SUPPLIERS)[number];
export const SUPPLIERS = ["flights", "hotels", "payments", "sms", "whatsapp", "flightStatus", "flightPositions", "ai", "email", "identity", "supabase"] as const;

/** Free, keyless open data: live by default everywhere. Only SUPPLIER_MODE_FLIGHT_POSITIONS switches it (not SUPPLIER_MODE). */
const LIVE_BY_DEFAULT: ReadonlySet<SupplierName> = new Set(["flightPositions"]);
export type SupplierMode = "mock" | "live";

const envName = (s: SupplierName) => `SUPPLIER_MODE_${s.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;

/** Mock unless told otherwise, except on a production deployment, which defaults to live. */
export function supplierMode(name: SupplierName): SupplierMode {
  const global = LIVE_BY_DEFAULT.has(name) ? "live" : process.env.SUPPLIER_MODE;
  const raw = (process.env[envName(name)] ?? global ?? (isProductionDeploy() ? "live" : "mock")).toLowerCase();
  const mode: SupplierMode = raw === "live" ? "live" : "mock";
  if (mode === "mock" && isProductionDeploy() && process.env.APP_ALLOW_MOCKS !== "yes") {
    throw new Error(`Supplier ${name} is in mock mode on a production deployment. Set ${envName(name)}=live, or APP_ALLOW_MOCKS=yes for a staging copy.`);
  }
  return mode;
}

export const supplierEnvName = envName;

export function supplierModes(): Record<string, SupplierMode> {
  const out: Record<string, SupplierMode> = {};
  for (const s of SUPPLIERS) {
    try { out[s] = supplierMode(s); } catch { out[s] = "mock"; }
  }
  return out;
}

/** The pre-Supabase sign-in routes: on outside production (tests, local tools), off in production unless asked for. */
export function legacyAuthEnabled(): boolean {
  const v = process.env.APP_LEGACY_AUTH?.toLowerCase();
  if (v === "yes") return true;
  if (v === "no") return false;
  return !isProductionDeploy();
}
