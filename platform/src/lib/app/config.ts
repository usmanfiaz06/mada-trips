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
 *   PHONE_CODE_CHANNEL   whatsapp | sms | whatsapp_then_sms: how phone codes travel (phone-channel.ts, AUTH.md §5a).
 *   ZOHO_CPAAS_*         WhatsApp codes through Zoho CPaaS (suppliers/live/zoho-cpaas.ts).
 *   APP_LINK_BASE_URL    the origin of links we hand out (invites: <base>/join/<code>). Defaults to https://madatrips.sa;
 *                        a staging copy (APP_ENV=staging) falls back to its APP_PUBLIC_URL, which serves /join itself.
 *   APP_LEGACY_AUTH      "yes" keeps the direct /auth/otp, /auth/apple and /auth/google routes on a production
 *                        deployment ("no" turns them off anywhere). Supabase Auth replaces them (docs/app/AUTH.md).
 */

const DEV_JWT_SECRET = "dev-only-mada-core-jwt-secret-do-not-use-in-production";

/**
 * A production deployment: Vercel's production target, or APP_ENV=production anywhere. A staging copy sets
 * APP_ENV=staging; it may be the production target of its own Vercel project (a stable *.vercel.app URL, crons,
 * migrations on deploy) and still behaves as a non-production deployment: mocks allowed, Hotelbeds test keys book.
 */
export const isProductionDeploy = () =>
  process.env.APP_ENV === "production" || (process.env.VERCEL_ENV === "production" && process.env.APP_ENV !== "staging");

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
export const SUPPLIERS = ["flights", "hotels", "payments", "sms", "whatsapp", "flightStatus", "flightPositions", "ai", "email", "identity", "supabase", "activities", "events", "weather", "openData", "transfers", "esim"] as const;

/** Free, keyless open data: live by default everywhere. Only SUPPLIER_MODE_FLIGHT_POSITIONS switches it (not SUPPLIER_MODE). */
// Things to do: Open-Meteo, OpenStreetMap/Wikidata and the events list (Ticketmaster only with TICKETMASTER_KEY) are too.
const LIVE_BY_DEFAULT: ReadonlySet<SupplierName> = new Set(["flightPositions", "weather", "openData", "events"]);
export type SupplierMode = "mock" | "live";
/** Vendor names that mean "live" in SUPPLIER_MODE_<NAME>. */
const LIVE_VENDORS: ReadonlySet<string> = new Set(["hotelbeds", "aerodatabox", "aviationstack", "flightaware", "airalo", "esimaccess", "tbo"]);
/** Any of these keys turns flight status live without SUPPLIER_MODE_FLIGHT_STATUS (the owner only adds the key). */
export const FLIGHT_STATUS_KEYS = ["AERODATABOX_API_KEY", "AVIATIONSTACK_API_KEY", "FLIGHTAWARE_API_KEY"] as const;

const envName = (s: SupplierName) => `SUPPLIER_MODE_${s.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;

/** Mock unless told otherwise, except on a production deployment, which defaults to live. */
export function supplierMode(name: SupplierName): SupplierMode {
  const global = LIVE_BY_DEFAULT.has(name) ? "live" : process.env.SUPPLIER_MODE;
  // Flight status picks itself from whichever vendor key is present (suppliers/flight-status-vendor.ts).
  const auto = name === "flightStatus" && !process.env[envName(name)] && FLIGHT_STATUS_KEYS.some((k) => process.env[k]) ? "live" : undefined;
  const raw = (process.env[envName(name)] ?? auto ?? global ?? (isProductionDeploy() ? "live" : "mock")).toLowerCase();
  // A vendor name means live with that vendor (SUPPLIER_MODE_HOTELS=hotelbeds, SUPPLIER_MODE_FLIGHT_STATUS=aerodatabox).
  const mode: SupplierMode = raw === "live" || LIVE_VENDORS.has(raw) ? "live" : "mock";
  if (mode === "mock" && isProductionDeploy() && process.env.APP_ALLOW_MOCKS !== "yes") {
    throw new Error(`Supplier ${name} is in mock mode on a production deployment. Set ${envName(name)}=live, or APP_ALLOW_MOCKS=yes for a staging copy.`);
  }
  return mode;
}

/**
 * Which live flights supplier: SUPPLIER_MODE_FLIGHTS=tbo, or plain "live" with TBO's keys set → TBO Air
 * (suppliers/live/tbo-air.ts); otherwise the GDS stub, which isn't built (NOT_CONFIGURED). Mock unless live.
 */
export function flightsVendor(): "mock" | "tbo" | "gds" {
  if (supplierMode("flights") === "mock") return "mock";
  const raw = (process.env.SUPPLIER_MODE_FLIGHTS ?? "").trim().toLowerCase();
  if (raw === "tbo" || process.env.TBO_CLIENT_ID) return "tbo";
  return "gds";
}

export const supplierEnvName = envName;

/*
 * Suppliers added one at a time (docs/app/CONNECT.md §24 onwards), each live as soon as its keys are in Vercel:
 *
 *   SUPPLIER_MODE_<NAME>  live (or the vendor's name) | mock | off. Unset: live when every key below is set, else mock
 *                         outside production and off on production (mock there only with APP_ALLOW_MOCKS=yes).
 *
 * Off means the feature isn't offered (or, for the second flight and hotel sources, the first source answers alone,
 * and for Sherpa the built-in entry rules answer). These never block the launch guard: none of them is required.
 */
export const KEYED_SUPPLIERS = {
  routes: ["GOOGLE_ROUTES_API_KEY"],
  carHire: ["CARTRAWLER_CLIENT_ID", "CARTRAWLER_API_KEY"],
  klook: ["KLOOK_API_KEY"],
  sherpa: ["SHERPA_API_KEY"],
  insurance: ["XCOVER_API_KEY", "XCOVER_API_SECRET", "XCOVER_PARTNER_CODE"],
  tabby: ["TABBY_SECRET_KEY", "TABBY_MERCHANT_CODE"],
  tamara: ["TAMARA_API_TOKEN", "TAMARA_NOTIFICATION_TOKEN"],
  duffel: ["DUFFEL_ACCESS_TOKEN"],
  ratehawk: ["RATEHAWK_KEY_ID", "RATEHAWK_API_KEY"],
} as const satisfies Record<string, readonly string[]>;
export type KeyedSupplier = keyof typeof KEYED_SUPPLIERS;
export type KeyedMode = SupplierMode | "off";
const KEYED_VENDORS: ReadonlySet<string> = new Set(["google", "cartrawler", "klook", "sherpa", "xcover", "covergenius", "tabby", "tamara", "duffel", "ratehawk", "etg", "worldota"]);

export const keyedEnvName = (name: KeyedSupplier) => `SUPPLIER_MODE_${name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;
export const keyedConfigured = (name: KeyedSupplier) => KEYED_SUPPLIERS[name].every((k) => !!process.env[k]);

export function keyedMode(name: KeyedSupplier): KeyedMode {
  const raw = (process.env[keyedEnvName(name)] ?? "").trim().toLowerCase();
  const mockAllowed = !isProductionDeploy() || process.env.APP_ALLOW_MOCKS === "yes";
  if (raw === "off") return "off";
  if (raw === "live" || KEYED_VENDORS.has(raw)) return "live";
  if (raw === "mock") return mockAllowed ? "mock" : "off";
  if (keyedConfigured(name)) return "live";
  return mockAllowed ? "mock" : "off";
}

/** Set by name (not just by having keys): a second source joins search only when switched on itself. */
export const keyedExplicit = (name: KeyedSupplier) => !!process.env[keyedEnvName(name)]?.trim();

/** For GET /health: mock or live per keyed supplier; one that's off isn't listed. */
export function keyedModes(): Record<string, SupplierMode> {
  const out: Record<string, SupplierMode> = {};
  for (const s of Object.keys(KEYED_SUPPLIERS) as KeyedSupplier[]) {
    const m = keyedMode(s);
    if (m !== "off") out[s] = m;
  }
  return out;
}

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

/** The origin of links we hand out (invites, shares): madatrips.sa, or this staging copy's own URL (see the header). */
export function publicLinkBase(): string {
  const set = process.env.APP_LINK_BASE_URL?.trim();
  const staging = process.env.APP_ENV === "staging" ? process.env.APP_PUBLIC_URL?.trim() : undefined;
  return (set || staging || "https://madatrips.sa").replace(/\/+$/, "");
}
