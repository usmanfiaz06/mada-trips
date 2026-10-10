import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ApiErrorBody, MeResponse, SignInResponse, stripIsolates, t } from "@mada/shared";
import { db } from "@/db";
import { appNotifications } from "@/db/app-schema";
import { outbox } from "@/lib/app/suppliers";
import { notify } from "@/lib/app/trips/notify";
import { inLocale } from "@/lib/app/resilience/request";
import { POST as otpStart } from "@/app/api/app/v1/auth/otp/start/route";
import { POST as otpVerify } from "@/app/api/app/v1/auth/otp/verify/route";
import { GET as meGet, PATCH as mePatch } from "@/app/api/app/v1/me/route";
import { freshIp, newPhone, type Handler } from "./helpers";

/** Like helpers.call, with the phone's language in Accept-Language. */
async function call(handler: Handler, o: { method?: string; body?: unknown; token?: string; ip?: string; lang?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": o.ip ?? freshIp(), "user-agent": "vitest" };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.lang) headers["accept-language"] = o.lang;
  const res = await handler(new Request("http://localhost/api/app/v1/test", { method: o.method ?? "POST", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }), { params: Promise.resolve({}) });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: (text ? JSON.parse(text) : null) as any };
}

async function signUp(lang: string) {
  const phone = newPhone();
  const ip = freshIp();
  expect((await call(otpStart, { body: { phone }, ip, lang })).status).toBe(200);
  const v = await call(otpVerify, { body: { phone, code: "123456", device: { platform: "ios", name: "Test iPhone" } }, ip, lang });
  expect(v.status, JSON.stringify(v.json)).toBe(200);
  return SignInResponse.parse(v.json);
}

describe("the traveller's language", () => {
  it("sends the sign-in text in the phone's language (Accept-Language)", async () => {
    const phone = newPhone();
    expect((await call(otpStart, { body: { phone }, lang: "ar-SA,ar;q=0.9,en;q=0.8" })).status).toBe(200);
    const sms = outbox.find((m) => m.to === phone);
    expect(sms?.body).toContain("رمزك في مادا للرحلات");
    const en = newPhone();
    await call(otpStart, { body: { phone: en }, lang: "en-GB" });
    expect(outbox.find((m) => m.to === en)?.body).toContain("is your Mada Trips code");
  });

  it("answers problems in Arabic before sign-in, and in English by default", async () => {
    const ar = ApiErrorBody.parse((await call(otpStart, { body: {}, lang: "ar" })).json);
    expect(ar.error.message).toBe(t("error.validation", undefined, "ar"));
    const plain = ApiErrorBody.parse((await call(otpStart, { body: {} })).json);
    expect(plain.error.message).toBe("A detail needs another look.");
  });

  it("saves the language on a new account, and the account's language wins after sign-in", async () => {
    const s = await signUp("ar-SA");
    expect(s.user.locale).toBe("ar");
    // The app asks in English this time; the saved language still answers.
    const bad = ApiErrorBody.parse((await call(mePatch, { method: "PATCH", body: {}, token: s.tokens.accessToken, lang: "en" })).json);
    expect(bad.error.message).toBe(t("error.validation", undefined, "ar"));
    // Switching in Profile › Language saves it, and answers follow.
    const p = await call(mePatch, { method: "PATCH", body: { locale: "en" }, token: s.tokens.accessToken, lang: "en" });
    expect(MeResponse.parse(p.json).user.locale).toBe("en");
    const after = ApiErrorBody.parse((await call(mePatch, { method: "PATCH", body: {}, token: s.tokens.accessToken, lang: "ar" })).json);
    expect(after.error.message).toBe("A detail needs another look.");
    expect(MeResponse.parse((await call(meGet as Handler, { method: "GET", token: s.tokens.accessToken })).json).user.locale).toBe("en");
  });

  it("writes notifications in the receiving traveller's language, whoever's request runs", async () => {
    const ar = await signUp("ar");
    const en = await signUp("en");
    const vars = { flight: "SV263", gate: "C4", minutes: 6 };
    // Run from an English request: the Arabic traveller still gets Arabic, the English one English.
    await inLocale("en", async () => {
      await notify(ar.user.id, { kind: "gate_change", level: "passive", copy: "notify.gateChange", vars });
      await notify(en.user.id, { kind: "gate_change", level: "passive", copy: "notify.gateChange", vars });
    });
    const [a] = await db.select().from(appNotifications).where(eq(appNotifications.userId, ar.user.id));
    const [e] = await db.select().from(appNotifications).where(eq(appNotifications.userId, en.user.id));
    expect(stripIsolates(a!.title)).toBe("تغيّرت البوابة إلى C4");
    expect(stripIsolates(a!.body)).toBe("الصعود إلى SV263 الآن من C4. المشي إليها 6 دقائق.");
    expect(e!.title).toBe("Gate changed to C4");
  });

  it("formats money and dates in the request's language", async () => {
    const { formatSar, dayLabel } = await import("@mada/shared");
    expect(inLocale("ar", () => formatSar(864000))).toBe("8,640 ر.س");
    expect(inLocale("ar", () => dayLabel("2027-03-11", { today: "2027-01-01" }))).toBe("الخميس 11 مارس");
    expect(formatSar(864000)).toBe("SAR 8,640");
  });
});
