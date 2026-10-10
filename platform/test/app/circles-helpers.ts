import { SignInResponse } from "@mada/shared";
import { db } from "@/db";
import { appTrips } from "@/db/app-schema";
import { POST as otpStart } from "@/app/api/app/v1/auth/otp/start/route";
import { POST as otpVerify } from "@/app/api/app/v1/auth/otp/verify/route";
import { PATCH as mePatch } from "@/app/api/app/v1/me/route";
import { call, freshIp, newPhone, type Handler } from "./helpers";

export type Who = { token: string; id: string; phone: string; name: string };

/** A signed-in person with a first name. */
export async function person(name: string): Promise<Who> {
  const phone = newPhone();
  const ip = freshIp();
  await call(otpStart, { body: { phone }, ip });
  const r = SignInResponse.parse((await call(otpVerify, { body: { phone, code: "123456" }, ip })).json);
  await call(mePatch, { method: "PATCH", token: r.tokens.accessToken, body: { name, onboarded: true } });
  return { token: r.tokens.accessToken, id: r.user.id, phone, name };
}

/** A dynamic route handler, called the way Next calls it. */
export const withParams = <P extends Record<string, string>>(h: (req: Request, ctx: { params: Promise<P> }) => Promise<Response>, params: P): Handler =>
  (req) => h(req, { params: Promise.resolve(params) });

export async function trip(ownerId: string, city: string, country: string, startDate: string, endDate: string) {
  await db.insert(appTrips).values({ ownerId, city, country, startDate, endDate, status: "confirmed" });
}

export { call };
