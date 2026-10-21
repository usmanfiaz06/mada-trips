import { proxiedImage } from "@/lib/app/image-proxy";

// GET /api/app/v1/img/{token} → a partner's photo (a hotel, an experience), served from our own host so the app never
// loads a partner's image server (lib/app/shield.ts, image-proxy.ts). The token is sealed by us and names one URL on a
// partner host; nothing of the caller's request (cookies, referrer, address) is passed on. No sign-in: the photos are
// public, and the response is cached by browsers and the CDN for a day.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  return proxiedImage((await params).token);
}
