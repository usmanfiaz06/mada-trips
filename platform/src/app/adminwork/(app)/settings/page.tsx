import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { amountInput } from "@/lib/money";
import { Card, CardHead, Field, Input, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { saveEquity, saveSettings } from "./actions";

export const metadata = { title: "Rules & limits" };

export default async function SettingsPage() {
  await requirePerm("settings.manage");
  const t = await getT();
  const s = await getSettings();
  const partners = await db.select().from(schema.partners).orderBy(schema.partners.sort);
  const Group = ({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) => (
    <Card><CardHead title={title} hint={hint} /><div className="grid gap-4 sm:grid-cols-2">{children}</div></Card>
  );
  return (
    <>
      <PageHeader eyebrow={t("Governance")} title={t("Rules & limits")} subtitle={t("The numbers from the partnership agreement. Change them here as the business grows; every change is logged and applies from then on.")} />
      <ActionForm action={saveSettings} className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Group title={t("Approvals")} hint={t("Who must agree before money goes out on credit")}>
            <Field label={t("Credit any 2 directors can approve up to (SAR)")} hint={t("Above this, all directors must agree.")}><Input name="creditDualLimit" defaultValue={amountInput(s.creditDualLimit)} dir="ltr" /></Field>
            <Field label={t("Expenses one verifier can approve up to (SAR)")} hint={t("Above this, two verifiers.")}><Input name="expenseDualLimit" defaultValue={amountInput(s.expenseDualLimit)} dir="ltr" /></Field>
            <Field label={t("Bank move one director can approve up to (SAR)")} hint={t("Deposits, withdrawals and transfers. Above this, all directors must agree.")}><Input name="cashMoveLimit" defaultValue={amountInput(s.cashMoveLimit)} dir="ltr" /></Field>
            <Field label={t("Directors needed for a refund")}><Input name="refundApprovals" type="number" min={1} max={3} defaultValue={s.refundApprovals} /></Field>
          </Group>
          <Group title={t("Day-25 waterfall")} hint={t("Defaults used when preparing each settlement")}>
            <Field label={t("Settlement cut-off day")}><Input name="cutoffDay" type="number" min={1} max={28} defaultValue={s.cutoffDay} /></Field>
            <Field label={t("Share of surplus for partner repayments (%)")}><Input name="repaymentPctBps" type="number" min={0} max={100} step="0.01" defaultValue={s.repaymentPctBps / 100} /></Field>
            <Field label={t("IATA safety buffer (SAR)")} hint={t("Kept on top of upcoming BSP debits.")}><Input name="iataBuffer" defaultValue={amountInput(s.iataBuffer)} dir="ltr" /></Field>
            <Field label={t("IATA reserve currently held (SAR)")} hint={t("Updated automatically by each settlement.")}><Input name="iataReserveHeld" defaultValue={amountInput(s.iataReserveHeld)} dir="ltr" /></Field>
          </Group>
          <Group title={t("Daily operations")} hint={t("Close time and margin guidance")}>
            <Field label={t("Daily close hour (Riyadh, 24h)")}><Input name="closeHour" type="number" min={12} max={23} defaultValue={s.closeHour} /></Field>
            <Field label={t("Target margin (%)")} hint={t("Below this, the POS shows amber.")}><Input name="targetMarginBps" type="number" min={0} max={100} step="0.1" defaultValue={s.targetMarginBps / 100} /></Field>
          </Group>
        </div>
        <div className="flex justify-end"><SubmitButton variant="gold" size="lg">{t("Save rules")}</SubmitButton></div>
      </ActionForm>
      <Card className="mt-4">
        <CardHead title={t("Equity")} hint={t("Drives both dividends and repayments. Must total 100%.")} />
        <ActionForm action={saveEquity} className="grid items-end gap-4 sm:grid-cols-4">
          {partners.map((p) => <Field key={p.id} label={p.name}><Input name={`eq_${p.id}`} type="number" step="0.01" min={0} max={100} defaultValue={p.equityBps / 100} /></Field>)}
          <SubmitButton variant="outline">{t("Save equity")}</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
