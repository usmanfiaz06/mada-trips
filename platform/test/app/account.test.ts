import { describe, expect, it } from "vitest";
import { sql as rawSql } from "drizzle-orm";
import { AccountResponse, ConsentsResponse, DevicesResponse, ExportResponse, MeResponse } from "@mada/shared";
import { db } from "@/db";
import { addCredit } from "@/lib/app/credit";
import { anonymiseAccount, processExport, purgeDueAccounts } from "@/lib/app/account/privacy";
import { outbox } from "@/lib/app/suppliers";
import { GET as accountGet, PATCH as accountPatch } from "@/app/api/app/v1/account/route";
import { DELETE as photoDelete, GET as photoGet, PUT as photoPut } from "@/app/api/app/v1/account/photo/route";
import { GET as devicesGet } from "@/app/api/app/v1/account/devices/route";
import { DELETE as deviceDelete } from "@/app/api/app/v1/account/devices/[id]/route";
import { POST as signOutAll } from "@/app/api/app/v1/account/devices/signout-all/route";
import { DELETE as deletionCancel, POST as deletionPost } from "@/app/api/app/v1/account/deletion/route";
import { POST as emailStart } from "@/app/api/app/v1/me/email/start/route";
import { POST as emailVerify } from "@/app/api/app/v1/me/email/verify/route";
import { POST as phoneStart } from "@/app/api/app/v1/me/phone/start/route";
import { POST as phoneVerify } from "@/app/api/app/v1/me/phone/verify/route";
import { DELETE as methodDelete, POST as methodPost } from "@/app/api/app/v1/me/methods/[provider]/route";
import { GET as consentsGet, PATCH as consentsPatch } from "@/app/api/app/v1/consents/route";
import { GET as exportGet, POST as exportPost } from "@/app/api/app/v1/export/route";
import { GET as exportFile } from "@/app/api/app/v1/export/[id]/file/route";
import { GET as meGet } from "@/app/api/app/v1/me/route";
import { POST as peoplePost } from "@/app/api/app/v1/people/route";
import { POST as docsPost } from "@/app/api/app/v1/documents/route";
import { GET as peopleGet } from "@/app/api/app/v1/people/route";
import { call, newPhone } from "./helpers";
import { JPEG, PDF, callP, form, signIn } from "./wallet-helpers";

async function verifiedEmail(token: string, email = `omar.${Date.now()}@example.com`) {
  expect((await call(emailStart, { token, body: { email } })).status).toBe(200);
  const r = await call(emailVerify, { token, body: { email, code: "123456" } });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return email;
}

describe("account settings", () => {
  it("starts with Mada's defaults and saves what changes", async () => {
    const { token } = await signIn();
    const a = AccountResponse.parse((await call(accountGet, { method: "GET", token })).json).account;
    expect(a).toMatchObject({ preferredName: null, home: "RUH", currency: "SAR", faceId: true, consents: { marketing: false, analytics: true }, deleteAt: null, prefs: { seat: "any", meal: "halal", loyalty: [] } });
    const prefs = { ...a.prefs, seat: "window", assist: ["infant", "bassinet"], loyalty: [{ id: "l1", program: "alfursan", number: "48213377" }], notes: "Hessa prefers early flights" };
    const r = await call(accountPatch, { method: "PATCH", token, body: { preferredName: "Abu Sara", home: "JED", currency: "USD", faceId: false, prefs } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.account).toMatchObject({ preferredName: "Abu Sara", home: "JED", currency: "USD", faceId: false, prefs: { seat: "window", loyalty: [{ program: "alfursan" }] } });
    expect(r.json.account.homeAt).not.toBeNull();
  });

  it("refuses preferences that don't make sense", async () => {
    const { token } = await signIn();
    const base = { seat: "any", together: true, meal: "halal", assist: [], loyalty: [], notes: "" };
    const cases = [
      { ...base, assist: ["bassinet"] },
      { ...base, assist: ["wchr", "wchc"] },
      { ...base, loyalty: [{ id: "a", program: "alfursan", number: "12" }] },
      { ...base, loyalty: [{ id: "a", program: "bonvoy", number: "123456789" }, { id: "b", program: "bonvoy", number: "987654321" }] },
    ];
    for (const prefs of cases) expect((await call(accountPatch, { method: "PATCH", token, body: { prefs } })).status).toBe(400);
    expect((await call(accountPatch, { method: "PATCH", token, body: { preferredName: "R2D2" } })).status).toBe(400);
    expect((await call(accountPatch, { method: "PATCH", token, body: {} })).status).toBe(400);
    expect((await call(accountGet, { method: "GET" })).status).toBe(401);
  });
});

describe("email and phone", () => {
  it("verifies a new email with a code, counting down wrong tries", async () => {
    const { token } = await signIn();
    const email = `new.${Date.now()}@example.com`;
    const s = await call(emailStart, { token, body: { email } });
    expect(s.status).toBe(200);
    expect(outbox[0]).toMatchObject({ channel: "email", to: email });
    const wrong = await call(emailVerify, { token, body: { email, code: "000000" } });
    expect(wrong.status).toBe(401);
    expect(wrong.json.error).toMatchObject({ code: "OTP_WRONG", triesLeft: 2, message: "That code doesn't match. 2 tries left." });
    const ok = await call(emailVerify, { token, body: { email, code: "123456" } });
    expect(MeResponse.parse(ok.json).user).toMatchObject({ email, emailRelay: false });
    expect(AccountResponse.parse((await call(accountGet, { method: "GET", token })).json).account.emailVerifiedAt).not.toBeNull();
    expect((await call(emailStart, { token, body: { email: "not-an-email" } })).status).toBe(400);
    // A second code within 30 seconds waits.
    expect((await call(emailStart, { token, body: { email: `x${email}` } })).status).toBe(429);
  });

  it("changes the mobile number: same number, taken number and the code", async () => {
    const a = await signIn();
    const b = await signIn();
    const same = await call(phoneStart, { token: a.token, body: { phone: a.phone } });
    expect(same.status).toBe(400);
    expect(same.json.error.message).toBe("That’s the number you already use.");
    const taken = await call(phoneStart, { token: a.token, body: { phone: b.phone } });
    expect(taken.status).toBe(409);
    expect((await call(phoneStart, { token: a.token, body: { phone: "50 12" } })).status).toBe(400);
    const next = newPhone();
    expect((await call(phoneStart, { token: a.token, body: { phone: next } })).status).toBe(200);
    const v = await call(phoneVerify, { token: a.token, body: { phone: next, code: "123456" } });
    expect(v.status, JSON.stringify(v.json)).toBe(200);
    expect(v.json.user.phone).toBe(next);
  });
});

describe("sign-in methods", () => {
  it("links Apple, and never removes the last way in", async () => {
    const { token } = await signIn();
    const only = await callP(methodDelete, { provider: "phone" }, { method: "DELETE", token });
    expect(only.status).toBe(403);
    expect(only.json.error.message).toBe("This is your only way in. Add another method before you remove this one.");
    const linked = await callP(methodPost, { provider: "apple" }, { method: "POST", token, body: { idToken: `mock:apple${Date.now()}` } });
    expect(linked.status, JSON.stringify(linked.json)).toBe(200);
    expect(linked.json.user.methods).toMatchObject({ apple: true, phone: true });
    const removed = await callP(methodDelete, { provider: "apple" }, { method: "DELETE", token });
    expect(removed.json.user.methods.apple).toBe(false);
    expect((await callP(methodDelete, { provider: "google" }, { method: "DELETE", token })).status).toBe(404);
    expect((await callP(methodPost, { provider: "facebook" }, { method: "POST", token, body: { idToken: "whatever-token" } })).status).toBe(404);
  });
});

describe("devices", () => {
  it("lists sessions, signs one out, and signs out everywhere", async () => {
    const first = await signIn();
    // A second device: the same number signs in again.
    const { POST: otpStart } = await import("@/app/api/app/v1/auth/otp/start/route");
    const { POST: otpVerify } = await import("@/app/api/app/v1/auth/otp/verify/route");
    await new Promise((r) => setTimeout(r, 10));
    await db.execute(rawSql`UPDATE app_otp SET created_at = created_at - interval '1 minute' WHERE phone = ${first.phone}`);
    await call(otpStart, { body: { phone: first.phone }, ip: "10.8.0.9" });
    const second = (await call(otpVerify, { body: { phone: first.phone, code: "123456", device: { platform: "ios", name: "iPad" } }, ip: "10.8.0.9" })).json.tokens.accessToken as string;
    const list = DevicesResponse.parse((await call(devicesGet, { method: "GET", token: first.token })).json).devices;
    expect(list).toHaveLength(2);
    expect(list[0]!.current).toBe(true);
    const ipad = list.find((d) => d.name === "iPad")!;
    expect((await callP(deviceDelete, { id: ipad.id }, { method: "DELETE", token: first.token })).status).toBe(200);
    expect((await call(meGet, { method: "GET", token: second })).json.error.code).toBe("SESSION_REVOKED");
    const other = await signIn();
    expect((await callP(deviceDelete, { id: list[0]!.id }, { method: "DELETE", token: other.token })).status).toBe(404);
    expect((await call(signOutAll, { token: first.token })).status).toBe(200);
    expect((await call(meGet, { method: "GET", token: first.token })).status).toBe(401);
  });
});

describe("consents", () => {
  it("records every change", async () => {
    const { token } = await signIn();
    const r = await call(consentsPatch, { method: "PATCH", token, body: { marketing: true, analytics: false } });
    const c = ConsentsResponse.parse(r.json);
    expect(c.consents).toEqual({ marketing: true, analytics: false });
    expect(c.history.map((h) => `${h.consent}:${h.granted}`).sort()).toEqual(["analytics:false", "marketing:true"]);
    await call(consentsPatch, { method: "PATCH", token, body: { marketing: true } });
    expect(ConsentsResponse.parse((await call(consentsGet, { method: "GET", token })).json).history).toHaveLength(2);
  });
});

describe("profile photo", () => {
  it("stores, serves and removes it", async () => {
    const { token } = await signIn();
    const put = await callP(photoPut, {}, { method: "PUT", token, raw: form({ bytes: JPEG, name: "me.jpg", type: "image/jpeg" }) });
    expect(put.status, JSON.stringify(put.json)).toBe(200);
    expect(put.json.account.photo).not.toBeNull();
    const got = await callP(photoGet, {}, { token });
    expect(got.bytes.equals(JPEG)).toBe(true);
    expect((await callP(photoPut, {}, { method: "PUT", token, raw: form({ bytes: PDF, name: "me.pdf", type: "application/pdf" }) })).status).toBe(400);
    expect((await callP(photoDelete, {}, { method: "DELETE", token })).json.account.photo).toBeNull();
    expect((await callP(photoGet, {}, { token })).status).toBe(404);
  });
});

describe("a copy of everything", () => {
  it("needs an email, then emails a link to a JSON copy only the owner can open", async () => {
    const { token, user } = await signIn();
    const no = await call(exportPost, { token });
    expect(no.status).toBe(400);
    expect(no.json.error.message).toBe("Add an email in Your details first, so we have somewhere to send it.");
    const email = await verifiedEmail(token);
    const r = await call(exportPost, { token });
    expect(r.status).toBe(202);
    const ex = ExportResponse.parse(r.json).export!;
    expect(ex).toMatchObject({ status: "pending", email });
    // Asking again within 24 hours returns the same request.
    expect((await call(exportPost, { token })).json.export.id).toBe(ex.id);
    const done = await processExport(ex.id);
    expect(done.status).toBe("sent");
    expect(outbox.find((o) => o.to === email && o.body.includes(ex.id))).toBeTruthy();
    expect(ExportResponse.parse((await call(exportGet, { method: "GET", token })).json).export!.status).toBe("sent");
    const file = await callP(exportFile, { id: ex.id }, { token });
    expect(file.status).toBe(200);
    const copy = JSON.parse(file.bytes.toString("utf8"));
    expect(copy.account.email).toBe(email);
    expect(copy.household[0].isSelf).toBe(true);
    expect(copy.account.phone).toBe(user.phone);
    const other = await signIn();
    expect((await callP(exportFile, { id: ex.id }, { token: other.token })).status).toBe(404);
  });
});

describe("deleting an account", () => {
  it("schedules 30 days out, can be cancelled, and needs the word DELETE", async () => {
    const { token } = await signIn();
    expect((await call(deletionPost, { token, body: { confirm: "delete" } })).status).toBe(400);
    const r = await call(deletionPost, { token, body: { confirm: "DELETE" } });
    expect(r.status).toBe(200);
    const days = (Date.parse(r.json.deleteAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect((await call(accountGet, { method: "GET", token })).json.account.deleteAt).toBe(r.json.deleteAt);
    expect((await call(deletionCancel, { method: "DELETE", token })).json.deleteAt).toBeNull();
  });

  it("anonymises when the 30 days are up: personal rows and files go, the credit ledger stays", async () => {
    const { token, user } = await signIn();
    await call(peoplePost, { token, body: { givenNames: "Hessa", surname: "Alharbi", relation: "spouse" } });
    const self = (await call(peopleGet, { method: "GET", token })).json.people[0].id;
    await callP(docsPost, {}, { method: "POST", token, raw: form({ bytes: PDF, name: "v.pdf", type: "application/pdf" }, { personId: self, kind: "visa" }) });
    await db.transaction((tx) => addCredit(tx, { userId: user.id, amount: 10_000, kind: "refund" }));
    await call(deletionPost, { token, body: { confirm: "DELETE" } });
    await db.execute(rawSql`UPDATE app_accounts SET delete_at = now() - interval '1 minute' WHERE user_id = ${user.id}`);
    expect(await purgeDueAccounts()).toBeGreaterThanOrEqual(1);
    const [u] = await db.execute<{ phone: string | null; name: string; deleted_at: Date | null }>(rawSql`SELECT phone, name, deleted_at FROM app_users WHERE id = ${user.id}`);
    expect(u).toMatchObject({ phone: null, name: "" });
    expect(u!.deleted_at).not.toBeNull();
    for (const table of ["app_people", "app_documents"]) {
      const [c] = await db.execute<{ n: number }>(rawSql`SELECT count(*)::int AS n FROM ${rawSql.raw(table)} WHERE owner_id = ${user.id}`);
      expect(c!.n, table).toBe(0);
    }
    const [files] = await db.execute<{ n: number }>(rawSql`SELECT count(*)::int AS n FROM app_files WHERE owner_id = ${user.id} AND deleted_at IS NULL`);
    expect(files!.n).toBe(0);
    const [ledger] = await db.execute<{ n: number }>(rawSql`SELECT count(*)::int AS n FROM app_credit_ledger WHERE user_id = ${user.id}`);
    expect(ledger!.n).toBe(1);
    expect((await call(meGet, { method: "GET", token })).status).toBe(401);
    // The number is free for a new account.
    await anonymiseAccount(user.id); // idempotent
  });
});
