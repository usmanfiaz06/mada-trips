import { desc, eq, isNull } from "drizzle-orm";
import { Landmark } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { cashPosition } from "@/lib/finance";
import { getSettings } from "@/lib/settings";
import { ACCOUNT, METHOD } from "@/lib/labels";
import { daysBetween, fmtDate, riyadhDate } from "@/lib/dates";
import { amountInput, sar } from "@/lib/money";
import { Badge, Card, CardHead, Field, InkCard, Input, PageHeader, Select, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { SunGauge } from "@/components/charts";
import { ClearTable } from "./clear-table";
import { addBsp, payBsp, updateBank } from "./actions";

export const metadata = { title: "Banks & cash" };

export default async function FinancePage() {
  const u = await requirePerm("finance.view");
  const t = await getT();
  const L = t.locale;
  const today = riyadhDate();
  const [cash, s, uncleared, bsp] = await Promise.all([
    cashPosition(), getSettings(),
    db.select({ p: schema.payments, ref: schema.bookings.ref, client: schema.clients.name }).from(schema.payments)
      .leftJoin(schema.bookings, eq(schema.bookings.id, schema.payments.bookingId)).innerJoin(schema.clients, eq(schema.clients.id, schema.payments.clientId))
      .where(isNull(schema.payments.clearedOn)).orderBy(schema.payments.collectedAt),
    db.select().from(schema.bspObligations).orderBy(desc(schema.bspObligations.dueDate)),
  ]);
  const upcoming = bsp.filter((b) => b.status === "upcoming").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const canRec = can(u, "finance.reconcile");

  return (
    <>
      <PageHeader eyebrow={t("Treasury")} title={t("Banks & cash")} subtitle={t("Two accounts, never mixed. Receipts count toward the Day-25 settlement only once they clear in the bank.")} />
      <div className="grid gap-4 lg:grid-cols-3">
        {cash.accounts.map((a, i) => {
          const Tile = i === 0 ? InkCard : Card;
          return (
            <Tile key={a.key} className="flex flex-col">
              <div className="flex items-center justify-between"><span className={cx("text-[13px]", i === 0 ? "text-tile-ink-3" : "text-ink-3")}>{t(ACCOUNT[a.key])}</span><Landmark className="size-4 opacity-50" /></div>
              <div className="figure mt-8 text-[48px]" dir="ltr">{sar(a.balance, { compact: true })}<span className="figure-unit">SAR</span></div>
              <div className={cx("mt-auto grid grid-cols-2 gap-3 border-t pt-4 text-[12.5px]", i === 0 ? "border-tile-line text-tile-ink-3" : "border-line text-ink-3")}>
                <div>{a.bank ?? "—"}<div className="num mt-0.5 truncate" dir="ltr">{a.iban ?? ""}</div></div>
                <div className="text-end">{t("Not cleared yet")}<div className={cx("num mt-0.5", i === 0 ? "text-tile-ink" : "text-ink")} dir="ltr">{sar(a.uncleared)}</div></div>
              </div>
            </Tile>
          );
        })}
        <Card>
          <CardHead title={t("IATA reserve")} hint={t("Held back for BSP auto-debits")} />
          <SunGauge value={s.iataReserveHeld} max={Math.max(1, cash.upcomingBsp)}>
            <div className="figure text-[34px]" dir="ltr">{sar(s.iataReserveHeld, { compact: true })}</div>
            <div className="text-[12px] text-ink-3">{t("held vs {v} due", { v: sar(cash.upcomingBsp, { compact: true }) })}</div>
          </SunGauge>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Card pad={false}>
          <div className="p-6 pb-4"><CardHead className="mb-0" title={t("Receipts waiting to clear")} hint={t("Tick what appears on the bank statement. Only cleared funds count toward Day 25.")} /></div>
          {canRec ? (
            <ClearTable today={today} rows={uncleared.map(({ p, ref, client }) => ({
              id: p.id, ref, bookingId: p.bookingId, client, method: p.method, account: p.account, amount: p.amount, date: p.businessDate,
              methodLabel: t(METHOD[p.method]), accountLabel: t(ACCOUNT[p.account]), dateLabel: fmtDate(p.businessDate, L),
            }))} />
          ) : <p className="px-6 pb-6 text-[13px] text-ink-3">{t("{n} receipts waiting.", { n: uncleared.length })}</p>}
        </Card>

        <Card id="bsp">
          <CardHead title={t("BSP debits")} hint={t("IATA settles tickets by auto-debit. Keep the reserve above what's coming.")} />
          <ul className="space-y-2">
            {upcoming.map((b) => {
              const d = daysBetween(today, b.dueDate);
              return (
                <li key={b.id} className="rounded-2xl bg-surface-2 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div><div className="text-[14px]">{b.period}</div><div className={cx("text-[12px]", d <= 3 ? "text-warn" : "text-ink-3")}>{d < 0 ? t("{n} days overdue", { n: -d }) : d === 0 ? t("Due today") : t("Due in {n} days", { n: d })} · {fmtDate(b.dueDate, L)}</div></div>
                    <span className="num text-[15px]" dir="ltr">{sar(b.amount)}</span>
                  </div>
                  {canRec && (
                    <ActionForm action={payBsp} className="mt-3 flex gap-2">
                      <input type="hidden" name="id" value={b.id} />
                      <input type="date" name="paidOn" defaultValue={today} className="field h-9 flex-1" />
                      <SubmitButton size="sm" variant="outline">{t("Mark debited")}</SubmitButton>
                    </ActionForm>
                  )}
                </li>
              );
            })}
            {upcoming.length === 0 && <li className="text-[13px] text-ink-3">{t("No upcoming BSP debits recorded.")}</li>}
          </ul>
          {bsp.some((b) => b.status === "paid") && (
            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-2 text-[12px] text-ink-3">{t("Debited")}</div>
              {bsp.filter((b) => b.status === "paid").slice(0, 4).map((b) => (
                <div key={b.id} className="flex justify-between py-1 text-[13px]"><span className="text-ink-2">{b.period}</span><span className="num text-ink-3" dir="ltr">{sar(b.amount)}</span></div>
              ))}
            </div>
          )}
          {canRec && (
            <details className="mt-4 border-t border-line pt-4">
              <summary className="cursor-pointer list-none text-[13.5px] underline decoration-gold decoration-2 underline-offset-4">{t("Add a BSP debit")}</summary>
              <ActionForm action={addBsp} resetOnOk className="mt-3 grid grid-cols-2 gap-3">
                <Field label={t("Period")} className="col-span-2"><Input name="period" placeholder={t("e.g. BSP · 1st half October")} /></Field>
                <Field label={t("Due date")}><Input type="date" name="dueDate" /></Field>
                <Field label={t("Amount (SAR)")}><Input name="amount" inputMode="decimal" dir="ltr" /></Field>
                <Field label={t("Debited from")} className="col-span-2"><Select name="account" defaultValue="corporate" options={[{ value: "corporate", label: t("Alinma") }, { value: "retail", label: t("Al Rajhi") }]} /></Field>
                <div className="col-span-2"><SubmitButton className="w-full">{t("Add")}</SubmitButton></div>
              </ActionForm>
            </details>
          )}
        </Card>
      </div>

      {can(u, "settings.manage") && (
        <Card className="mt-4">
          <CardHead title={t("Account setup")} hint={t("Opening balance is the balance on the day the platform started tracking.")} />
          <div className="grid gap-6 md:grid-cols-2">
            {cash.accounts.map((a) => (
              <ActionForm key={a.key} action={updateBank} className="grid grid-cols-2 gap-3">
                <input type="hidden" name="key" value={a.key} />
                <div className="col-span-2 flex items-center gap-2 text-[14px]">{t(ACCOUNT[a.key])}<Badge>{t("since {d}", { d: fmtDate(a.openingDate, L) })}</Badge></div>
                <Field label={t("Bank")}><Input name="bank" defaultValue={a.bank ?? ""} /></Field>
                <Field label={t("Opening balance")}><Input name="openingBalance" defaultValue={amountInput(a.openingBalance)} dir="ltr" /></Field>
                <Field label="IBAN" className="col-span-2"><Input name="iban" defaultValue={a.iban ?? ""} dir="ltr" /></Field>
                <div className="col-span-2"><SubmitButton variant="outline" size="sm">{t("Save")}</SubmitButton></div>
              </ActionForm>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
