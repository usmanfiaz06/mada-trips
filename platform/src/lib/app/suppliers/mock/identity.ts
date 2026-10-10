import type { IdentitySupplier, VerifiedIdentity } from "../types";

/*
 * Mock Sign in with Apple / Google. Accepts tokens of the form "mock:<sub>[:<email>]".
 * An email ending @privaterelay.appleid.com is treated as Apple's hidden email.
 */
export const mockIdentity: IdentitySupplier = {
  name: "mock-identity",
  async verify(provider, idToken): Promise<VerifiedIdentity> {
    const m = /^mock:([\w.-]{3,64})(?::([^\s:]+@[^\s:]+))?$/.exec(idToken);
    if (!m) throw new Error("Not a mock identity token");
    const email = m[2] ?? null;
    return { provider, sub: `${provider}-${m[1]}`, email, emailVerified: !!email, isPrivateEmail: !!email && email.endsWith("@privaterelay.appleid.com") };
  },
};
