import "server-only";
import { randomInt } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { DemoFlag, todayIn, type Person } from "@mada/shared";
import { db, type Tx } from "@/db";
import { appPeople, appUsers } from "@/db/app-schema";
import { isProductionDeploy, supplierMode } from "../config";
import { AppError } from "../http";
import { listPeople } from "../people";
import { catalogueFlights } from "../suppliers/mock/catalogue-flights";
import { catalogueHotels } from "../suppliers/mock/catalogue-hotels";
import { mockMyFatoorah } from "../suppliers/mock/myfatoorah";
import { liveMyFatoorah } from "../suppliers/live/myfatoorah";
import { claudeAsk } from "../suppliers/live/ask-claude";
import { gdsFlights, rateHawkHotels } from "../suppliers/live/commerce";
import type { AskParser, BookingFlightSupplier, BookingHotelSupplier, BookingPaymentSupplier } from "../suppliers/booking-types";

/*
 * What every booking module shares: the suppliers (mock or live per SUPPLIER_MODE, like M0's), the demo switches, the
 * caller's household, the agent on duty, booking references.
 */

export type Exec = Tx | typeof db;

const notConfiguredAsk: AskParser = { name: "rules-only", async parse() { return null; } };

/** Picked on every call, so an env change or a test takes effect at once. */
export const bookingSuppliers = {
  flights: (): BookingFlightSupplier => (supplierMode("flights") === "live" ? (gdsFlights as BookingFlightSupplier) : catalogueFlights),
  hotels: (): BookingHotelSupplier => (supplierMode("hotels") === "live" ? (rateHawkHotels as BookingHotelSupplier) : catalogueHotels),
  payments: (): BookingPaymentSupplier => (supplierMode("payments") === "live" ? liveMyFatoorah : mockMyFatoorah),
  /** Live: Claude with a strict tool schema. Mock: none, the deterministic rules answer. */
  ask: (): AskParser => (supplierMode("ai") === "live" ? claudeAsk : notConfiguredAsk),
};

/** Demo switches are honoured only when the suppliers they bend are mocks, and never on a production deployment. */
export function demoFlags(req: Request): Set<DemoFlag> {
  const out = new Set<DemoFlag>();
  if (isProductionDeploy()) return out;
  const mock = (() => { try { return supplierMode("flights") === "mock" || supplierMode("payments") === "mock"; } catch { return false; } })();
  if (!mock) return out;
  const raw = [new URL(req.url).searchParams.get("demo") ?? "", req.headers.get("x-mada-demo") ?? ""].join(",");
  for (const f of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const p = DemoFlag.safeParse(f);
    if (p.success) out.add(p.data);
  }
  return out;
}

/** The mock desk moves orders and requests along on its own (polling drives it). Off in live payments mode. */
export function autopilotOn(): boolean {
  if (process.env.APP_DESK_AUTOPILOT === "off") return false;
  try { return supplierMode("payments") === "mock"; } catch { return false; }
}

export const today = () => todayIn();

/** The household, with names as the interface shows them. */
export async function householdOf(ownerId: string): Promise<Person[]> {
  return listPeople(ownerId);
}

/** These people, all from this household (NOT_FOUND otherwise: another household's people don't exist for you). */
export async function travellersOf(ownerId: string, ids: string[], tx: Exec = db): Promise<Person[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  if (unique.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) throw new AppError("NOT_FOUND");
  const rows = await tx.select({ id: appPeople.id }).from(appPeople).where(and(eq(appPeople.ownerId, ownerId), inArray(appPeople.id, unique), isNull(appPeople.deletedAt)));
  if (rows.length !== unique.length) throw new AppError("NOT_FOUND");
  const all = await householdOf(ownerId);
  return unique.map((id) => all.find((p) => p.id === id)!).filter(Boolean);
}

export async function userName(ownerId: string): Promise<string> {
  const [u] = await db.select({ name: appUsers.name }).from(appUsers).where(eq(appUsers.id, ownerId));
  return u?.name ?? "";
}

/**
 * The person on duty for this traveller: their assigned agent on the desk (app_agent_assignments), else the desk's
 * default name for the mock desk. Never invented per screen (COPY.md §1).
 */
export async function agentFor(ownerId: string): Promise<string> {
  try {
    const rows = await db.execute<{ name: string }>(sql`SELECT a.display_name AS name FROM app_agent_assignments x JOIN app_agents a ON a.id = x.agent_id WHERE x.user_id = ${ownerId} AND a.active LIMIT 1`);
    const name = rows[0]?.name;
    if (name) return name;
  } catch { /* the desk's tables aren't there yet */ }
  return process.env.APP_DESK_AGENT_NAME || "Faisal";
}

const REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** A booking reference, shown in full and copyable: 6 characters, no 0/O or 1/I. */
export const newRef = () => Array.from({ length: 6 }, () => REF_CHARS[randomInt(REF_CHARS.length)]).join("");

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
