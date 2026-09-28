import Link from "next/link";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Plus, Wallet } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { EXPENSE_CATEGORY, EXPENSE_STATUS, PAID_BY } from "@/lib/labels";
import { businessDate, cycleFor, fmtDate } from "@/lib/dates";
import { sar } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { Badge, Card, CardHead, Empty, LinkButton, PageHeader, Table, Td, Th, Tabs } from "@/components/ui";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const u = await requireUser();
  const t = await getT();
  const L = t.locale;
  const all = can(u, "expenses.view_all");
  const { tab = all ? "all" : "mine" } = await searchParams;
  const s = await getSettings();
  const cyc = cycleFor(businessDate(new Date(), s.closeHour), s.cutoffDay);

  const where = tab === "mine" ? eq(schema.expenses.submittedBy, u.id) : tab === "pending" ? eq(schema.expenses.status, "pending") : tab === "startup" ? eq(schema.expenses.isStartup, true) : undefined;
  const rows = await db.select({ e: schema.expenses, name: schema.users.name, partner: schema.partners.name }).from(schema.expenses)
    .innerJoin(schema.users, eq(schema.users.id, schema.expenses.submittedBy)).leftJoin(schema.partners, eq(schema.partners.id, schema.expenses.partnerId))
    .where(all ? where : and(eq(schema.expenses.submittedBy, u.id), where)).orderBy(desc(schema.expenses.expenseDate), desc(schema.expenses.createdAt)).limit(200);
  const byCat = all ? await db.select({ c: schema.expenses.category, total: sql<number>`sum(${schema.expenses.amount})::bigint`.mapWith(Number) }).from(schema.expenses)
    .where(and(eq(schema.expenses.status, "approved"), eq(schema.expenses.isStartup, false), gte(schema.expenses.expenseDate, cyc.start), lte(schema.expenses.expenseDate, cyc.end))).groupBy(schema.expenses.category) : [];
  const cycleTotal = byCat.reduce((a, b) => a + b.total, 0);
  const pendingN = all ? (await db.select({ n: sql<number>`count(*)::int` }).from(schema.expenses).where(eq(schema.expenses.status, "pending")))[0].n : 0;

  return (
    <>
      <PageHeader eyebrow={t("Money out")} title={t("Expenses")} subtitle={t("Company overheads and costs partners paid personally. Every expense needs proof and a second person to verify it.")}
        actions={can(u, "expenses.create") && <LinkButton href="/expenses/new" variant="primary"><Plus className="size-4" />{t("Add expense")}</LinkButton>} />
      {all && (
        <div className="mb-4 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHead title={t("Overheads this cycle")} hint={`${fmtDate(cyc.start, L)} → ${fmtDate(cyc.end, L)}`} action={<span className="figure text-[30px]" dir="ltr">{sar(cycleTotal, { compact: true })}</span>} />
            <ul className="space-y-3">
              {byCat.sort((a, b) => b.total - a.total).map((c) => (
                <li key={c.c} className="grid grid-cols-[140px_1fr_110px] items-center gap-3 text-[13px]">
                  <span className="text-ink-2">{t(EXPENSE_CATEGORY[c.c])}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-sunken"><span className="block h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${(c.total / Math.max(1, cycleTotal)) * 100}%` }} /></span>
                  <span className="num text-end" dir="ltr">{sar(c.total)}</span>
                </li>
              ))}
              {byCat.length === 0 && <li className="text-[13px] text-ink-3">{t("No approved overheads yet this cycle.")}</li>}
            </ul>
          </Card>
          <Card className="flex flex-col"><div className="text-[13px] text-ink-3">{t("Waiting for verification")}</div><div className="figure mt-auto pt-6 text-[56px]">{pendingN}</div>
            {pendingN > 0 && <Link href="/approvals?tab=mine" className="mt-2 text-[13px] underline decoration-gold decoration-2 underline-offset-4">{t("Review in approvals")}</Link>}</Card>
        </div>
      )}
      <Tabs active={tab} items={[
        ...(all ? [{ key: "all", label: t("All"), href: "/expenses?tab=all" }] : []),
        { key: "mine", label: t("Submitted by me"), href: "/expenses?tab=mine" },
        ...(all ? [{ key: "pending", label: t("Waiting"), count: pendingN, href: "/expenses?tab=pending" }, { key: "startup", label: t("Startup costs"), href: "/expenses?tab=startup" }] : []),
      ]} />
      <Card pad={false}>
        {rows.length === 0 ? <Empty icon={<Wallet className="size-5" />} title={t("No expenses yet")} action={can(u, "expenses.create") && <LinkButton href="/expenses/new" variant="outline">{t("Add expense")}</LinkButton>} /> : (
          <Table>
            <thead><tr><Th>{t("Expense")}</Th><Th>{t("Category")}</Th><Th>{t("Paid by")}</Th><Th>{t("Submitted by")}</Th><Th align="end">{t("Amount")}</Th><Th>{t("Status")}</Th></tr></thead>
            <tbody>
              {rows.map(({ e, name, partner }) => (
                <tr key={e.id} className="group hover:bg-surface-2">
                  <Td><Link href={`/expenses/${e.id}`} className="block"><span className="text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{e.description}</span>
                    <span className="block text-[12px] text-ink-3"><span className="num">{e.ref}</span> · {fmtDate(e.expenseDate, L)}</span></Link></Td>
                  <Td>{t(EXPENSE_CATEGORY[e.category])}{e.isStartup && <Badge tone="info" className="ms-2">{t("Startup")}</Badge>}</Td>
                  <Td>{e.paidBy === "partner" ? `${partner} · ${t("personally")}` : t(PAID_BY[e.paidBy])}</Td>
                  <Td>{name}</Td>
                  <Td align="end"><span className="num text-ink" dir="ltr">{sar(e.amount)}</span></Td>
                  <Td><Badge tone={EXPENSE_STATUS[e.status].tone}>{t(EXPENSE_STATUS[e.status].label)}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
