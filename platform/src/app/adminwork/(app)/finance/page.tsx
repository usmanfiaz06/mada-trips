import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Check, Clock, Landmark } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { bankMovements, cashPosition } from "@/lib/finance";
import { bspClosings } from "@/lib/bsp";
import { getSettings } from "@/lib/settings";
import { ACCOUNT, ACCOUNTS, METHOD } from "@/lib/labels";
import { daysBetween, fmtDate, riyadhDate } from "@/lib/dates";
import { amountInput, sar } from "@/lib/money";
import { Badge, Card, CardHead, Field, InkCard, Input, PageHeader, Select, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { SunGauge } from "@/components/charts";
import { ClearTable } from "./clear-table";
import { addBankTxn, settleBsp, transferFunds, updateBank } from "./actions";

const MOVE_LABEL: Record<string, string> = { receipt: "Client payment", supplier: "Supplier paid", bsp: "BSP debit", expense: "Expense", deposit: "Deposit", withdrawal: "Withdrawal", transfer: "Transfer" };
export const metadata = { title: "Banks & cash" };

export default async function FinancePage() {
  const u = await requirePerm("finance.view");
  const t = await getT();
  const L = t.locale;
  const today = riyadhDate();
  const [cash, s, uncleared] = await Promise.all([
    cashPosition(), getSettings(),
    db.select({ p: schema.payments, ref: schema.bookings.ref, client: schema.clients.name }).from(schema.payments)
      .leftJoin(schema.bookings, eq(schema.bookings.id, schema.payments.bookingId)).innerJoin(schema.clients, eq(schema.clients.id, schema.payments.clientId))
      // A voided or refunded sale's receipt can't be cleared — it's off the books.
      .where(and(isNull(schema.payments.clearedOn), sql`(${schema.payments.bookingId} IS NULL OR ${schema.bookings.status} NOT IN ('void','refunded'))`)).orderBy(schema.payments.collectedAt),
  ]);
  const movements = await Promise.all(cash.accounts.map(async (a) => ({ key: a.key, rows: await bankMovements(db, a.key, 12) })));
  const canRec = can(u, "finance.reconcile");
  const bspRows = await bspClosings(db, s, 6);
  const partnerList = canRec ? await db.select({ id: schema.partners.id, name: schema.partners.name }).from(schema.partners).orderBy(schema.partners.sort) : [];

  return (
    <>
      <PageHeader eyebrow={t("Treasury")} title={t("Banks & cash")} subtitle={t("The two accounts stay separate. Receipts count toward the Day-25 settlement only after they clear in the bank.")} />
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
          <CardHead title={t("IATA BSP closings")} hint={t("Every 15 days, flights ticketed through BSP are billed by IATA. Pay within {n} days ({g} grace).", { n: s.bspPaymentDays, g: s.bspGraceDays })} />
          <ul className="space-y-2.5">
            {bspRows.map((c) => {
              const d = daysBetween(today, c.dueDate);
              const settled = c.settlements.find((x) => x.status === "paid");
              const pending = c.settlements.find((x) => x.status === "pending_approval");
              return (
                <li key={c.end} className={cx("rounded-2xl p-3.5 ring-1", c.overdue ? "bg-bad-soft ring-bad/30" : c.inGrace ? "bg-warn-soft ring-warn/30" : "bg-surface-2 ring-transparent")}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[14px]">{fmtDate(c.start, L)} → {fmtDate(c.end, L)}</div>
                      <div className={cx("text-[12px]", c.overdue ? "text-bad" : c.inGrace ? "text-warn" : d <= 3 ? "text-warn" : "text-ink-3")}>
                        {c.unsettled > 0 ? (c.overdue ? t("Overdue since {d}", { d: fmtDate(c.graceUntil, L) }) : c.inGrace ? t("Grace until {d}", { d: fmtDate(c.graceUntil, L) }) : d < 0 ? t("{n} days overdue", { n: -d }) : d === 0 ? t("Due today") : t("Due in {n} days", { n: d })) + ` · ${t("{n} tickets", { n: c.count })}` : t("Settled")}
                      </div>
                    </div>
                    <span className="num text-[15px]" dir="ltr">{sar(c.unsettled > 0 ? c.unsettled : settled?.amount ?? pending?.amount ?? 0)}</span>
                  </div>
                  {settled ? (
                    <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ok"><Check className="size-3.5" />{settled.source === "partner" ? t("Paid by {name}", { name: settled.partner ?? "—" }) : t("Paid from {bank}", { bank: settled.account ? t(ACCOUNT[settled.account]) : t("a company bank") })}</p>
                  ) : pending ? (
                    <p className="mt-2 flex items-center gap-1.5 text-[12px] text-warn"><Clock className="size-3.5" />{t("{name} paid it — waiting for the other directors to approve", { name: pending.partner ?? "—" })}</p>
                  ) : canRec && c.unsettled > 0 ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <ActionForm action={settleBsp} className="flex flex-col gap-2 rounded-xl bg-surface p-2.5 ring-1 ring-line">
                        <input type="hidden" name="start" value={c.start} /><input type="hidden" name="end" value={c.end} /><input type="hidden" name="source" value="bank" />
                        <select name="account" className="field h-9" defaultValue="corporate">{ACCOUNTS.map((a) => <option key={a.value} value={a.value}>{t(a.label)}</option>)}</select>
                        <SubmitButton size="sm" variant="outline">{t("Pay IATA")}</SubmitButton>
                      </ActionForm>
                      {u.partnerId && (
                        <ActionForm action={settleBsp} className="flex flex-col gap-2 rounded-xl bg-surface p-2.5 ring-1 ring-line">
                          <input type="hidden" name="start" value={c.start} /><input type="hidden" name="end" value={c.end} /><input type="hidden" name="source" value="partner" />
                          <select name="partnerId" className="field h-9" defaultValue={u.partnerId}>{partnerList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                          <SubmitButton size="sm" variant="outline">{t("A partner paid")}</SubmitButton>
                        </ActionForm>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
            {bspRows.length === 0 && <li className="text-[13px] text-ink-3">{t("No BSP tickets yet this period.")}</li>}
          </ul>
        </Card>
      </div>

      {canRec && (
        <Card className="mt-4">
          <CardHead title={t("Move money")} hint={t("Deposits, withdrawals and transfers that aren't a sale or expense. A director approves each one.")} />
          <div className="grid gap-4 md:grid-cols-3">
            <ActionForm action={addBankTxn} resetOnOk className="space-y-2 rounded-2xl bg-surface-2 p-3.5">
              <div className="text-[13px] font-[450]">{t("Deposit")}</div>
              <input type="hidden" name="kind" value="deposit" />
              <Select name="account" options={ACCOUNTS.map((a) => ({ value: a.value, label: t(a.label) }))} />
              <Input name="amount" inputMode="decimal" placeholder={t("Amount (SAR)")} dir="ltr" />
              <Input name="note" placeholder={t("Note (optional)")} />
              <Input type="date" name="date" defaultValue={today} />
              <Select name="partnerId" defaultValue={u.partnerId ?? ""} placeholder={t("Who made it? (optional)")} options={partnerList.map((p) => ({ value: p.id, label: p.name }))} />
              <SubmitButton size="sm" variant="outline" className="w-full">{t("Record deposit")}</SubmitButton>
            </ActionForm>
            <ActionForm action={addBankTxn} resetOnOk className="space-y-2 rounded-2xl bg-surface-2 p-3.5">
              <div className="text-[13px] font-[450]">{t("Withdrawal")}</div>
              <input type="hidden" name="kind" value="withdrawal" />
              <Select name="account" options={ACCOUNTS.map((a) => ({ value: a.value, label: t(a.label) }))} />
              <Input name="amount" inputMode="decimal" placeholder={t("Amount (SAR)")} dir="ltr" />
              <Input name="note" placeholder={t("Note (optional)")} />
              <Input type="date" name="date" defaultValue={today} />
              <Select name="partnerId" defaultValue={u.partnerId ?? ""} placeholder={t("Who made it? (optional)")} options={partnerList.map((p) => ({ value: p.id, label: p.name }))} />
              <SubmitButton size="sm" variant="outline" className="w-full">{t("Record withdrawal")}</SubmitButton>
            </ActionForm>
            <ActionForm action={transferFunds} resetOnOk className="space-y-2 rounded-2xl bg-surface-2 p-3.5">
              <div className="text-[13px] font-[450]">{t("Transfer between banks")}</div>
              <div className="grid grid-cols-2 gap-2">
                <Select name="from" options={ACCOUNTS.map((a) => ({ value: a.value, label: t(a.label) }))} />
                <Select name="to" defaultValue="corporate" options={ACCOUNTS.map((a) => ({ value: a.value, label: t(a.label) }))} />
              </div>
              <Input name="amount" inputMode="decimal" placeholder={t("Amount (SAR)")} dir="ltr" />
              <Input name="note" placeholder={t("Note (optional)")} />
              <Input type="date" name="date" defaultValue={today} />
              <Select name="partnerId" defaultValue={u.partnerId ?? ""} placeholder={t("Who made it? (optional)")} options={partnerList.map((p) => ({ value: p.id, label: p.name }))} />
              <SubmitButton size="sm" variant="outline" className="w-full">{t("Record transfer")}</SubmitButton>
            </ActionForm>
          </div>
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {movements.map(({ key, rows }) => (
          <Card key={key} pad={false}>
            <div className="p-6 pb-3"><CardHead className="mb-0" title={t(ACCOUNT[key])} hint={t("Recent money in and out")} /></div>
            {rows.length === 0 ? <p className="px-6 pb-6 text-[13px] text-ink-3">{t("No movements yet.")}</p> : (
              <ul className="px-3 pb-3">
                {rows.map((m, i) => (
                  <li key={i} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-surface-2">
                    <span className={cx("grid size-7 shrink-0 place-items-center rounded-full text-[11px]", m.amount >= 0 ? "bg-ok-soft text-ok" : "bg-surface-2 text-ink-3")}>
                      {m.amount >= 0 ? "＋" : "－"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px]">{MOVE_LABEL[m.kind] ? t(MOVE_LABEL[m.kind]) : m.kind}{m.label ? ` · ${m.label}` : ""}</span>
                      <span className="block text-[11.5px] text-ink-3">{fmtDate(m.date, L)}{m.ref ? ` · ${m.ref}` : ""}{m.by ? ` · ${t("by {name}", { name: m.by })}` : ""}{m.kind === "receipt" && !m.cleared ? ` · ${t("not cleared")}` : ""}</span>
                    </span>
                    <span className={cx("num shrink-0 text-[13.5px]", m.amount >= 0 ? "text-ok" : "text-ink-2")} dir="ltr">{sar(Math.abs(m.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
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
