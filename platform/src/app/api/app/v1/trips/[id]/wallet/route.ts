import { z } from "zod";
import type { WalletLinkResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { loadTrip, withParams } from "@/lib/app/trips/route";
import { walletLinkFor } from "@/lib/app/wallet-pass/service";

// POST /api/app/v1/trips/{id}/wallet { passId } | { stayId } → { url, expiresAt }: a ten-minute link to the signed
// Apple Wallet pass (a boarding pass, or the hotel). The app opens it in Safari, which offers "Add to Apple Wallet".
// NOT_CONFIGURED until the Pass Type ID certificate is set (docs/app/NATIVE.md); the app hides the button then.
export const dynamic = "force-dynamic";

const Ask = z.object({ passId: z.uuid().optional(), stayId: z.uuid().optional() }).refine((v) => !!v.passId !== !!v.stayId, { message: "One of passId or stayId" });

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const ask = await body(req, Ask);
  const trip = await loadTrip(req, userId, id);
  return json((await walletLinkFor(userId, trip, ask)) satisfies WalletLinkResponse);
});
