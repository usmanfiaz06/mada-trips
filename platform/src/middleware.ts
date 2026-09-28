import { NextResponse, type NextRequest } from "next/server";

// Cheap gate: no session cookie → login. The real check (valid, unexpired, active user) happens server-side.
export function middleware(req: NextRequest) {
  const has = req.cookies.has("mada_session");
  const { pathname } = req.nextUrl;
  if (!has && pathname !== "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next|favicon|symbol|wordmark|api/health).*)"] };
