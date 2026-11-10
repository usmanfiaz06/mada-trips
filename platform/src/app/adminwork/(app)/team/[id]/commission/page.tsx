import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { accountOptions } from "@/lib/accounts";
import { cycleFor, businessDate, riyadhDate } from "@/lib/dates";
import { memberCommissionView, commissionHistory } from "@/lib/commission";
import { Card, CardHead } from "@/components/ui";
import { CommissionCalc } from "./commission-calc";

export const metadata = { title: "Commission" };

type SP = { from?: string; to?: string };
const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function CommissionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  // A partner / director works out and pays commission; it's never automatic.
  const me = await requirePerm("finance.view");
  const t = await getT();
  const [m] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  if (!m) notFound();

  const s = await getSettings();
  const cyc = cycleFor(businessDate(new Date(), s.closeHour), s.cutoffDay);
  const from = isDate((await searchParams).from) ? (await searchParams).from! : (m.commissionFrom && m.commissionFrom > cyc.start ? m.commissionFrom : cyc.start);
  const toRaw = (await searchParams).to;
  const to = isDate(toRaw) && toRaw >= from ? toRaw : riyadhDate();

  const [view, history, accounts] = await Promise.all([
    memberCommissionView(db, id, from, to),
    commissionHistory(db, id),
    accountOptions(),
  ]);
  const canPay = can(me, "finance.reconcile");

  return (
    <>
      <Link href={`/adminwork/team/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink print:hidden"><ArrowLeft className="size-4 rtl:rotate-180" />{m.name}</Link>
      {!m.commissionEnabled ? (
        <Card className="print:hidden">
          <CardHead title={t("Commission is off for {name}", { name: m.name })} hint={t("Turn commission on for this person on their profile before you can pay it.")}
            action={<Link href={`/adminwork/team/${id}`} className="text-[13px] underline decoration-gold decoration-2 underline-offset-4">{t("Go to profile")}</Link>} />
        </Card>
      ) : (
        <CommissionCalc
          memberId={id} memberName={m.name} isPartner={!!m.partnerId} byName={me.name}
          defaultRate={m.commissionBps / 100} defaultBasis={m.commissionBasis === "revenue" ? "revenue" : "profit"}
          commissionFrom={m.commissionFrom} from={from} to={to}
          unpaid={view.unpaid} paid={view.paid} unpaidTotals={view.unpaidTotals} paidTotals={view.paidTotals}
          accounts={accounts} canPay={canPay}
          history={history.map((h) => ({ id: h.id, ref: h.ref, periodStart: h.periodStart, periodEnd: h.periodEnd, amount: h.amount, basis: h.basis, rateBps: h.rateBps, status: h.status, account: h.account, paidOn: h.paidOn, byName: h.byName, salesCount: h.salesCount }))}
          basePath={`/adminwork/team/${id}/commission`} />
      )}
    </>
  );
}
