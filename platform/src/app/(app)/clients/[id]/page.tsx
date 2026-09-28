import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ArrowLeft, Plus } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { clientExposure } from "@/lib/finance";
import { querySales } from "@/lib/sales-query";
import { BOOKING_STATUS, CLIENT_TYPE } from "@/lib/labels";
import { fmtDate } from "@/lib/dates";
import { amountInput, sar } from "@/lib/money";
import { Badge, Card, CardHead, InkCard, KV, LinkButton, Table, Td, Th, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { ArcGauge } from "@/components/charts";
import { ClientFields } from "@/components/client-fields";
import { Timeline } from "@/components/record";
import { requestCreditLimit, updateClient } from "../actions";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const u = await requireUser();
  const t = await getT();
  const L = t.locale;
  const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, id));
  if (!c) notFound();
  const [exposure, sales, pendingLimit] = await Promise.all([
    clientExposure(db, id), querySales(u, { clientId: id, limit: 25 }),
    db.select().from(schema.approvalRequests).where(and(eq(schema.approvalRequests.entityId, id), eq(schema.approvalRequests.status, "pending"))).orderBy(desc(schema.approvalRequests.createdAt)),
  ]);
  const ct = CLIENT_TYPE[c.type];
  const left = c.creditLimit - exposure;

  return (
    <>
      <Link href="/clients" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Clients & credit")}</Link>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div><Badge tone={ct.tone}>{t(ct.label)}</Badge><h1 className="mt-2 text-[34px] font-[380] leading-none tracking-[-0.035em]">{c.name}</h1>
          <p className="mt-2 text-[14px] text-ink-3">{[c.contactPerson, c.phone, c.email].filter(Boolean).join(" · ")}</p></div>
        {can(u, "sales.create") && <LinkButton href={`/sales/new?client=${c.id}`} variant="primary"><Plus className="size-4" />{t("New sale")}</LinkButton>}
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card pad={false}>
            <div className="p-6 pb-3"><CardHead className="mb-0" title={t("Recent sales")} hint={t("{n} in total", { n: sales.total })} /></div>
            <Table>
              <thead><tr><Th>{t("Sale")}</Th><Th>{t("Passenger")}</Th><Th align="end">{t("Sell")}</Th><Th align="end">{t("Owed")}</Th><Th>{t("Status")}</Th></tr></thead>
              <tbody>
                {sales.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-2">
                    <Td><Link href={`/sales/${r.id}`} className="num font-medium text-ink hover:underline">{r.ref}</Link><span className="block text-[12px] text-ink-3">{fmtDate(r.business_date, L)}</span></Td>
                    <Td>{r.passengers}<span className="block text-[12px] text-ink-3">{r.description}</span></Td>
                    <Td align="end"><span className="num" dir="ltr">{sar(r.sell_price)}</span></Td>
                    <Td align="end"><span className={cx("num", r.sell_price - r.paid > 0 && r.status !== "void" ? "text-ink" : "text-ink-4")} dir="ltr">{r.status === "void" ? "—" : sar(Math.max(0, r.sell_price - r.paid))}</span></Td>
                    <Td><Badge tone={BOOKING_STATUS[r.status].tone}>{t(BOOKING_STATUS[r.status].label)}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          {can(u, "clients.manage") ? (
            <Card><CardHead title={t("Details")} />
              <ActionForm action={updateClient}><input type="hidden" name="id" value={c.id} /><ClientFields c={c} />
                <div className="mt-6 flex justify-end"><SubmitButton>{t("Save changes")}</SubmitButton></div></ActionForm></Card>
          ) : (
            <Card><CardHead title={t("Details")} /><KV items={[[t("Contract"), c.contractRef], [t("Terms"), c.paymentTermsDays ? t("{n} days", { n: c.paymentTermsDays }) : "—"], [t("Notes"), c.notes]]} /></Card>
          )}
          <Timeline entityType="client" entityId={c.id} path={`/clients/${c.id}`} refLabel={c.name} />
        </div>
        <aside className="space-y-4">
          <InkCard>
            <div className="text-[12.5px] text-tile-ink-3">{c.type === "contracted" ? t("Credit used") : t("Owed now")}</div>
            {c.type === "contracted" ? (
              <div className="mt-4">
                <ArcGauge value={exposure} max={Math.max(1, c.creditLimit)} ink tone={exposure > c.creditLimit * 0.85 ? "gold" : "green"}>
                  <div className="figure text-[44px]" dir="ltr">{sar(exposure, { compact: true })}</div>
                  <div className="text-[12px] text-tile-ink-3">{t("of {v} limit", { v: sar(c.creditLimit, { compact: true }) })}</div>
                </ArcGauge>
                <div className="mt-5 flex justify-between border-t border-tile-line pt-4 text-[13px]"><span className="text-tile-ink-3">{t("Available")}</span><span className={cx("num", left < 0 && "text-glow-ember")} dir="ltr">{sar(left)}</span></div>
              </div>
            ) : (<div className="figure mt-4 text-[52px]" dir="ltr">{sar(exposure, { compact: true })}</div>)}
          </InkCard>
          {c.type === "contracted" && can(u, "clients.manage") && (
            <Card>
              <CardHead title={t("Change credit limit")} hint={t("Raising goes to directors under the approval rules. Lowering applies at once.")} />
              {pendingLimit.filter((p) => p.kind === "credit_limit").map((p) => (
                <Link key={p.id} href={`/approvals/${p.id}`} className="mb-3 block rounded-2xl bg-gold-soft px-3.5 py-2.5 text-[13px] text-gold-2">{t("Waiting for approval")} · {p.ref}</Link>
              ))}
              <ActionForm action={requestCreditLimit} className="space-y-2">
                <input type="hidden" name="id" value={c.id} />
                <input name="amount" defaultValue={amountInput(c.creditLimit)} inputMode="decimal" className="field num" dir="ltr" />
                <input name="reason" className="field" placeholder={t("Reason (for directors)")} />
                <SubmitButton variant="outline" className="w-full">{t("Submit")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Card><KV cols={1} items={[[t("Client since"), fmtDate(c.createdAt, L)], [t("Payment terms"), c.paymentTermsDays ? t("{n} days", { n: c.paymentTermsDays }) : t("Pays at sale")], [t("Contract"), c.contractRef]]} /></Card>
        </aside>
      </div>
    </>
  );
}
