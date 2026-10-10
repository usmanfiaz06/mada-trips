/** Call a route handler the way Next does: a standard Request in, a Response out. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler = (req: Request, ctx?: any) => Promise<Response>;

let ipSeq = Math.floor(Math.random() * 60_000);
/** Each test gets its own network address unless it asks for one, so per-IP limits don't leak between tests. */
export const freshIp = () => { ipSeq += 1; return `10.${ipSeq >> 16 & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`; };

export async function call(handler: Handler, opts: { method?: string; path?: string; body?: unknown; token?: string; ip?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? "10.0.0.1", "user-agent": "vitest" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const req = new Request(`http://localhost${opts.path ?? "/api/app/v1/test"}`, {
    method: opts.method ?? "POST", headers,
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const res = await handler(req, { params: Promise.resolve({}) });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, headers: res.headers, json: (text ? JSON.parse(text) : null) as any };
}

let phoneSeq = Math.floor(Math.random() * 1_000_000);
/** A unique, valid Saudi mobile number per call (random start, so test files never share one). */
export const newPhone = () => `+9665${String(10000000 + ((++phoneSeq * 7919) % 89999999)).padStart(8, "0")}`;
