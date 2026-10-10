import { createRemoteJWKSet, jwtVerify } from "jose";
import type { IdentitySupplier, VerifiedIdentity } from "../types";
import { requireEnv } from "./not-configured";

/*
 * Verifies Sign in with Apple and Google identity tokens against the providers' published keys.
 *   APPLE_CLIENT_IDS   comma-separated bundle / service ids (e.g. sa.madatrips.app)
 *   GOOGLE_CLIENT_IDS  comma-separated OAuth client ids (iOS, Android, web)
 */
const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export const providerIdentity: IdentitySupplier = {
  name: "apple-google-jwks",
  async verify(provider, idToken, nonce): Promise<VerifiedIdentity> {
    if (provider === "apple") {
      const env = requireEnv("Sign in with Apple", ["APPLE_CLIENT_IDS"]);
      const { payload } = await jwtVerify(idToken, appleKeys, { issuer: "https://appleid.apple.com", audience: list(env.APPLE_CLIENT_IDS!) });
      if (nonce && payload.nonce !== nonce) throw new Error("Nonce mismatch");
      const email = typeof payload.email === "string" ? payload.email : null;
      return { provider, sub: String(payload.sub), email, emailVerified: String(payload.email_verified) === "true", isPrivateEmail: String(payload.is_private_email) === "true" };
    }
    const env = requireEnv("Google Sign-In", ["GOOGLE_CLIENT_IDS"]);
    const { payload } = await jwtVerify(idToken, googleKeys, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: list(env.GOOGLE_CLIENT_IDS!) });
    if (nonce && payload.nonce !== nonce) throw new Error("Nonce mismatch");
    const email = typeof payload.email === "string" ? payload.email : null;
    return { provider, sub: String(payload.sub), email, emailVerified: payload.email_verified === true, isPrivateEmail: false };
  },
};
