import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignInResponse } from "@mada/shared";
import { POST as otpStart } from "@/app/api/app/v1/auth/otp/start/route";
import { POST as otpVerify } from "@/app/api/app/v1/auth/otp/verify/route";
import { call, freshIp, newPhone } from "./helpers";

/* Shared by the Wallet, account and support tests: a signed-in traveller, multipart uploads, a private blob folder. */

process.env.APP_BLOB_DIR ??= mkdtempSync(join(tmpdir(), "mada-blobs-"));

export async function signIn() {
  const phone = newPhone();
  const ip = freshIp();
  await call(otpStart, { body: { phone }, ip });
  const r = SignInResponse.parse((await call(otpVerify, { body: { phone, code: "123456" }, ip })).json);
  return { token: r.tokens.accessToken, refresh: r.tokens.refreshToken, user: r.user, phone, ip };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: Request, ctx?: any) => Promise<Response>;

/** Call a route that has path params, the way Next does: { params: Promise<…> }. */
export async function callP(handler: Handler, params: Record<string, string>, opts: { method?: string; body?: unknown; token?: string; query?: string; raw?: BodyInit; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": "10.9.0.1", "user-agent": "vitest", ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`http://localhost/api/app/v1/x${opts.query ?? ""}`, {
    method: opts.method ?? "GET", headers, body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const res = await handler(req, { params: Promise.resolve(params) });
  const type = res.headers.get("content-type") ?? "";
  if (type.startsWith("application/json")) {
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, headers: res.headers, json: (text ? JSON.parse(text) : null) as any, bytes: Buffer.from(text) };
  }
  return { status: res.status, headers: res.headers, json: null, bytes: Buffer.from(await res.arrayBuffer()) };
}

export function form(file: { bytes: Buffer; name: string; type: string } | null, meta?: unknown): FormData {
  const f = new FormData();
  if (file) f.set("file", new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
  if (meta !== undefined) f.set("meta", JSON.stringify(meta));
  return f;
}

export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]), Buffer.alloc(2000, 7), Buffer.from([0xff, 0xd9])]);
export const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
export const EXE = Buffer.from("MZ\x90\x00 this is not a document");
