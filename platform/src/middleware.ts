import { NextResponse, type NextRequest } from "next/server";

// Runs for every platform request (never the public website):
// 1. No session cookie → login. The real check (valid, unexpired, active user) happens server-side.
// 2. A per-request Content Security Policy with a nonce, so only this app's own scripts can run.
// 3. Passes the path on, so the layout can send people who must change their password to that page.
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/adminwork/api/");
  if (!isApi && pathname !== "/adminwork/login" && !req.cookies.has("mada_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/adminwork/login";
    url.search = pathname === "/adminwork" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("x-pathname", pathname);
  reqHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  if (!isApi) res.headers.set("Content-Security-Policy", csp);
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  return res;
}

// Anchored to the platform. Static brand files skip it.
export const config = { matcher: ["/adminwork", "/adminwork/:path((?!symbol|wordmark|favicon).*)"] };
