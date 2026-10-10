import { describe, expect, it } from "vitest";
import { sql as rawSql } from "drizzle-orm";
import { PeopleResponse, PersonResponse, SignInResponse } from "@mada/shared";
import { db } from "@/db";
import { decryptField, passportAad } from "@/lib/app/crypto";
import { POST as otpStart } from "@/app/api/app/v1/auth/otp/start/route";
import { POST as otpVerify } from "@/app/api/app/v1/auth/otp/verify/route";
import { GET as peopleGet, POST as peoplePost } from "@/app/api/app/v1/people/route";
import { call, freshIp, newPhone } from "./helpers";

async function token() {
  const phone = newPhone();
  const ip = freshIp();
  await call(otpStart, { body: { phone }, ip });
  return SignInResponse.parse((await call(otpVerify, { body: { phone, code: "123456" }, ip })).json).tokens.accessToken;
}

const HESSA = {
  givenNames: "Hessa", surname: "Alharbi", relation: "spouse", dateOfBirth: "1988-07-24", sex: "F",
  passport: { number: "a11493107", issuingCountry: "SAU", nationality: "SAU", expiry: "2029-01-15", source: "scan" },
};

describe("household", () => {
  it("starts with just you", async () => {
    const r = await call(peopleGet, { method: "GET", token: await token() });
    const { people } = PeopleResponse.parse(r.json);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ isSelf: true, relation: "self", passport: null });
  });

  it("adds a traveller with an encrypted passport and only ever returns it masked", async () => {
    const t = await token();
    const r = await call(peoplePost, { token: t, body: HESSA });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const { person } = PersonResponse.parse(r.json);
    expect(person).toMatchObject({ firstName: "Hessa", relation: "spouse", nationality: "SAU" });
    expect(person.passport).toMatchObject({ numberMasked: "A11•••07", expiry: "2029-01-15", source: "scan" });
    expect(JSON.stringify(r.json)).not.toContain("A11493107");

    const [row] = await db.execute<{ passport_number_enc: string }>(rawSql`SELECT passport_number_enc FROM app_people WHERE id = ${person.id}`);
    expect(row!.passport_number_enc).toMatch(/^v1\.[0-9a-f]{8}\./);
    expect(row!.passport_number_enc).not.toContain("A11493107");
    expect(decryptField(row!.passport_number_enc, passportAad(person.id))).toBe("A11493107");
    // Bound to its row: the same ciphertext won't open as someone else's.
    expect(() => decryptField(row!.passport_number_enc, passportAad("00000000-0000-0000-0000-000000000000"))).toThrow();

    const list = PeopleResponse.parse((await call(peopleGet, { method: "GET", token: t })).json).people;
    expect(list.map((p) => p.firstName)).toEqual(["", "Hessa"]);
    const audit = await db.execute<{ summary: string }>(rawSql`SELECT summary FROM app_audit WHERE entity_id = ${person.id}`);
    expect(audit.map((a) => a.summary).join(" ")).not.toContain("A11493107");
  });

  it("keeps each household private", async () => {
    const a = await token();
    await call(peoplePost, { token: a, body: { givenNames: "Sara", surname: "Alharbi", relation: "child" } });
    const b = await token();
    const theirs = PeopleResponse.parse((await call(peopleGet, { method: "GET", token: b })).json).people;
    expect(theirs.map((p) => p.firstName)).not.toContain("Sara");
  });

  it("validates travellers and passports", async () => {
    const t = await token();
    const bad = await call(peoplePost, { token: t, body: { ...HESSA, relation: "self" } });
    expect(bad.status).toBe(400);
    const badPassport = await call(peoplePost, { token: t, body: { ...HESSA, passport: { ...HESSA.passport, number: "A1-1" } } });
    expect(badPassport.status).toBe(400);
    expect(Object.keys(badPassport.json.error.fields)).toEqual(["passport.number"]);
    expect((await call(peoplePost, { body: HESSA })).status).toBe(401);
  });

  it("won't store a passport without the data key", async () => {
    const t = await token();
    const key = process.env.APP_DATA_KEY;
    delete process.env.APP_DATA_KEY;
    try {
      const r = await call(peoplePost, { token: t, body: HESSA });
      expect(r.status).toBe(501);
      expect(r.json.error.code).toBe("NOT_CONFIGURED");
    } finally {
      process.env.APP_DATA_KEY = key;
    }
  });
});
