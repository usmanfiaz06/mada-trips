import { CheckCircle2, Plane, PlaneTakeoff, Send, Users } from "lucide-react";
import { FLIGHT_POSITION_ATTRIBUTION, type FlightPosition } from "@mada/shared";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { sar } from "@/lib/money";
import { disruptionBoard, type BoardFlight } from "@/lib/app/desk/disruptions";
import { slaFor } from "@/lib/app/desk/sla";
import { Badge, Card, CardHead, Empty, Field, Input, PageHeader, Textarea, cx, type Tone } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { AutoRefresh, SlaClock } from "@/components/desk/live";
import { planAction } from "../actions";

export const metadata = { title: "Disruptions · Desk" };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  scheduled: { label: "Scheduled", tone: "neutral" }, on_time: { label: "On time", tone: "ok" }, delayed: { label: "Delayed", tone: "warn" }, boarding: { label: "Boarding", tone: "info" },
  departed: { label: "Departed", tone: "info" }, in_air: { label: "In the air", tone: "info" }, landed: { label: "Landed", tone: "ok" }, cancelled: { label: "Cancelled", tone: "bad" }, diverted: { label: "Diverted", tone: "bad" },
};

// Enough airports to draw where a flight is between its two ends. Unknown airports simply skip the drawing.
const AIRPORTS: Record<string, [number, number]> = {
  RUH: [24.96, 46.7], JED: [21.68, 39.16], DMM: [26.47, 49.8], MED: [24.55, 39.71], AHB: [18.24, 42.66], TIF: [21.48, 40.54], IST: [41.26, 28.74], SAW: [40.9, 29.31],
  DXB: [25.25, 55.36], DOH: [25.27, 51.61], BAH: [26.27, 50.63], CAI: [30.12, 31.41], AMM: [31.72, 35.99], LHR: [51.47, -0.45], CDG: [49.01, 2.55], KUL: [2.74, 101.7],
  BKK: [13.69, 100.75], TBS: [41.67, 44.95], GYD: [40.47, 50.05], MLE: [4.19, 73.53], SSH: [27.98, 34.39], TZX: [40.99, 39.79], AYT: [36.9, 30.8], GVA: [46.24, 6.11],
};

function RouteMap({ from, to, pos }: { from: string; to: string; pos: FlightPosition | null }) {
  const a = AIRPORTS[from], b = AIRPORTS[to];
  if (!a || !b) return null;
  const pts = [a, b, ...(pos ? [[pos.lat, pos.lon] as [number, number]] : [])];
  const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
  const pad = 2.5, minLat = Math.min(...lats) - pad, maxLat = Math.max(...lats) + pad, minLon = Math.min(...lons) - pad, maxLon = Math.max(...lons) + pad;
  const W = 320, H = 150;
  const s = Math.min(W / (maxLon - minLon), H / (maxLat - minLat));
  const ox = (W - (maxLon - minLon) * s) / 2, oy = (H - (maxLat - minLat) * s) / 2;
  const xy = (p: [number, number]) => [ox + (p[1] - minLon) * s, oy + (maxLat - p[0]) * s] as const;
  const [ax, ay] = xy(a), [bx, by] = xy(b);
  const mx = (ax + bx) / 2, my = (ay + by) / 2 - Math.hypot(bx - ax, by - ay) * 0.18;
  const p = pos ? xy([pos.lat, pos.lon]) : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[150px] w-full" role="img" aria-label={`${from} → ${to}`}>
      <defs><pattern id={`g-${from}${to}`} width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="currentColor" opacity="0.12" /></pattern></defs>
      <rect width={W} height={H} fill={`url(#g-${from}${to})`} className="text-tile-ink" />
      <path d={`M${ax},${ay} Q${mx},${my} ${bx},${by}`} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeDasharray="3 4" className="text-tile-ink" />
      {[[ax, ay, from], [bx, by, to]].map(([x, y, c]) => (
        <g key={String(c)}><circle cx={Number(x)} cy={Number(y)} r="4" className="fill-glow-gold" /><text x={Number(x)} y={Number(y) + 16} textAnchor="middle" className="fill-tile-ink-3 text-[10px]">{String(c)}</text></g>
      ))}
      {p && pos && (
        <g transform={`translate(${p[0]},${p[1]}) rotate(${(pos.track ?? 0) - 45})`}>
          <circle r="11" className="fill-glow-green" opacity="0.18" />
          <Plane x={-7} y={-7} width={14} height={14} className="text-glow-mint" fill="currentColor" />
        </g>
      )}
    </svg>
  );
}

const hm = (local: string) => local.slice(11, 16);

export default async function DisruptionsPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const flights = await disruptionBoard();
  const disrupted = flights.filter((f) => f.disrupted);
  const travellers = flights.reduce((s, f) => s + f.travellerCount, 0);
  const airborne = flights.filter((f) => f.position).length;
  const act = can(u, "desk.act"), voucher = can(u, "desk.refund");

  return (
    <>
      <AutoRefresh every={60} />
      <PageHeader eyebrow={t("App desk")} title={t("Disruptions")} subtitle={t("Today's flights with Mada travellers on board. Status from the airline feed, positions from open ADS-B. Travellers on a disrupted flight hear the plan within 10 minutes.")} />
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[[t("Flights today"), flights.length, PlaneTakeoff, "neutral"], [t("Travellers flying"), travellers, Users, "neutral"], [t("Disrupted"), disrupted.length, Plane, disrupted.length ? "bad" : "ok"], [t("In the air now"), airborne, Plane, "info"]].map(([l, n, I, tone]) => {
          const Icon = I as typeof Plane;
          return (
            <Card key={String(l)} className="flex flex-col">
              <div className="flex items-center justify-between text-[13px] text-ink-3"><span>{String(l)}</span><span className={cx("grid size-8 place-items-center rounded-full", tone === "bad" ? "bg-bad-soft text-bad" : tone === "ok" ? "bg-ok-soft text-ok" : tone === "info" ? "bg-info-soft text-info" : "bg-sunken text-ink-3")}><Icon className="size-4" /></span></div>
              <div className="figure mt-5 text-[40px]">{Number(n)}</div>
            </Card>
          );
        })}
      </div>
      {flights.length === 0 ? <Card><Empty icon={<PlaneTakeoff className="size-5" />} title={t("No Mada travellers fly today")} hint={t("Flights on booked trips appear here on the day.")} /></Card> : (
        <div className="space-y-4">
          {flights.map((f) => <FlightCard key={f.key} f={f} focus={sp.focus === f.key} act={act} voucher={voucher} t={t} L={L} />)}
          <p className="text-[11.5px] text-ink-4">{FLIGHT_POSITION_ATTRIBUTION}</p>
        </div>
      )}
    </>
  );
}

function FlightCard({ f, focus, act, voucher, t, L }: { f: BoardFlight; focus: boolean; act: boolean; voucher: boolean; t: Awaited<ReturnType<typeof getT>>; L: string }) {
  const st = STATUS[f.status] ?? { label: f.status, tone: "neutral" as Tone };
  const sla = f.disrupted && !f.plans.length ? slaFor("disruption", f.changedAt) : null;
  return (
    <Card pad={false} id={f.key} className={cx("overflow-hidden", focus && "ring-2 ring-gold", f.disrupted && !f.plans.length && "ring-1 ring-bad/40")}>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="num text-[13px] font-medium text-ink-3">{f.flightNumber}</span><span className="text-[13px] text-ink-3">· {f.carrier}</span>
            <Badge tone={st.tone} dot>{t(st.label)}</Badge>{sla && <SlaClock due={sla.dueAt.toISOString()} opened={sla.openedAt.toISOString()} />}
            {f.plans.length > 0 && <Badge tone="ok"><CheckCircle2 className="size-3" />{t("Plan sent {ago}", { ago: timeAgo(f.plans[0]!.createdAt, L) })}</Badge>}
          </div>
          <div className="mt-3 flex items-end gap-4">
            <div><div className="num text-[30px] font-[380] tracking-[-0.03em]" dir="ltr">{hm(f.departLocal)}</div><div className="text-[13px] text-ink-3">{f.from}</div></div>
            <div className="mb-3 h-px flex-1 bg-line-strong" />
            <div className="text-end"><div className="num text-[30px] font-[380] tracking-[-0.03em]" dir="ltr">{hm(f.arriveLocal)}</div><div className="text-[13px] text-ink-3">{f.to}</div></div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-3">
            {f.terminal && <span>{f.terminal}</span>}{f.gate && <span>{t("Gate {gate}", { gate: f.gate })}</span>}{f.source && <span>{f.source}</span>}
          </div>
          <div className="mt-4">
            <div className="mb-2 text-[12px] font-medium text-ink-3">{f.travellerCount === 1 ? t("1 traveller on board") : t("{n} travellers on board", { n: f.travellerCount })}</div>
            <div className="flex flex-wrap gap-1.5">{f.travellers.map((x) => <span key={x.tripId} className="rounded-full bg-surface-2 px-2.5 py-1 text-[12.5px] text-ink-2 ring-1 ring-line">{x.name}{x.count > 1 ? ` +${x.count - 1}` : ""}</span>)}</div>
          </div>
          {f.plans.map((p) => (
            <div key={p.id} className="mt-4 rounded-2xl bg-ok-soft/50 px-4 py-3 text-[13.5px]">
              <div className="mb-1 text-[11.5px] text-ok">{t("Sent by {name}", { name: p.agentName ?? "—" })} · {fmtDate(p.createdAt, L, true)}{p.voucherAmount ? ` · ${t("SAR {amount} credit each", { amount: sar(p.voucherAmount) })}` : ""}</div>
              <div className="text-ink">{p.plan}</div>
              {p.options.length > 0 && <ul className="mt-1.5 space-y-0.5 text-[12.5px] text-ink-2">{p.options.map((o, i) => <li key={i}>· <span className="text-ink">{o.label}</span> {o.detail}</li>)}</ul>}
            </div>
          ))}
          {f.disrupted && act && (
            <details open={!f.plans.length} className="mt-4 rounded-2xl bg-surface-2 p-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer items-center gap-2 text-[14px] font-medium text-ink"><Send className="size-4 rtl:-scale-x-100" />{f.plans.length ? t("Send an update") : t("Send the rebooking plan")}</summary>
              <ActionForm action={planAction} className="mt-3 space-y-3">
                <input type="hidden" name="flightNumber" value={f.flightNumber} /><input type="hidden" name="date" value={f.date} /><input type="hidden" name="status" value={f.status} />
                <Textarea name="plan" rows={2} required minLength={10} maxLength={400} placeholder={f.status === "cancelled" ? t("We've moved you to XY205 at 21:15. Same seats, and your pickup moves with you.") : t("Your connection still works. We're holding the 21:15 in case it doesn't.")} />
                <div className="grid gap-2 sm:grid-cols-2">
                  {[1, 2].map((i) => <div key={i} className="grid gap-1.5"><Input name="optionLabel" maxLength={60} placeholder={t("Option {n}", { n: i })} /><Input name="optionDetail" maxLength={140} placeholder={t("What it means for them")} /></div>)}
                </div>
                {voucher && <Field label={t("Voucher per account, as Mada credit (SAR, optional)")}><Input name="voucher" inputMode="decimal" placeholder="0" className="num w-40" dir="ltr" /></Field>}
                <SubmitButton variant="gold" className="w-full sm:w-auto"><Send className="size-4 rtl:-scale-x-100" />{f.travellers.length === 1 ? t("Send to 1 account") : t("Send to {n} accounts", { n: f.travellers.length })}</SubmitButton>
              </ActionForm>
            </details>
          )}
        </div>
        <div className="night relative flex flex-col justify-start gap-2 p-5">
          <RouteMap from={f.from} to={f.to} pos={f.position} />
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11.5px] text-tile-ink-3">
            {f.position ? (
              <>
                <div><div>{t("Altitude")}</div><div className="num text-[15px] text-tile-ink" dir="ltr">{f.position.altitudeFt ? `${f.position.altitudeFt.toLocaleString("en-US")} ft` : "—"}</div></div>
                <div><div>{t("Speed")}</div><div className="num text-[15px] text-tile-ink" dir="ltr">{f.position.groundSpeedKt ? `${f.position.groundSpeedKt} kt` : "—"}</div></div>
                <div><div>{t("Seen")}</div><div className="text-[13px] text-tile-ink">{timeAgo(f.position.seenAt, L)}</div></div>
              </>
            ) : <div className="col-span-3 text-[12.5px]">{f.status === "cancelled" ? t("Not flying") : t("Not in the air")}</div>}
          </div>
        </div>
      </div>
    </Card>
  );
}
