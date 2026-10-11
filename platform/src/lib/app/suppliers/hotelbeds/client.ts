import { createHash, randomUUID } from "node:crypto";

/*
 * The one HTTP client for the Hotelbeds (HBX Group) API Suite: Hotels, Activities and Transfers. Each product has its
 * own key pair; the signing, hosts, timeouts, retries and logging are shared. See docs/app/HOTELBEDS.md.
 *
 *   HOTELBEDS_ENV                 test | live (default test). test → https://api.test.hotelbeds.com, live → https://api.hotelbeds.com
 *   HOTELBEDS_HOTEL_API_KEY       Hotels (Booking + Content APIs)
 *   HOTELBEDS_HOTEL_SECRET
 *   HOTELBEDS_TRANSFERS_API_KEY   Transfers
 *   HOTELBEDS_TRANSFERS_SECRET
 *   HOTELBEDS_ACTIVITIES_API_KEY  Activities
 *   HOTELBEDS_ACTIVITIES_SECRET
 *
 * Every request carries Api-key and X-Signature = hex(SHA-256(apiKey + secret + unix seconds)), Accept JSON and
 * Accept-Encoding gzip. Only safe calls (GETs and the read-only POSTs: availability, checkrates) are retried; a booking
 * or a cancellation is never sent twice by us. A 429 or a 403 quota answer becomes HotelbedsError("RATE_LIMITED").
 *
 * This file imports nothing from Next or the database, so the smoke script (scripts/hotelbeds-smoke.ts) and the tests
 * can use it directly. The app passes `guard` (the circuit breaker in resilience/breaker.ts).
 */

export type HotelbedsProduct = "hotels" | "transfers" | "activities";
export type HotelbedsEnv = "test" | "live";

export const HOTELBEDS_HOSTS: Record<HotelbedsEnv, string> = {
  test: "https://api.test.hotelbeds.com",
  live: "https://api.hotelbeds.com",
};

const ENV_NAMES: Record<HotelbedsProduct, { key: string; secret: string }> = {
  hotels: { key: "HOTELBEDS_HOTEL_API_KEY", secret: "HOTELBEDS_HOTEL_SECRET" },
  transfers: { key: "HOTELBEDS_TRANSFERS_API_KEY", secret: "HOTELBEDS_TRANSFERS_SECRET" },
  activities: { key: "HOTELBEDS_ACTIVITIES_API_KEY", secret: "HOTELBEDS_ACTIVITIES_SECRET" },
};
export const hotelbedsEnvNames = (p: HotelbedsProduct) => ENV_NAMES[p];

export function hotelbedsEnv(env: NodeJS.ProcessEnv = process.env): HotelbedsEnv {
  return env.HOTELBEDS_ENV?.toLowerCase() === "live" ? "live" : "test";
}

export type HotelbedsCredentials = { apiKey: string; secret: string };

/** The key pair for one product, or null when either half is missing. */
export function hotelbedsCredentials(p: HotelbedsProduct, env: NodeJS.ProcessEnv = process.env): HotelbedsCredentials | null {
  const n = ENV_NAMES[p];
  const apiKey = env[n.key]?.trim();
  const secret = env[n.secret]?.trim();
  return apiKey && secret ? { apiKey, secret } : null;
}

/** X-Signature: SHA-256, hex, of api key + secret + the current UNIX time in seconds. */
export function hotelbedsSignature(apiKey: string, secret: string, unixSeconds: number): string {
  return createHash("sha256").update(`${apiKey}${secret}${unixSeconds}`).digest("hex");
}

export type HotelbedsErrorCode = "NOT_CONFIGURED" | "RATE_LIMITED" | "TIMEOUT" | "UNAVAILABLE" | "INVALID_REQUEST" | "NOT_FOUND" | "PRICE_CHANGED" | "NO_AVAILABILITY" | "REJECTED";

/** Anything Hotelbeds said no to, or couldn't be reached for. Never carries the key, the secret or the signature. */
export class HotelbedsError extends Error {
  constructor(
    readonly code: HotelbedsErrorCode,
    message: string,
    readonly info: { status?: number; supplierCode?: string | null; requestId?: string; retryAfter?: number; product?: HotelbedsProduct } = {},
  ) {
    super(message);
    this.name = "HotelbedsError";
  }
  /** Whether this is an outage (counts towards the circuit breaker) rather than an answer. */
  get transport() { return this.code === "TIMEOUT" || this.code === "UNAVAILABLE"; }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  status: number; headers: { get(name: string): string | null }; text(): Promise<string>;
}>;

export type HotelbedsLogLine = { product: HotelbedsProduct; method: string; path: string; status: number | "error"; ms: number; requestId: string; supplierToken?: string | null; attempt: number };

export type HotelbedsClientOptions = {
  product: HotelbedsProduct;
  credentials?: HotelbedsCredentials | null;
  env?: HotelbedsEnv;
  /** Override the host (the tests' recorded fixtures, a proxy). */
  baseUrl?: string;
  fetch?: FetchLike;
  /** Per attempt. Availability can be slow on the test host. */
  timeoutMs?: number;
  /** Extra attempts for safe calls only. */
  retries?: number;
  /** Wraps every call (the app's circuit breaker). */
  guard?: <T>(fn: () => Promise<T>) => Promise<T>;
  log?: (line: HotelbedsLogLine) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type HotelbedsRequest = {
  method: "GET" | "POST" | "DELETE" | "PUT";
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Safe to send again: GETs, availability and checkrates. Bookings and cancellations are not. */
  safe?: boolean;
  timeoutMs?: number;
  /** At most this many extra attempts for this call (safe calls only; never more than the client allows). */
  retries?: number;
};

const defaultLog = (l: HotelbedsLogLine) => {
  // Request ids and timings only: never the key, the secret, the signature or a traveller's details.
  console.info(`[hotelbeds] ${l.product} ${l.method} ${l.path} → ${l.status} in ${l.ms} ms (req ${l.requestId}${l.supplierToken ? `, token ${l.supplierToken}` : ""}${l.attempt > 1 ? `, attempt ${l.attempt}` : ""})`);
};

const realFetch: FetchLike = (url, init) => fetch(url, init);

/** Supplier error codes that mean the price or the room moved between search and booking. */
const PRICE_MOVED = /price|rate.*(changed|not.*available)|allotment|not available|no availability|INSUFFICIENT_ALLOTMENT/i;

export class HotelbedsClient {
  readonly product: HotelbedsProduct;
  readonly env: HotelbedsEnv;
  readonly baseUrl: string;
  private readonly creds: HotelbedsCredentials | null;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly guard: <T>(fn: () => Promise<T>) => Promise<T>;
  private readonly log: (line: HotelbedsLogLine) => void;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(o: HotelbedsClientOptions) {
    this.product = o.product;
    this.env = o.env ?? hotelbedsEnv();
    this.baseUrl = (o.baseUrl ?? HOTELBEDS_HOSTS[this.env]).replace(/\/$/, "");
    this.creds = o.credentials === undefined ? hotelbedsCredentials(o.product) : o.credentials;
    this.fetchImpl = o.fetch ?? realFetch;
    this.timeoutMs = o.timeoutMs ?? 12_000;
    this.retries = o.retries ?? 2;
    this.guard = o.guard ?? ((fn) => fn());
    this.log = o.log ?? defaultLog;
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get configured() { return !!this.creds; }

  /** The headers for one call. Exported for the tests; the signature changes every second. */
  headers(hasBody: boolean, requestId: string): Record<string, string> {
    if (!this.creds) throw this.notConfigured();
    const ts = Math.floor(this.now() / 1000);
    return {
      "Api-key": this.creds.apiKey,
      "X-Signature": hotelbedsSignature(this.creds.apiKey, this.creds.secret, ts),
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Request-Id": requestId,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    };
  }

  private notConfigured() {
    const n = ENV_NAMES[this.product];
    return new HotelbedsError("NOT_CONFIGURED", `Hotelbeds ${this.product} keys are missing (${n.key}, ${n.secret})`, { product: this.product });
  }

  url(path: string, query?: HotelbedsRequest["query"]): string {
    const q = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}${q ? `?${q}` : ""}`;
  }

  /** One call, through the guard, with retries for safe calls. Resolves with the parsed JSON body. */
  async request<T>(r: HotelbedsRequest): Promise<T> {
    if (!this.creds) throw this.notConfigured();
    return this.guard(() => this.attempts<T>(r));
  }

  private async attempts<T>(r: HotelbedsRequest): Promise<T> {
    const safe = r.safe ?? r.method === "GET";
    const max = safe ? 1 + Math.min(r.retries ?? this.retries, this.retries) : 1;
    let last: unknown;
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        return await this.once<T>(r, attempt);
      } catch (e) {
        last = e;
        const he = e instanceof HotelbedsError ? e : null;
        const retryable = he && (he.transport || he.code === "RATE_LIMITED");
        if (!retryable || attempt >= max) throw e;
        // Back off: honour Retry-After (capped), else 400 ms, 1.2 s.
        const wait = he.code === "RATE_LIMITED" ? Math.min(5_000, (he.info.retryAfter ?? 1) * 1000) : 400 * 3 ** (attempt - 1);
        await this.sleep(wait);
      }
    }
    throw last;
  }

  private async once<T>(r: HotelbedsRequest, attempt: number): Promise<T> {
    const requestId = randomUUID();
    const started = this.now();
    const body = r.body === undefined ? undefined : JSON.stringify(r.body);
    const ms = r.timeoutMs ?? this.timeoutMs;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await Promise.race([
        this.fetchImpl(this.url(r.path, r.query), { method: r.method, headers: this.headers(!!body, requestId), body, signal: ctrl.signal }),
        new Promise<never>((_, reject) => ctrl.signal.addEventListener("abort", () => reject(new HotelbedsError("TIMEOUT", `Hotelbeds ${this.product} took longer than ${ms} ms`, { requestId, product: this.product })))),
      ]);
    } catch (e) {
      this.log({ product: this.product, method: r.method, path: r.path, status: "error", ms: this.now() - started, requestId, attempt });
      if (e instanceof HotelbedsError) throw e;
      throw new HotelbedsError("UNAVAILABLE", `Hotelbeds ${this.product} could not be reached`, { requestId, product: this.product });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    const token = (parsed as { auditData?: { token?: string } } | null)?.auditData?.token ?? null;
    this.log({ product: this.product, method: r.method, path: r.path, status: res.status, ms: this.now() - started, requestId, supplierToken: token, attempt });
    if (res.status >= 200 && res.status < 300) {
      if (parsed === null && text) throw new HotelbedsError("UNAVAILABLE", `Hotelbeds ${this.product} sent a body that isn't JSON`, { status: res.status, requestId, product: this.product });
      return parsed as T;
    }
    throw errorFrom(res.status, parsed, res.headers.get("retry-after"), requestId, this.product);
  }
}

/** Hotelbeds error bodies: { error: { code, message } } (Hotels) or { errors: [{ code, message }] } / { message } (Transfers, Activities). */
export function errorFrom(status: number, body: unknown, retryAfter: string | null, requestId: string, product: HotelbedsProduct): HotelbedsError {
  const b = (body ?? {}) as { error?: { code?: string; message?: string }; errors?: { code?: string; message?: string; description?: string }[]; message?: string; code?: string };
  const supplierCode = b.error?.code ?? b.errors?.[0]?.code ?? b.code ?? null;
  // Their words stay in our logs (no traveller data in them); the traveller sees our copy.
  const said = (b.error?.message ?? b.errors?.[0]?.message ?? b.errors?.[0]?.description ?? b.message ?? "").slice(0, 300);
  const info = { status, supplierCode, requestId, product, retryAfter: retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined };
  const msg = `Hotelbeds ${product} answered ${status}${supplierCode ? ` ${supplierCode}` : ""}${said ? `: ${said}` : ""}`;
  // A 403 on the evaluation keys is the daily quota (50 calls a day); a 429 is the per-second limit.
  if (status === 429 || (status === 403 && /quota|limit|exceeded/i.test(said))) return new HotelbedsError("RATE_LIMITED", msg, info);
  if (status === 401 || status === 403) return new HotelbedsError("NOT_CONFIGURED", msg, info);
  if (status === 404) return new HotelbedsError("NOT_FOUND", msg, info);
  if (status >= 500 || status === 408) return new HotelbedsError("UNAVAILABLE", msg, info);
  if (PRICE_MOVED.test(`${supplierCode ?? ""} ${said}`)) return new HotelbedsError("PRICE_CHANGED", msg, info);
  if (status === 400 || status === 422) return new HotelbedsError("INVALID_REQUEST", msg, info);
  return new HotelbedsError("REJECTED", msg, info);
}
