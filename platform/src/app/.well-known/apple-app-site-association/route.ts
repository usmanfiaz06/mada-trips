import { appleAppSiteAssociation, wellKnownResponse } from "@/lib/app/links/well-known";

// GET /.well-known/apple-app-site-association: iOS universal links for madatrips.sa/join, /i, /trip, /plan, /city
// (lib/app/links/well-known.ts). No extension, application/json, never a redirect.
export const dynamic = "force-dynamic";

export function GET() {
  return wellKnownResponse(appleAppSiteAssociation());
}
