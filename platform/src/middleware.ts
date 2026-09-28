import { NextResponse, type NextRequest } from "next/server";

// Cheap gate for the platform: no session cookie → login. The real check (valid, unexpired, active user)
// happens server-side. The public website is never gated.
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/adminwork/login" || req.cookies.has("mada_session")) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/adminwork/login";
  url.search = pathname === "/adminwork" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/adminwork", "/adminwork/((?!symbol|wordmark|favicon).*)"] };
