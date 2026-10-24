import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ArrowLeft } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { BOOKING_STATUS } from "@/lib/labels";
import { STAFF_STATUS_LABEL, TRACK, type Delivery, type Line } from "@/lib/portal";
import { isUuid } from "@/lib/security";
import { Badge, Card, CardHead, InkCard, KV, Money, RowLink, Table, Td, Th, Textarea, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { ClientMark } from "../../client-mark";
import { advanceRequest } from "../../actions";

const PLACE: Record<string, string> = { office: "Office", home: "Home", site: "Project site", collect: "Collect from Mada" };

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requirePerm("clients.manage");
  const t = await getT();
  const requester = alias(schema.users, "requester");
  const approver = alias(schema.users, "approver");
  const [row] = await db.select({ r: schema.portalRequests, c: schema.clients, by: requester.name, approvedByName: approver.name })
    .from(schema.portalRequests).innerJoin(schema.clients, eq(schema.clients.id, schema.portalRequests.clientId))
    .innerJoin(requester, eq(requester.id, schema.portalRequests.requestedBy))
    .leftJoin(approver, eq(approver.id, schema.portalRequests.approvedBy))
    .where(eq(schema.portalRequests.id, id));
  if (!row) notFound();
  const { r, c } = row;
  const [bills, vehicles] = await Promise.all([
    db.select().from(schema.bookings).where(eq(schema.bookings.portalRequestId, id)).orderBy(asc(schema.bookings.portalMonth)),
    db.select().from(schema.vehicles),
  ]);
  const lines = r.lines as Line[];
  const d = r.delivery as Partial<Delivery>;
  // Before confirmation the cost comes live from the catalog; afterwards it is frozen on the request.
  const liveCost = (l: Line) => l.unitCost ?? ((vehicles.find((v) => v.id === l.vehicleId)?.cost as Record<string, number> | undefined)?.[String(r.term)] ?? null);
  const costs = lines.map(liveCost);
  const monthlyCost = costs.some((x) => x === null) ? null : lines.reduce((a, l, i) => a + (costs[i] as number) * l.qty, 0);
  const step = TRACK.indexOf(r.status as (typeof TRACK)[number]);

  return (
    <>
      <Link href="/adminwork/corporate" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Workspace requests")}</Link>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <ClientMark clientId={c.id} name={c.name} hasLogo={!!c.portalLogoId} color={c.portalColor} size={48} />
          <div>
            <Badge tone={r.status === "submitted" ? "gold" : r.status === "active" ? "ok" : ["declined", "cancelled"].includes(r.status) ? "bad" : "info"}>{t(STAFF_STATUS_LABEL[r.status])}</Badge>
            <h1 className="mt-2 text-[30px] font-[380] leading-none tracking-[-0.035em]">{c.name} · <span className="font-mono text-[24px]">{r.ref}</span></h1>
          </div>
        </div>
        <Link href={`/adminwork/corporate/inbox?c=${c.id}`} className="text-[13px] font-medium text-ink underline decoration-gold decoration-2 underline-offset-4">{t("Conversation with {name}", { name: c.name })}</Link>
      </header>

      <ol className="mb-6 grid grid-cols-6 gap-2">
        {TRACK.map((s, i) => (
          <li key={s} className="flex flex-col gap-1.5">
            <span className={cx("h-1.5 rounded-full", i < step || r.status === "completed" ? "bg-ok" : i === step ? "bg-gold" : "bg-line")} />
            <span className={cx("text-[12px]", i <= step ? "text-ink" : "text-ink-3")}>{t(STAFF_STATUS_LABEL[s])}</span>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card pad={false}>
            <div className="p-6 pb-2"><CardHead title={t("Cars")} hint={t("{n} months · prices per car per month, before VAT", { n: r.term })} /></div>
            <Table>
              <thead><tr><Th>{t("Vehicle")}</Th><Th align="end">{t("Qty")}</Th><Th align="end">{t("Client price")}</Th><Th align="end">{t("Supplier cost")}</Th><Th align="end">{t("Margin / month")}</Th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <Td className="font-medium text-ink">{l.name}</Td>
                    <Td align="end" className="num">{l.qty}</Td>
                    <Td align="end"><Money v={l.unitPrice} /></Td>
                    <Td align="end">{costs[i] === null ? <Badge tone="warn">{t("No cost yet")}</Badge> : <Money v={costs[i] as number} />}</Td>
                    <Td align="end">{costs[i] === null ? "—" : <Money v={(l.unitPrice - (costs[i] as number)) * l.qty} className={l.unitPrice <= (costs[i] as number) ? "text-bad" : "text-ok"} />}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card>
            <CardHead title={t("Delivery")} />
            <KV cols={3} items={[
              [t("Where"), t(PLACE[d.place ?? "office"])], [t("City"), d.city], [t("Address"), d.address || "—"],
              [t("Handover contact"), d.contact || "—"], [t("Time"), d.window === "evening" ? t("Evening") : t("Morning")], [t("Sent by"), row.by],
            ]} />
            {r.note && <p className="mt-4 rounded-2xl bg-sunken px-4 py-3 text-[13.5px]">{r.note}</p>}
          </Card>

          <Card pad={false}>
            <div className="p-6 pb-2"><CardHead title={t("Monthly bills")} hint={t("Each month is a corporate sale in Sales, on the client's credit terms.")} /></div>
            {bills.length === 0 ? <p className="px-6 pb-6 text-[13.5px] text-ink-3">{t("Nothing billed yet. Bills start after delivery.")}</p> : (
              <Table>
                <thead><tr><Th>{t("Sale")}</Th><Th>{t("Month")}</Th><Th align="end">{t("Amount incl. VAT")}</Th><Th>{t("Status")}</Th><Th>{t("Due")}</Th></tr></thead>
                <tbody>
                  {bills.map((b) => (
                    <tr key={b.id}>
                      <Td><RowLink href={`/adminwork/sales/${b.id}`}>{b.ref}</RowLink></Td>
                      <Td>{b.portalMonth} / {r.term}</Td>
                      <Td align="end"><Money v={b.sellPrice} /></Td>
                      <Td><Badge tone={BOOKING_STATUS[b.status]?.tone ?? "neutral"}>{t(BOOKING_STATUS[b.status]?.label ?? b.status)}</Badge></Td>
                      <Td>{fmtDate(b.dueDate, t.locale)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <InkCard>
            <div className="text-[12px] text-tile-ink-3">{t("Monthly, before VAT")}</div>
            <div className="figure mt-3 text-[40px] text-tile-ink"><Money v={r.monthly} muted /></div>
            <div className="mt-5 grid grid-cols-2 gap-4 text-[13px]">
              <div><div className="text-tile-ink-3">{t("Contract value")}</div><Money v={r.monthly * r.term} muted className="text-tile-ink" /></div>
              <div><div className="text-tile-ink-3">{t("Deposit (2 months)")}</div><Money v={r.monthly * 2} muted className="text-tile-ink" /></div>
              <div><div className="text-tile-ink-3">{t("Supplier cost / month")}</div>{monthlyCost === null ? <span className="text-glow-ember">{t("Missing")}</span> : <Money v={monthlyCost} muted className="text-tile-ink" />}</div>
              <div><div className="text-tile-ink-3">{t("Margin / month")}</div>{monthlyCost === null ? "—" : <Money v={r.monthly - monthlyCost} muted className={r.monthly - monthlyCost > 0 ? "text-glow-mint" : "text-glow-ember"} />}</div>
            </div>
            <div className="mt-5 text-[11.5px] text-tile-ink-3">{t("Mada only. The client never sees costs, suppliers or margin.")}</div>
          </InkCard>

          <Card>
            <CardHead title={t("Next step")} />
            {r.status === "awaiting_approval" && <p className="text-[13.5px] text-ink-3">{t("Waiting for an approver at {name}. Nothing to do yet.", { name: c.name })}</p>}
            {["submitted", "confirmed", "delivering", "active"].includes(r.status) && (
              <ActionForm action={advanceRequest} className="space-y-3">
                <input type="hidden" name="id" value={r.id} />
                {r.status !== "active" && <Textarea name="note" rows={2} placeholder={t("Optional note to the client (or the reason, if you cancel)")} />}
                <div className="flex flex-wrap gap-2">
                  {r.status === "submitted" && <SubmitButton name="op" value="confirm">{t("Confirm order")}</SubmitButton>}
                  {r.status === "confirmed" && <SubmitButton name="op" value="delivering">{t("Mark out for delivery")}</SubmitButton>}
                  {r.status === "delivering" && <SubmitButton name="op" value="delivered">{t("Mark delivered")}</SubmitButton>}
                  {r.status === "active" && <SubmitButton name="op" value="bill" variant="gold">{t("Bill month {n}", { n: r.monthsBilled + 1 })}</SubmitButton>}
                  {r.monthsBilled === 0 && <SubmitButton name="op" value="cancel" variant="ghost" confirm={t("Cancel this request? The client is told why.")}>{t("Cancel request")}</SubmitButton>}
                </div>
              </ActionForm>
            )}
            {["completed", "declined", "cancelled"].includes(r.status) && <p className="text-[13.5px] text-ink-3">{r.decisionNote ?? t("Closed.")}</p>}
          </Card>

          <Card>
            <CardHead title={t("Record")} />
            <KV cols={1} items={[
              [t("Sent"), fmtDate(r.createdAt, t.locale, true)],
              [t("Approved at the client"), row.approvedByName ? `${row.approvedByName} · ${fmtDate(r.approvedAt, t.locale, true)}` : "—"],
              [t("Confirmed by Mada"), r.confirmedAt ? fmtDate(r.confirmedAt, t.locale, true) : "—"],
              [t("Delivered"), r.deliveredAt ? fmtDate(r.deliveredAt, t.locale, true) : "—"],
            ]} />
          </Card>
        </div>
      </div>
    </>
  );
}
