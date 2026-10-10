import { decodeMockSupabaseToken, MOCK_SUPABASE_ISSUER, AUTH_PROVIDERS } from "@mada/shared";
import { AppError } from "../../http";
import type { SupabaseAuthSupplier, SupabaseIdentity } from "../types";

/*
 * Supabase Auth without a Supabase project. The app's mock auth client (apps/mobile/src/lib/auth/mock.ts) issues
 * unsigned `mocksb.<base64url JSON>` tokens; this reads them. Anyone can mint one, so supplierMode("supabase") refuses
 * mock mode on a production deployment unless APP_ALLOW_MOCKS=yes (a staging copy).
 */
export const mockSupabase: SupabaseAuthSupplier = {
  name: "mock-supabase",
  async verify(token): Promise<SupabaseIdentity> {
    const c = decodeMockSupabaseToken(token);
    if (!c || c.iss !== MOCK_SUPABASE_ISSUER) throw new AppError("UNAUTHORIZED");
    if (c.exp * 1000 <= Date.now()) throw new AppError("TOKEN_EXPIRED");
    const phone = c.phone ? `+${c.phone.replace(/^\+/, "")}` : null;
    const email = c.email ? c.email.toLowerCase() : null;
    return {
      sub: c.sub, phone, phoneVerified: !!phone, email, emailVerified: !!email,
      isPrivateEmail: !!email && email.endsWith("@privaterelay.appleid.com"),
      providers: c.providers.filter((p): p is SupabaseIdentity["providers"][number] => (AUTH_PROVIDERS as readonly string[]).includes(p)),
      name: c.name?.trim() || null,
    };
  },
};
