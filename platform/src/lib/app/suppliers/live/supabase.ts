import { createRemoteJWKSet, decodeProtectedHeader, errors as joseErrors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { AppError } from "../../http";
import type { SupabaseAuthSupplier, SupabaseIdentity } from "../types";
import { requireEnv } from "./not-configured";

/*
 * Supabase Auth access tokens, verified on our side with jose (docs/app/AUTH.md):
 *   SUPABASE_URL         https://<project>.supabase.co. Issuer is <url>/auth/v1; keys come from
 *                        <url>/auth/v1/.well-known/jwks.json (asymmetric signing keys: ES256 or RS256).
 *   SUPABASE_JWT_SECRET  only for a project still on the legacy shared secret (HS256). Leave unset otherwise.
 *
 * What a token proves (with "Confirm email" on and password sign-up off, as AUTH.md sets the project up):
 *   - `phone` is set only once a code to that number was entered (a pending change waits in new_phone, not here);
 *   - `email` is proven by a code (email provider) or by Apple/Google (user_metadata.email_verified).
 * Anonymous sessions and anything but the `authenticated` role are refused.
 */

const PROVIDERS = new Set(["phone", "email", "apple", "google"]);
const jwksByUrl = new Map<string, JWTVerifyGetKey>();

export type SupabaseVerifyOptions = {
  /** The project URL, e.g. https://abcd.supabase.co. */
  url: string;
  /** Keys to check the signature with. Defaults to the project's JWKS (cached per URL). */
  keys?: JWTVerifyGetKey;
  /** Legacy HS256 projects only. */
  hsSecret?: string;
};

const projectKeys = (url: string) => {
  let k = jwksByUrl.get(url);
  if (!k) {
    k = createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`), { cooldownDuration: 60_000, cacheMaxAge: 10 * 60_000 });
    jwksByUrl.set(url, k);
  }
  return k;
};

/** Verify the signature, issuer, audience and expiry, then read what Supabase has proven. */
export async function verifySupabaseToken(token: string, opts: SupabaseVerifyOptions): Promise<SupabaseIdentity> {
  const url = opts.url.replace(/\/+$/, "");
  let payload: JWTPayload;
  try {
    const alg = decodeProtectedHeader(token).alg;
    const common = { issuer: `${url}/auth/v1`, audience: "authenticated", clockTolerance: 5 };
    if (alg === "HS256") {
      if (!opts.hsSecret) throw new AppError("UNAUTHORIZED");
      ({ payload } = await jwtVerify(token, new TextEncoder().encode(opts.hsSecret), { ...common, algorithms: ["HS256"] }));
    } else {
      ({ payload } = await jwtVerify(token, opts.keys ?? projectKeys(url), { ...common, algorithms: ["ES256", "RS256", "EdDSA"] }));
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(e instanceof joseErrors.JWTExpired ? "TOKEN_EXPIRED" : "UNAUTHORIZED");
  }
  return identityFromClaims(payload);
}

type Claims = JWTPayload & {
  email?: string; phone?: string; role?: string; is_anonymous?: boolean;
  app_metadata?: { provider?: string; providers?: string[] };
  user_metadata?: { email_verified?: boolean; full_name?: string; name?: string; given_name?: string; has_password?: boolean };
};

export function identityFromClaims(p: JWTPayload): SupabaseIdentity {
  const c = p as Claims;
  if (!c.sub || c.role !== "authenticated" || c.is_anonymous) throw new AppError("UNAUTHORIZED");
  const providers = [...new Set([...(c.app_metadata?.providers ?? []), c.app_metadata?.provider ?? ""])]
    .filter((x): x is SupabaseIdentity["providers"][number] => PROVIDERS.has(x));
  // Supabase doesn't put a password in the token; the app records one in user_metadata when it sets or removes it.
  if (c.user_metadata?.has_password === true && c.email) providers.push("password");
  const phone = c.phone ? `+${String(c.phone).replace(/^\+/, "")}` : null;
  const email = c.email ? String(c.email).toLowerCase() : null;
  const emailVerified = !!email && (providers.includes("email") || c.user_metadata?.email_verified === true);
  const name = (c.user_metadata?.given_name ?? c.user_metadata?.full_name ?? c.user_metadata?.name ?? "").trim();
  return {
    sub: c.sub, phone, phoneVerified: !!phone, email, emailVerified,
    isPrivateEmail: !!email && email.endsWith("@privaterelay.appleid.com"),
    providers, name: name || null,
  };
}

export const liveSupabase: SupabaseAuthSupplier = {
  name: "supabase-auth",
  async verify(token) {
    const env = requireEnv("Supabase Auth", ["SUPABASE_URL"]);
    return verifySupabaseToken(token, { url: env.SUPABASE_URL!, hsSecret: process.env.SUPABASE_JWT_SECRET || undefined });
  },
};
