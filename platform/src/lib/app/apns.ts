import "server-only";
import { connect, type ClientHttp2Session } from "node:http2";
import { importPKCS8, SignJWT } from "jose";
import { apnsKey, passSigner } from "./wallet-pass/config";

/*
 * APNs over HTTP/2 (fetch can't: APNs only speaks HTTP/2). Two kinds of push:
 *   - Live Activity updates, with the token-based key (.p8, APNS_KEY_*): topic "<bundle>.push-type.liveactivity".
 *   - Wallet "fetch the pass again" nudges, with the Pass Type ID certificate (Apple requires the certificate here),
 *     topic = the Pass Type ID and an empty body.
 * Tests replace the transport with setApnsTransport(); nothing is ever sent without credentials.
 */

export type ApnsRequest = { host: string; path: string; headers: Record<string, string>; body: string; cert?: { cert: string; key: string } };
export type ApnsResponse = { status: number; reason: string | null };
type Transport = (r: ApnsRequest) => Promise<ApnsResponse>;

const g = globalThis as unknown as { __madaApnsSent?: ApnsRequest[] };
/** What a test transport received (tests read it). */
export const apnsSent = (g.__madaApnsSent ??= []);

const http2Transport: Transport = (r) => new Promise((resolve) => {
  let session: ClientHttp2Session | null = null;
  const done = (v: ApnsResponse) => { try { session?.close(); } catch { /* closed */ } resolve(v); };
  try {
    session = connect(r.host, r.cert ? { cert: r.cert.cert, key: r.cert.key } : {});
    session.on("error", () => done({ status: 0, reason: "connection" }));
    session.setTimeout(10_000, () => done({ status: 0, reason: "timeout" }));
    const req = session.request({ ":method": "POST", ":path": r.path, ...r.headers });
    let status = 0; let data = "";
    req.on("response", (h) => { status = Number(h[":status"] ?? 0); });
    req.setEncoding("utf8");
    req.on("data", (c: string) => { data += c; });
    req.on("end", () => { let reason: string | null = null; try { reason = (JSON.parse(data || "{}") as { reason?: string }).reason ?? null; } catch { /* empty body */ } done({ status, reason }); });
    req.on("error", () => done({ status: 0, reason: "request" }));
    req.end(r.body);
  } catch { done({ status: 0, reason: "connection" }); }
});

let transport: Transport = http2Transport;
export function setApnsTransport(t: Transport | null) { transport = t ?? http2Transport; }

// Apple wants the same provider token reused for up to an hour, and refused if refreshed more than every 20 minutes.
let jwtCache: { token: string; at: number; kid: string } | null = null;
async function providerToken(): Promise<string | null> {
  const k = apnsKey();
  if (!k) return null;
  if (jwtCache && jwtCache.kid === k.keyId && Date.now() - jwtCache.at < 40 * 60_000) return jwtCache.token;
  const key = await importPKCS8(k.keyPem, "ES256");
  const token = await new SignJWT({ iss: k.teamId, iat: Math.floor(Date.now() / 1000) }).setProtectedHeader({ alg: "ES256", kid: k.keyId }).sign(key);
  jwtCache = { token, at: Date.now(), kid: k.keyId };
  return token;
}

/** One Live Activity push. `event` update or end; `state` is the ContentState the Swift side decodes. */
export async function pushLiveActivity(token: string, p: { event: "update" | "end"; state: Record<string, unknown>; staleAt?: number; dismissAt?: number; alert?: { title: string; body: string } | null; priority?: 5 | 10 }): Promise<ApnsResponse> {
  const k = apnsKey();
  const jwt = await providerToken().catch(() => null);
  if (!k || !jwt) return { status: 0, reason: "not_configured" };
  const now = Math.floor(Date.now() / 1000);
  const aps: Record<string, unknown> = { timestamp: now, event: p.event, "content-state": p.state };
  if (p.staleAt) aps["stale-date"] = p.staleAt;
  if (p.dismissAt) aps["dismissal-date"] = p.dismissAt;
  if (p.alert) aps.alert = { title: p.alert.title, body: p.alert.body };
  const req: ApnsRequest = {
    host: k.host, path: `/3/device/${token}`, body: JSON.stringify({ aps }),
    headers: { authorization: `bearer ${jwt}`, "apns-topic": `${k.bundleId}.push-type.liveactivity`, "apns-push-type": "liveactivity", "apns-priority": String(p.priority ?? 10), "apns-expiration": String(now + 3600) },
  };
  if (transport !== http2Transport) apnsSent.push(req);
  return transport(req);
}

/** Tells a device that registered a Wallet pass to fetch it again. */
export async function pushWalletUpdate(pushToken: string): Promise<ApnsResponse> {
  const s = passSigner();
  if (!s) return { status: 0, reason: "not_configured" };
  const req: ApnsRequest = { host: "https://api.push.apple.com", path: `/3/device/${pushToken}`, body: "{}", headers: { "apns-topic": s.passTypeId }, cert: { cert: s.certPem, key: s.keyPem } };
  if (transport !== http2Transport) apnsSent.push(req);
  return transport(req);
}
