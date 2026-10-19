import "server-only";
import { SUPPLIERS, flightsVendor, isProductionDeploy, legacyAuthEnabled, supplierEnvName, supplierMode } from "./config";
import { tboAirConfigured } from "./suppliers/live/tbo-air";
import { autopilotOn } from "./booking/common";
import { bookingRequiresPhone, flightsMode } from "./switches";

/*
 * The launch guard. On a production deployment the Core API refuses to serve app routes (503 MAINTENANCE, with
 * details.launch) while anything below is a blocker, logs why once per instance, and GET /status lists it. The
 * public routes the app needs to find out (config, status, health, webhooks) still answer.
 *
 * Blockers on production: a supplier in mock mode without APP_ALLOW_MOCKS=yes, required environment missing, or the
 * legacy direct sign-in routes on (APP_LEGACY_AUTH=yes). `npm run app:preflight` prints the same checklist with the
 * warnings too, for any environment.
 */

export type Check = { level: "ok" | "warn" | "block"; area: string; text: string };

const REQUIRED: { name: string; why: string; valid?: (v: string) => boolean }[] = [
  { name: "DATABASE_URL", why: "the database" },
  { name: "SUPABASE_URL", why: "sign-in (Supabase Auth)" },
  { name: "APP_JWT_SECRET", why: "signing app sessions (32+ characters)", valid: (v) => v.length >= 32 },
  { name: "APP_DATA_KEY", why: "encrypting passport numbers and files (base64 of 32 bytes)", valid: (v) => { try { return Buffer.from(v, "base64").length === 32; } catch { return false; } } },
  { name: "SUPABASE_SERVICE_ROLE_KEY", why: "moving and deleting accounts in Supabase Auth" },
  { name: "CRON_SECRET", why: "the scheduled jobs (exports, deletions, expiring quotes)", valid: (v) => v.length >= 16 },
];

/** Every check, for this environment. `production` decides which problems block. */
export function launchChecks(production = isProductionDeploy()): Check[] {
  const out: Check[] = [];
  const bad = production ? "block" : "warn";
  for (const r of REQUIRED) {
    const v = process.env[r.name];
    if (!v) out.push({ level: bad, area: "env", text: `${r.name} is missing: needed for ${r.why}.` });
    else if (r.valid && !r.valid(v)) out.push({ level: bad, area: "env", text: `${r.name} is set but not usable: needed for ${r.why}.` });
    else out.push({ level: "ok", area: "env", text: `${r.name} is set.` });
  }
  const mocks: string[] = [];
  for (const s of SUPPLIERS) {
    try {
      if (supplierMode(s) === "mock") mocks.push(s);
    } catch {
      out.push({ level: "block", area: "suppliers", text: `${s} is in mock mode on production. Set ${supplierEnvName(s)}=live, or APP_ALLOW_MOCKS=yes for a beta or staging copy.` });
    }
  }
  if (mocks.length) out.push({ level: production ? "warn" : "ok", area: "suppliers", text: `Mock suppliers: ${mocks.join(", ")}${production ? " (allowed by APP_ALLOW_MOCKS=yes)" : ""}.` });
  else if (!out.some((c) => c.area === "suppliers")) out.push({ level: "ok", area: "suppliers", text: "Every supplier is live." });
  if (production && legacyAuthEnabled()) out.push({ level: "block", area: "auth", text: "APP_LEGACY_AUTH is on: the direct /auth/otp, /auth/apple and /auth/google routes are open. Supabase Auth replaces them; unset it." });
  else out.push({ level: "ok", area: "auth", text: legacyAuthEnabled() ? "Legacy sign-in routes are on (fine outside production)." : "Legacy sign-in routes are off." });
  out.push({ level: "ok", area: "flights", text: `Flights: ${flightsMode() === "request" ? "by request to the desk (APP_FLIGHTS_MODE=request)" : "live search"}.` });
  // TBO Air (docs/app/TBO.md): keys present but live booking still off, or live booking on test keys.
  const tbo = (() => { try { return flightsVendor() === "tbo"; } catch { return false; } })();
  if (tbo && !tboAirConfigured()) out.push({ level: "warn", area: "flights", text: "SUPPLIER_MODE_FLIGHTS=tbo but TBO_AIR_BASE_URL, TBO_CLIENT_ID, TBO_USERNAME or TBO_PASSWORD is missing: searches go to the desk." });
  if (tbo && production && (process.env.TBO_ENV ?? "test").toLowerCase() !== "live") out.push({ level: flightsMode() === "live" ? "block" : "warn", area: "flights", text: "TBO is on its test environment: tickets wouldn't be real. Set TBO_ENV=live with live keys." });
  if (!bookingRequiresPhone()) out.push({ level: production ? "warn" : "ok", area: "booking", text: "APP_BOOKING_REQUIRES_PHONE=no: accounts without a verified phone can book; the desk calls the contact number to confirm." });
  else out.push({ level: "ok", area: "booking", text: "Booking needs a verified phone." });
  if (autopilotOn()) out.push({ level: production ? "block" : "ok", area: "desk", text: "The mock desk autopilot is on: orders confirm themselves without a person." });
  if (production && !process.env.APP_BLOB_DIR && (process.env.APP_BLOB_STORE ?? "local") === "local") out.push({ level: "warn", area: "storage", text: "APP_BLOB_DIR is unset: documents and files can't be stored on this deployment." });
  return out;
}

export type LaunchStatus = { ready: boolean; problems: string[] };

let logged = false;

/** What keeps app routes closed on this deployment (nothing outside production). */
export function launchStatus(): LaunchStatus {
  if (!isProductionDeploy()) return { ready: true, problems: [] };
  const problems = launchChecks(true).filter((c) => c.level === "block").map((c) => c.text);
  if (problems.length && !logged) {
    logged = true;
    console.error(`[launch-guard] App routes are closed until these are fixed:\n  - ${problems.join("\n  - ")}`);
  }
  return { ready: problems.length === 0, problems };
}

export const resetLaunchLog = () => { logged = false; };
