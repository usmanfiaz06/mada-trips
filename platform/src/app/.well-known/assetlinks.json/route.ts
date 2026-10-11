import { assetLinks, wellKnownResponse } from "@/lib/app/links/well-known";

// GET /.well-known/assetlinks.json: Android app links for madatrips.sa (lib/app/links/well-known.ts).
export const dynamic = "force-dynamic";

export function GET() {
  return wellKnownResponse(assetLinks());
}
