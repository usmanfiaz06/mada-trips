import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireUser, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { partnerBalances } from "@/lib/finance";
import { LEDGER_TYPE } from "@/lib/labels";
import { fmtDate, riyadhDate } from "@/lib/dates";
import { pct, sar } from "@/lib/money";
import { Avatar, Badge, Card, CardHead, Field, InkCard, Input, PageHeader, Select, Table, Td, Th, Tabs, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { recordAdvance } from "./actions";

export const metadata = { title: "Partners" };

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const u = await requireUser();
  const all = can(u, "ledger.view_all");
  if (!all && !u.partnerId) redirect("/adminwork?denied=1");
  const t = await getT();
  const L = t.locale;
  const balances = (await partnerBalances()).filter((b) => all || b.id === u.partnerId);
  const sp = await searchParams;
  const selected = sp.p && balances.some((b) => b.id === sp.p) ? sp.p : all ? "all" : u.partnerId!;
  const entries = await db.select({ e: schema.ledgerEntries, partner: schema.partners.name, by: schema.users.name }).from(schema.ledgerEntries)
    .innerJoin(schema.partners, eq(schema.partners.id, schema.ledgerEntries.partnerId)).innerJoin(schema.users, eq(schema.users.id, schema.ledgerEntries.createdBy))
    .where(selected === "all" ? undefined : eq(schema.ledgerEntries.partnerId, selected)).orderBy(desc(schema.ledgerEntries.entryDate), desc(schema.ledgerEntries.createdAt)).limit(200);
  const totalOwed = balances.reduce((s, b) => s + b.outstanding, 0);

  return (
    <>
      <PageHeader eyebrow={t("Partner Equity Ledger")} title={t("Partners")} subtitle={t("What each partner has put in, what the company owes back, and what has been paid out. Repayments and dividends both follow equity.")} />
      <div className="grid gap-4 lg:grid-cols-4">
        {all && (
          <InkCard className="flex flex-col">
            <div className="text-[13px] text-tile-ink-3">{t("Company owes partners")}</div>
            <div className="figure mt-auto pt-8 text-[48px]" dir="ltr">{sar(totalOwed, { compact: true })}<span className="figure-unit">SAR</span></div>
            <div className="mt-4 flex h-2 gap-[2px] overflow-hidden rounded-full">
              {balances.map((b, i) => <span key={b.id} style={{ width: `${(b.outstanding / Math.max(1, totalOwed)) * 100}%`, background: ["var(--glow-mint)", "var(--glow-green)", "var(--glow-gold)"][i % 3] }} />)}
            </div>
          </InkCard>
        )}
        {balances.map((b) => {
          const repaidPct = b.lent ? (b.repaid / b.lent) * 100 : 0;
          return (
            <Card key={b.id} className="flex flex-col">
              <div className="flex items-center gap-3"><Avatar name={b.name} size={40} /><div><div className="text-[16px]">{L === "ar" ? b.nameAr : b.name}</div><div className="text-[12px] text-ink-3">{L === "ar" ? b.titleAr : b.title}</div></div></div>
              <div className="mt-6 flex items-end justify-between">
                <div><div className="text-[12px] text-ink-3">{t("Owed back")}</div><div className="figure mt-2 text-[34px]" dir="ltr">{sar(b.outstanding, { compact: true })}</div></div>
                <Badge tone="gold">{pct(b.equityBps)}</Badge>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-ok" style={{ width: `${repaidPct}%` }} /></div>
              <div className="mt-2 flex justify-between text-[12px] text-ink-3"><span>{t("Repaid {p}% of {v}", { p: repaidPct.toFixed(0), v: sar(b.lent, { compact: true }) })}</span></div>
              <div className="mt-auto flex justify-between border-t border-line pt-3 mt-4 text-[13px]"><span className="text-ink-3">{t("Dividends received")}</span><span className="num" dir="ltr">{sar(b.dividends)}</span></div>
            </Card>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          {all && <Tabs active={selected} items={[{ key: "all", label: t("All partners"), href: "/adminwork/partners" }, ...balances.map((b) => ({ key: b.id, label: L === "ar" ? b.nameAr : b.name, href: `/adminwork/partners?p=${b.id}` }))]} />}
          <Card pad={false}>
            <Table>
              <thead><tr><Th>{t("Date")}</Th><Th>{t("Partner")}</Th><Th>{t("Entry")}</Th><Th>{t("Type")}</Th><Th align="end">{t("Owed back")}</Th><Th align="end">{t("Paid out")}</Th></tr></thead>
              <tbody>
                {entries.map(({ e, partner, by }) => {
                  const plus = e.type === "advance" || e.type === "expense";
                  return (
                    <tr key={e.id}>
                      <Td>{fmtDate(e.entryDate, L)}</Td><Td>{partner}</Td>
                      <Td><span className="block text-ink">{e.description}</span><span className="block text-[12px] text-ink-3">{t("by {name}", { name: by })}</span></Td>
                      <Td><Badge tone={plus ? "info" : e.type === "repayment" ? "ok" : "gold"}>{t(LEDGER_TYPE[e.type])}</Badge></Td>
                      <Td align="end"><span className={cx("num", plus ? "text-ink" : e.type === "repayment" ? "text-ok" : "text-ink-4")} dir="ltr">{plus ? sar(e.amount, { sign: true }) : e.type === "repayment" ? sar(-e.amount) : "—"}</span></Td>
                      <Td align="end"><span className="num" dir="ltr">{plus ? "—" : sar(e.amount)}</span></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </div>
        {can(u, "ledger.manage") && (
          <Card className="self-start">
            <CardHead title={t("Record a capital advance")} hint={t("Cash a partner injected directly, e.g. IATA working capital. Personal expenses go through Expenses instead.")} />
            <ActionForm action={recordAdvance} resetOnOk className="space-y-3">
              <Field label={t("Partner")}><Select name="partnerId" options={balances.map((b) => ({ value: b.id, label: b.name }))} /></Field>
              <Field label={t("Amount (SAR)")}><Input name="amount" inputMode="decimal" dir="ltr" /></Field>
              <Field label={t("Date")}><Input name="entryDate" type="date" defaultValue={riyadhDate()} /></Field>
              <Field label={t("Description")}><Input name="description" placeholder={t("e.g. IATA working capital injection")} /></Field>
              <SubmitButton className="w-full">{t("Record advance")}</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
