import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql as rawSql } from "drizzle-orm";
import { ConfigResponse, PHONE_CHANNEL_LIMITS, PhoneChannelResponse } from "@mada/shared";
import { db } from "@/db";
import { outbox, suppliers, WhatsAppUndeliverable } from "@/lib/app/suppliers";
import { zohoAuthCodeBody, zohoWhatsApp } from "@/lib/app/suppliers/live/zoho-cpaas";
import { resetBreakers } from "@/lib/app/resilience/breaker";
import { phoneChannels, phoneCodeSetting } from "@/lib/app/phone-channel";
import { signStandardWebhook } from "@/lib/app/sms-hook";
import { POST as smsHook } from "@/app/api/app/v1/auth/sms-hook/route";
import { POST as hintPost } from "@/app/api/app/v1/auth/phone-channel/route";
import { GET as ticketGet } from "@/app/api/app/v1/auth/phone-channel/[ticket]/route";
import { GET as configGet } from "@/app/api/app/v1/config/route";
import { call, freshIp, newPhone } from "./helpers";

/*
 * Phone codes on WhatsApp through Zoho CPaaS (docs/app/AUTH.md): the live adapter against a recorded fetch (request
 * shape, Zoho's error answers, the log check), the channel the Send SMS hook picks, the fallback to SMS, the language,
 * and the app's hint and ticket.
 */

const ZOHO = {
  ZOHO_CPAAS_API_KEY: "PHtE6r0KQ-test-key",
  ZOHO_CPAAS_WHATSAPP_SENDER: "+966 11 000 0000",
  ZOHO_CPAAS_TEMPLATE_EN: "d0109d00-b191-11f1-95b1-aaa8828ce996",
  ZOHO_CPAAS_TEMPLATE_AR: "mada_code_ar",
  ZOHO_CPAAS_CONFIRM_MS: "0",
};
const stubZoho = (extra: Record<string, string> = {}) => { for (const [k, v] of Object.entries({ ...ZOHO, ...extra })) vi.stubEnv(k, v); };

type Recorded = { url: string; method: string; headers: Record<string, string>; body: unknown };
/** A recorded fetch: answers in order, keeps every request. */
function recordFetch(...answers: { status: number; body: unknown }[]) {
  const calls: Recorded[] = [];
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body ? JSON.parse(String(init.body)) : null });
    const a = answers[Math.min(i++, answers.length - 1)]!;
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
  }));
  return calls;
}

const queued = { status: 200, body: { status: "success", data: { code: "MSG_101", message_id: "1ba7d8d0-b680-11f1-91b5-d2a30e0412c2", message: "Message queued", request_id: "2d6f.1" } } };
const zohoError = (status: number, code: string, detail: { code: string; target?: string }) => ({ status, body: { error: { code, message: "x", details: [{ message: "x", ...detail }] } } });

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetBreakers(); });

describe("Zoho CPaaS WhatsApp adapter (live)", () => {
  it("sends the Authentication template with the code, the way Zoho's API reference shows", async () => {
    stubZoho();
    const calls = recordFetch(queued);
    const sent = await zohoWhatsApp.sendAuthCode("+966512345678", "482913", "en");
    expect(sent.id).toBe("1ba7d8d0-b680-11f1-91b5-d2a30e0412c2");
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.url).toBe("https://cpaas.zoho.com/v1.1/whatsapp");
    expect(c.method).toBe("POST");
    expect(c.headers.authorization).toBe("Zoho-enczapikey PHtE6r0KQ-test-key");
    expect(c.headers["content-type"]).toBe("application/json");
    expect(c.body).toMatchObject({ from: "+966110000000", to: "+966512345678", template_key: ZOHO.ZOHO_CPAAS_TEMPLATE_EN, merge_info: { code: "482913" } });
    // Zoho echoes client_reference in its logs: the code never goes there.
    expect(JSON.stringify((c.body as { client_reference: string }).client_reference)).not.toContain("482913");
  });

  it("uses the Arabic template (an alias here), a custom merge key, another data centre and a pasted prefix", async () => {
    stubZoho({ ZOHO_CPAAS_MERGE_KEY: "otp", ZOHO_CPAAS_BASE_URL: "https://cpaas.zoho.sa/v1.1/", ZOHO_CPAAS_API_KEY: "Zoho-enczapikey abc" });
    const calls = recordFetch(queued);
    await zohoWhatsApp.sendAuthCode("966512345678", "551177", "ar");
    expect(calls[0]!.url).toBe("https://cpaas.zoho.sa/v1.1/whatsapp");
    expect(calls[0]!.headers.authorization).toBe("Zoho-enczapikey abc");
    expect(calls[0]!.body).toMatchObject({ template_alias: "mada_code_ar", merge_info: { otp: "551177" } });
    expect(calls[0]!.body).not.toHaveProperty("template_key");
  });

  it("falls back to the English template when there's no Arabic one", () => {
    stubZoho({ ZOHO_CPAAS_TEMPLATE_AR: "" });
    expect(zohoAuthCodeBody("+966512345678", "1", "ar")).toMatchObject({ template_key: ZOHO.ZOHO_CPAAS_TEMPLATE_EN });
  });

  it("is NOT_CONFIGURED without its key, sender or template", async () => {
    stubZoho({ ZOHO_CPAAS_API_KEY: "" });
    recordFetch(queued);
    await expect(zohoWhatsApp.sendAuthCode("+966512345678", "1", "en")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("reads Zoho's error answers: a refused number is undeliverable, the rest is ours to fix", async () => {
    stubZoho();
    recordFetch(zohoError(400, "TM_3301", { code: "SERR_110", target: "to" }));
    await expect(zohoWhatsApp.sendAuthCode("+966512345678", "1", "en")).rejects.toBeInstanceOf(WhatsAppUndeliverable);

    recordFetch(zohoError(401, "TM_4001", { code: "SERR_157" }));
    const bad = await zohoWhatsApp.sendAuthCode("+966512345678", "1", "en").catch((e: unknown) => e);
    expect(bad).not.toBeInstanceOf(WhatsAppUndeliverable);
    expect(String(bad)).toContain("TM_4001/SERR_157");

    recordFetch(zohoError(401, "TM_4001", { code: "WA_103" }));
    await expect(zohoWhatsApp.sendAuthCode("+966512345678", "1", "en")).rejects.toThrow(/WA_103/);
    recordFetch(zohoError(403, "TM_3601", { code: "WSE_107", target: "from" }));
    await expect(zohoWhatsApp.sendAuthCode("+966512345678", "1", "en")).rejects.toThrow(/WSE_107/);
    recordFetch({ status: 503, body: {} });
    await expect(zohoWhatsApp.sendAuthCode("+966512345678", "1", "en")).rejects.toThrow(/answered 503/);
  });

  it("watches the message log briefly: undelivered throws, delivered returns", async () => {
    stubZoho({ ZOHO_CPAAS_CONFIRM_MS: "1500" });
    const calls = recordFetch(queued, { status: 200, body: { status: "success", data: { status: "undelivered" } } });
    const e = await zohoWhatsApp.sendAuthCode("+966512345678", "482913", "en").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(WhatsAppUndeliverable);
    expect((e as WhatsAppUndeliverable).code).toBe("undelivered");
    expect(calls[1]!.url).toBe("https://cpaas.zoho.com/v1.1/whatsapp/logs/1ba7d8d0-b680-11f1-91b5-d2a30e0412c2");
    expect(calls[1]!.headers.authorization).toBe("Zoho-enczapikey PHtE6r0KQ-test-key");

    const ok = recordFetch(queued, { status: 200, body: { status: "success", data: { status: "processing" } } }, { status: 200, body: { status: "success", data: { status: "delivered" } } });
    await expect(zohoWhatsApp.sendAuthCode("+966512345678", "482913", "en")).resolves.toMatchObject({ id: expect.any(String) });
    expect(ok).toHaveLength(3);
  });

  it("a number WhatsApp refuses is an answer, not an outage: the circuit stays closed", async () => {
    stubZoho();
    vi.stubEnv("SUPPLIER_MODE_WHATSAPP", "live");
    recordFetch(zohoError(400, "TM_3301", { code: "SERR_110", target: "to" }));
    for (let i = 0; i < 8; i++) await expect(suppliers.whatsappCodes().sendAuthCode("+966512345678", "1", "en")).rejects.toBeInstanceOf(WhatsAppUndeliverable);
    recordFetch(queued);
    await expect(suppliers.whatsappCodes().sendAuthCode("+966512345678", "1", "en")).resolves.toBeTruthy();
  });
});

/* ───────────── the channel, in the Send SMS hook ───────────── */

const SECRET = `v1,whsec_${Buffer.from("a-32-byte-secret-for-the-sms-hook!").toString("base64")}`;
async function hook(payload: unknown) {
  const raw = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const id = `msg_${Math.random().toString(36).slice(2)}`;
  const res = await smsHook(new Request("http://localhost/api/app/v1/auth/sms-hook", {
    method: "POST", body: raw,
    headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": signStandardWebhook(SECRET, id, ts, raw) },
  }));
  return { status: res.status, json: JSON.parse(await res.text()) as Record<string, unknown> };
}
const sentTo = (phone: string, code: string) => outbox.filter((m) => m.to === phone && m.body.includes(code));
/** A number the mock says isn't on WhatsApp. */
const notOnWhatsApp = () => `${newPhone().slice(0, -4)}0000`;
const hint = async (phone: string, channel?: "whatsapp" | "sms") => {
  const r = await call(hintPost, { body: { phone, channel }, ip: freshIp() });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return PhoneChannelResponse.parse(r.json);
};
const ticket = async (t: string) => {
  const res = await ticketGet(new Request(`http://localhost/api/app/v1/auth/phone-channel/${t}`), { params: Promise.resolve({ ticket: t }) });
  return (await res.json()) as { sentVia: string | null };
};

describe("POST /auth/sms-hook picks the channel", () => {
  beforeEach(() => { vi.stubEnv("SUPABASE_SMS_HOOK_SECRET", SECRET); });

  it("goes on WhatsApp by default when WhatsApp is set up, in the person's language", async () => {
    expect(phoneCodeSetting()).toBe("whatsapp");
    expect(phoneChannels()).toEqual(["whatsapp", "sms"]);
    const phone = newPhone();
    expect(await hook({ user: { phone: phone.slice(1) }, sms: { otp: "300111" } })).toEqual({ status: 200, json: {} });
    expect(sentTo(phone, "300111").map((m) => [m.channel, m.body])).toEqual([["whatsapp", "auth_code[en](300111)"]]);

    const ar = newPhone();
    await hook({ user: { phone: ar, user_metadata: { locale: "ar" } }, sms: { otp: "300222" } });
    expect(sentTo(ar, "300222")[0]?.body).toBe("auth_code[ar](300222)");
    const audit = await db.execute<{ summary: string; data: { channel: string } }>(rawSql`SELECT summary, data FROM app_audit WHERE action = 'auth.otp_sent' ORDER BY created_at DESC LIMIT 1`);
    expect(audit[0]!.summary).toContain("on WhatsApp");
    expect(audit[0]!.summary).not.toContain("300222");
    expect(audit[0]!.data.channel).toBe("whatsapp");
  });

  it("sends by SMS with PHONE_CODE_CHANNEL=sms, and when WhatsApp isn't set up", async () => {
    vi.stubEnv("PHONE_CODE_CHANNEL", "sms");
    expect(phoneChannels()).toEqual(["sms", "whatsapp"]);
    const phone = newPhone();
    await hook({ user: { phone }, sms: { otp: "300333" } });
    expect(sentTo(phone, "300333").map((m) => m.channel)).toEqual(["sms"]);

    vi.stubEnv("PHONE_CODE_CHANNEL", "");
    vi.stubEnv("SUPPLIER_MODE_WHATSAPP", "live"); // live, but no Zoho credentials
    expect(phoneCodeSetting()).toBe("sms");
    expect(phoneChannels()).toEqual(["sms"]);
    const other = newPhone();
    await hook({ user: { phone: other }, sms: { otp: "300444" } });
    expect(sentTo(other, "300444").map((m) => m.channel)).toEqual(["sms"]);
  });

  it("follows the app's hint, and the ticket says how it went", async () => {
    const phone = newPhone();
    const h = await hint(phone, "sms");
    expect(h.channels).toEqual(["whatsapp", "sms"]);
    expect(await ticket(h.ticket)).toEqual({ sentVia: null });
    await hook({ user: { phone: phone.slice(1) }, sms: { otp: "300555" } });
    expect(sentTo(phone, "300555").map((m) => m.channel)).toEqual(["sms"]);
    expect(await ticket(h.ticket)).toEqual({ sentVia: "sms" });

    // "Send on WhatsApp instead": the newest hint wins.
    const back = await hint(phone, "whatsapp");
    await hook({ user: { phone }, sms: { otp: "300666" } });
    expect(sentTo(phone, "300666").map((m) => m.channel)).toEqual(["whatsapp"]);
    expect(await ticket(back.ticket)).toEqual({ sentVia: "whatsapp" });
  });

  it("whatsapp_then_sms: a number that isn't on WhatsApp gets the same code by SMS at once", async () => {
    vi.stubEnv("PHONE_CODE_CHANNEL", "whatsapp_then_sms");
    const phone = notOnWhatsApp();
    const h = await hint(phone);
    expect(await hook({ user: { phone, user_metadata: { locale: "ar" } }, sms: { otp: "300777" } })).toEqual({ status: 200, json: {} });
    const sent = sentTo(phone, "300777");
    expect(sent.map((m) => m.channel)).toEqual(["sms"]);
    expect(sent[0]!.body).toMatch(/مادا/); // the Arabic SMS
    expect(await ticket(h.ticket)).toEqual({ sentVia: "sms" });
  });

  it("whatsapp_then_sms also covers a WhatsApp outage or a missing setup", async () => {
    vi.stubEnv("PHONE_CODE_CHANNEL", "whatsapp_then_sms");
    vi.stubEnv("SUPPLIER_MODE_WHATSAPP", "live");
    stubZoho();
    recordFetch({ status: 503, body: {} });
    const phone = newPhone();
    expect((await hook({ user: { phone }, sms: { otp: "300888" } })).status).toBe(200);
    expect(sentTo(phone, "300888").map((m) => m.channel)).toEqual(["sms"]);
  });

  it("whatsapp alone: a refusal answers 503 to Supabase (the app then offers SMS)", async () => {
    vi.stubEnv("PHONE_CODE_CHANNEL", "whatsapp");
    const phone = notOnWhatsApp();
    const r = await hook({ user: { phone }, sms: { otp: "300999" } });
    expect(r.status).toBe(503);
    expect(sentTo(phone, "300999")).toEqual([]);
    // The app's "Send by SMS instead" leaves an SMS hint: that goes through.
    await hint(phone, "sms");
    expect((await hook({ user: { phone }, sms: { otp: "301000" } })).status).toBe(200);
    expect(sentTo(phone, "301000").map((m) => m.channel)).toEqual(["sms"]);
  });

  it("ignores a hint for a channel that isn't set up", async () => {
    vi.stubEnv("SUPPLIER_MODE_WHATSAPP", "live"); // no Zoho credentials
    const phone = newPhone();
    const h = await hint(phone, "whatsapp");
    expect(h.channels).toEqual(["sms"]);
    await hook({ user: { phone }, sms: { otp: "301100" } });
    expect(sentTo(phone, "301100").map((m) => m.channel)).toEqual(["sms"]);
  });
});

describe("POST /auth/phone-channel and GET /config", () => {
  it("checks the number, keeps only a hash of it, and limits each number", async () => {
    expect((await call(hintPost, { body: { phone: "12" }, ip: freshIp() })).status).toBe(400);
    expect((await call(hintPost, { body: { phone: "+966512345678", channel: "pigeon" }, ip: freshIp() })).status).toBe(400);

    const phone = newPhone();
    const h = await hint(phone, "sms");
    const rows = await db.execute<{ phone_hash: string }>(rawSql`SELECT phone_hash FROM app_phone_code_hints WHERE id = ${h.ticket}`);
    expect(rows[0]!.phone_hash).not.toContain(phone.slice(4));
    for (let i = 1; i < PHONE_CHANNEL_LIMITS.perPhonePer10Min; i++) await hint(phone);
    const limited = await call(hintPost, { body: { phone }, ip: freshIp() });
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe("RATE_LIMITED");
  });

  it("limits each network", async () => {
    const ip = freshIp();
    for (let i = 0; i < PHONE_CHANNEL_LIMITS.perIpPer10Min; i++) expect((await call(hintPost, { body: { phone: newPhone() }, ip })).status).toBe(200);
    expect((await call(hintPost, { body: { phone: newPhone() }, ip })).status).toBe(429);
  });

  it("reads an unknown or malformed ticket as nothing sent", async () => {
    expect(await ticket("1ba7d8d0-b680-11f1-91b5-d2a30e0412c2")).toEqual({ sentVia: null });
    expect(await ticket("not-a-ticket")).toEqual({ sentVia: null });
  });

  it("tells the app which channels exist, the usual one first", async () => {
    const r = await call(configGet, { method: "GET" });
    expect(ConfigResponse.parse(r.json).phoneChannels).toEqual(["whatsapp", "sms"]);
    vi.stubEnv("PHONE_CODE_CHANNEL", "sms");
    expect(ConfigResponse.parse((await call(configGet, { method: "GET" })).json).phoneChannels).toEqual(["sms", "whatsapp"]);
  });
});
