import "server-only";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { AIRPORT_GEO, zonedToInstant } from "@mada/shared";
import { db } from "@/db";
import { appSegments, appTrackedFlights, appTrips } from "@/db/app-schema";
import { appTrackedExtras } from "@/db/app-schema-trips";
import { flightStatusVendor } from "../suppliers";
import { alertFromInfo, applyAlert } from "../trips/status";
import { activeSubscriptions, ALERT_WINDOW_H, alertsEnabled, checkBalance, lastBalance, reconcile } from "./alerts";
import { flightStatusNow } from "./service";

/*
 * The flights job (/api/cron/flights, every 5 minutes): for every booked trip segment and every tracked flight with
 * alerts on, from yesterday to three days ahead, ask for status when the cadence says it's due (cadence.ts), and run
 * what changed through the disruption logic (applyAlert: gate change, delay of 15+ minutes, cancellation; each told
 * once). With AeroDataBox alerts working (a webhook secret set, credits in the balance), it keeps the flight-number
 * subscriptions in step instead and only polls flights whose subscription failed. Mock mode does nothing here.
 */

const H = 3_600_000;
const MAX_LOOKUPS = 25;

type Candidate = { flightNumber: string; day: string; departAt: number; arriveAt: number | null };

const tzOf = (airport: string | null) => (airport && AIRPORT_GEO[airport]?.[2]) || "Asia/Riyadh";
const instant = (local: string | null, tz: string) => { if (!local) return null; try { return zonedToInstant(local.replace(" ", "T").slice(0, 16), tz).getTime(); } catch { return null; } };

export async function candidates(now: number): Promise<Candidate[]> {
  const today = new Date(now).toISOString().slice(0, 10);
  const segs = await db.select({ no: appSegments.flightNumber, dep: appSegments.departLocal, depTz: appSegments.departTz, arr: appSegments.arriveLocal, arrTz: appSegments.arriveTz })
    .from(appSegments).innerJoin(appTrips, eq(appTrips.id, appSegments.tripId))
    .where(and(notInArray(appTrips.status, ["cancelled", "planning"]), sql`${appSegments.departLocal}::date BETWEEN ${today}::date - 1 AND ${today}::date + 3`));
  const tracked = await db.select({ no: appTrackedFlights.flightNumber, day: appTrackedFlights.date, dep: appTrackedFlights.departLocal, arr: appTrackedFlights.arriveLocal, from: appTrackedFlights.fromAirport, to: appTrackedFlights.toAirport })
    .from(appTrackedFlights).innerJoin(appTrackedExtras, eq(appTrackedExtras.trackedId, appTrackedFlights.id))
    .where(and(eq(appTrackedExtras.alerts, true), sql`${appTrackedFlights.date} BETWEEN ${today}::date - 1 AND ${today}::date + 3`));
  const out = new Map<string, Candidate>();
  for (const s of segs) {
    const day = String(s.dep).slice(0, 10);
    out.set(`${s.no}|${day}`, { flightNumber: s.no, day, departAt: instant(String(s.dep), s.depTz) ?? Date.parse(`${day}T12:00:00Z`), arriveAt: instant(String(s.arr), s.arrTz) });
  }
  for (const t of tracked) {
    const key = `${t.no}|${t.day}`;
    if (out.has(key)) continue;
    out.set(key, { flightNumber: t.no, day: t.day, departAt: instant(t.dep, tzOf(t.from)) ?? Date.parse(`${t.day}T12:00:00Z`), arriveAt: instant(t.arr, tzOf(t.to)) });
  }
  // Not yet landed (+2 h), and not more than three days out.
  return [...out.values()].filter((c) => (c.arriveAt ?? c.departAt + 6 * H) + 2 * H > now && c.departAt < now + ALERT_WINDOW_H * H)
    .sort((a, b) => a.departAt - b.departAt);
}

export async function flightsJob(now = Date.now()): Promise<Record<string, number>> {
  const vendor = flightStatusVendor();
  if (vendor === "mock" || vendor === "none") return { skipped: 1 };
  const list = await candidates(now);
  let push = new Set<string>();
  const out: Record<string, number> = { flights: list.length, polled: 0, told: 0, subscribed: 0, removed: 0, failed: 0 };
  if (vendor === "aerodatabox" && alertsEnabled()) {
    const credits = (await checkBalance()) ?? (await lastBalance());
    out.credits = credits ?? -1;
    if (credits !== null && credits > 0) {
      const r = await reconcile(new Set(list.map((c) => c.flightNumber)));
      Object.assign(out, r);
      push = await activeSubscriptions();
    }
  }
  for (const c of list) {
    if (push.has(c.flightNumber)) continue;
    if (out.polled! >= MAX_LOOKUPS) break;
    const r = await flightStatusNow(c.flightNumber, c.day, { now, departAt: c.departAt, arriveAt: c.arriveAt });
    if (!r.fresh) continue;
    out.polled! += 1;
    if (r.info) out.told! += (await applyAlert(alertFromInfo(r.info, c.day))).told;
  }
  return out;
}
