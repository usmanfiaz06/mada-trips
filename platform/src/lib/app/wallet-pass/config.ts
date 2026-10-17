import "server-only";
import forge from "node-forge";
import { isProductionDeploy } from "../config";

/*
 * Apple Wallet and APNs credentials, from the environment only (docs/app/NATIVE.md). Nothing here is ever committed:
 * each value is the base64 of the file Apple gives you (or the PEM text itself).
 *
 *   APPLE_TEAM_ID              the 10-character team id
 *   APPLE_PASS_TYPE_ID         "pass.sa.madatrips.trip" (the Pass Type ID)
 *   APPLE_PASS_CERT_P12        the Pass Type ID certificate exported from Keychain as .p12 (base64)
 *   APPLE_PASS_CERT_PASSWORD   its export password (may be empty)
 *     or APPLE_PASS_CERT_PEM + APPLE_PASS_KEY_PEM, the certificate and its private key as PEM (base64)
 *   APPLE_WWDR_CERT            Apple's WWDR intermediate (G4), .cer or .pem (base64)
 *   APPLE_WALLET=off           hides "Add to Apple Wallet" even with the certificates set
 *
 *   APNS_KEY_P8                the APNs auth key (.p8, base64 or PEM), for Live Activity pushes
 *   APNS_KEY_ID                its 10-character key id
 *   APNS_BUNDLE_ID             the app's bundle id (sa.madatrips.app by default)
 *   APNS_ENV                   production | sandbox (production on the production deployment, sandbox elsewhere)
 *   LIVE_ACTIVITY_PUSH=off     stops server pushes to Live Activities (the phone still updates them while open)
 */

const decode = (v: string | undefined): string | null => {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (s.includes("-----BEGIN")) return s.replace(/\\n/g, "\n");
  try { return Buffer.from(s, "base64").toString("binary"); } catch { return null; }
};

const toPem = (raw: string | null): string | null => {
  if (!raw) return null;
  if (raw.includes("-----BEGIN")) return raw;
  try { return forge.pki.certificateToPem(forge.pki.certificateFromAsn1(forge.asn1.fromDer(raw))); } catch { return null; }
};

export type PassSigner = { teamId: string; passTypeId: string; certPem: string; keyPem: string; wwdrPem: string };

let cached: { at: string; v: PassSigner | null } | null = null;

/** The Pass Type ID certificate, its key and WWDR, or null when any is missing or unreadable. */
export function passSigner(): PassSigner | null {
  const env = process.env;
  const fp = [env.APPLE_TEAM_ID, env.APPLE_PASS_TYPE_ID, env.APPLE_PASS_CERT_P12, env.APPLE_PASS_CERT_PEM, env.APPLE_PASS_KEY_PEM, env.APPLE_WWDR_CERT, env.APPLE_PASS_CERT_PASSWORD].map((x) => x?.length ?? 0).join(":");
  if (cached?.at === fp) return cached.v;
  let v: PassSigner | null = null;
  try {
    const teamId = (env.APPLE_TEAM_ID ?? "").trim();
    const passTypeId = (env.APPLE_PASS_TYPE_ID ?? "").trim();
    const wwdrPem = toPem(decode(env.APPLE_WWDR_CERT));
    let certPem: string | null = null, keyPem: string | null = null;
    const p12 = decode(env.APPLE_PASS_CERT_P12);
    if (p12) {
      const pk = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12), env.APPLE_PASS_CERT_PASSWORD ?? "");
      const cert = pk.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0]?.cert;
      const key = (pk.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ?? pk.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0])?.key;
      if (cert && key) { certPem = forge.pki.certificateToPem(cert); keyPem = forge.pki.privateKeyToPem(key); }
    } else {
      certPem = toPem(decode(env.APPLE_PASS_CERT_PEM));
      keyPem = decode(env.APPLE_PASS_KEY_PEM);
    }
    if (/^[A-Z0-9]{10}$/.test(teamId) && /^pass\.[\w.-]+$/.test(passTypeId) && certPem && keyPem && wwdrPem) v = { teamId, passTypeId, certPem, keyPem, wwdrPem };
  } catch { v = null; }
  cached = { at: fp, v };
  return v;
}

/** "Add to Apple Wallet" shows only when a pass can really be signed. */
export function walletEnabled(): boolean {
  return (process.env.APPLE_WALLET ?? "on").toLowerCase() !== "off" && !!passSigner();
}

export type ApnsKey = { keyId: string; teamId: string; keyPem: string; bundleId: string; host: string };

export function apnsKey(): ApnsKey | null {
  const keyPem = decode(process.env.APNS_KEY_P8);
  const keyId = (process.env.APNS_KEY_ID ?? "").trim();
  const teamId = (process.env.APNS_TEAM_ID ?? process.env.APPLE_TEAM_ID ?? "").trim();
  if (!keyPem || !keyPem.includes("PRIVATE KEY") || !/^[A-Z0-9]{10}$/.test(keyId) || !/^[A-Z0-9]{10}$/.test(teamId)) return null;
  const env = (process.env.APNS_ENV ?? (isProductionDeploy() ? "production" : "sandbox")).toLowerCase();
  return { keyId, teamId, keyPem, bundleId: (process.env.APNS_BUNDLE_ID ?? "sa.madatrips.app").trim(), host: env === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com" };
}

/** Server pushes to Live Activities are on when the APNs key is set (and LIVE_ACTIVITY_PUSH isn't off). */
export function liveActivityPushEnabled(): boolean {
  return (process.env.LIVE_ACTIVITY_PUSH ?? "on").toLowerCase() !== "off" && !!apnsKey();
}
