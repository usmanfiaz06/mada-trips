import { Network, Check, Clock, AlertTriangle } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { portalBalances, portalStatement } from "@/lib/portals";
import { accountOptions } from "@/lib/accounts";
import { fmtDate } from "@/lib/dates";
import { sar } from "@/lib/money";
import { Badge, Card, CardHead, Field, InkCard, Input, PageHeader, Select, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { ApprovalToggle } from "@/components/approval-toggle";
import { addPortalAction, depositAction, adjustAction } from "./actions";

export const metadata = { title: "B2B portals" };

const MOVE_LABEL: Record<string, string> = { fund: "Deposit", usage: "Sale", penalty: "Cancellation fee", adjustment: "Adjustment" };

export default async function PortalsPage() {
  const u = await requirePerm("portals.manage");
  const t = await getT();
  const L = t.locale;
  const [portals, accOpts, partners] = await Promise.all([
    portalBalances(),
    accountOptions(),
    db.select({ id: schema.partners.id, name: schema.partners.name }).from(schema.partners).orderBy(schema.partners.sort),
  ]);
  const statements = await Promise.all(portals.map(async (p) => ({ id: p.id, rows: await portalStatement(db, p.id, 40) })));
  const portalOpts = portals.map((p) => ({ value: p.id, label: p.name }));
  const total = portals.reduce((s, p) => s + p.balance, 0);

  return (
    <>
      <PageHeader eyebrow={t("Treasury")} title={t("B2B portals")} subtitle={t("Platforms you buy through (TBO, iTrip). A positive balance is prepaid funds you hold; a negative balance is credit you've used and owe. Deposits and usage are approved by a director.")} />

      {portals.length === 0 ? (
        <Card><div className="flex flex-col items-center gap-2 py-10 text-center"><Network className="size-6 text-ink-3" /><p className="text-[14px] font-medium">{t("No portals yet")}</p><p className="text-[13px] text-ink-3">{t("Add your first B2B portal below.")}</p></div></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {portals.map((p, i) => {
            const Tile = i === 0 ? InkCard : Card;
            const owe = p.balance < 0;
            const overLimit = p.headroom < 0;
            return (
              <Tile key={p.id} className="flex flex-col">
                <div className="flex items-center justify-between">
                  <span className={cx("text-[13px]", i === 0 ? "text-tile-ink-3" : "text-ink-3")}>{p.name}</span>
                  <Network className="size-4 opacity-50" />
                </div>
                <div className="figure mt-6 text-[40px]" dir="ltr">{sar(Math.abs(p.balance), { compact: true })}<span className="figure-unit">SAR</span></div>
                <div className={cx("text-[12px]", owe ? "text-warn" : i === 0 ? "text-tile-ink-3" : "text-ink-3")}>{owe ? t("credit used — owed to {name}", { name: p.name }) : t("prepaid funds on hand")}</div>
                <div className={cx("mt-auto grid grid-cols-2 gap-3 border-t pt-4 text-[12.5px]", i === 0 ? "border-tile-line text-tile-ink-3" : "border-line text-ink-3")}>
                  <div>{t("Credit line")}<div className="num mt-0.5" dir="ltr">{p.creditLimit ? sar(p.creditLimit) : "—"}</div></div>
                  <div className="text-end">{t("Spendable")}<div className={cx("num mt-0.5", overLimit ? "text-bad" : i === 0 ? "text-tile-ink" : "text-ink")} dir="ltr">{sar(p.headroom)}</div></div>
                </div>
                {p.pending > 0 && <p className={cx("mt-2 flex items-center gap-1.5 text-[12px]", i === 0 ? "text-tile-ink-3" : "text-ink-3")}><Clock className="size-3.5" />{t("{v} awaiting approval", { v: sar(p.pending) })}</p>}
                {overLimit && <p className="mt-2 flex items-center gap-1.5 text-[12px] text-bad"><AlertTriangle className="size-3.5" />{t("Over the credit line by {v}", { v: sar(-p.headroom) })}</p>}
              </Tile>
            );
          })}
        </div>
      )}

      {/* Record money movements */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHead title={t("Deposit / repay credit")} hint={t("Money into a portal from a company bank, or fronted by a partner. A director approves it.")} />
          <ActionForm action={depositAction} resetOnOk className="grid gap-3">
            <Select name="portalId" options={portalOpts} placeholder={t("Which portal")} />
            <Select name="source" options={[{ value: "bank", label: t("From a company bank") }, { value: "partner", label: t("A partner fronted it") }]} />
            <Select name="account" options={accOpts} placeholder={t("Bank (if from a bank)")} />
            <Select name="partnerId" options={partners.map((p) => ({ value: p.id, label: p.name }))} placeholder={t("Partner (if fronted)")} />
            <Input name="amount" inputMode="decimal" placeholder={t("Amount (SAR)")} dir="ltr" />
            <Input name="reference" placeholder={t("Reference (optional)")} />
            {u.isDirector && <ApprovalToggle />}
            <SubmitButton size="sm" variant="outline" className="w-full">{t("Record deposit")}</SubmitButton>
          </ActionForm>
        </Card>

        <Card>
          <CardHead title={t("Adjustment")} hint={t("A manual correction to a portal's balance (reconciliation). A director approves it.")} />
          <ActionForm action={adjustAction} resetOnOk className="grid gap-3">
            <Select name="portalId" options={portalOpts} placeholder={t("Which portal")} />
            <Select name="direction" options={[{ value: "in", label: t("Increase (+)") }, { value: "out", label: t("Decrease (−)") }]} />
            <Input name="amount" inputMode="decimal" placeholder={t("Amount (SAR)")} dir="ltr" />
            <Input name="note" placeholder={t("Reason") } />
            {u.isDirector && <ApprovalToggle />}
            <SubmitButton size="sm" variant="outline" className="w-full">{t("Record adjustment")}</SubmitButton>
          </ActionForm>
        </Card>

        <Card>
          <CardHead title={t("Add a portal")} hint={t("Set a credit line if the platform lets you buy on credit; leave it 0 for prepaid-only.")} />
          <ActionForm action={addPortalAction} resetOnOk className="grid gap-3">
            <Field label={t("Name")}><Input name="name" placeholder={t("e.g. TBO")} /></Field>
            <Field label={t("Credit line (SAR)")}><Input name="creditLimit" defaultValue="0" inputMode="decimal" dir="ltr" /></Field>
            <Field label={t("Notes (optional)")}><Input name="notes" /></Field>
            <SubmitButton size="sm" variant="primary" className="w-full">{t("Add portal")}</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      {/* Per-portal statements */}
      {portals.length > 0 && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {portals.map((p) => {
            const rows = statements.find((s) => s.id === p.id)?.rows ?? [];
            return (
              <Card key={p.id} pad={false}>
                <div className="p-6 pb-3"><CardHead className="mb-0" title={p.name} hint={t("Money in and out of this portal")} /></div>
                {rows.length === 0 ? <p className="px-6 pb-6 text-[13px] text-ink-3">{t("No movements yet.")}</p> : (
                  <ul className="max-h-[420px] overflow-y-auto px-3 pb-3">
                    {rows.map((m, i) => (
                      <li key={i} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-surface-2">
                        <span className={cx("grid size-7 shrink-0 place-items-center rounded-full text-[11px]", m.amount >= 0 ? "bg-ok-soft text-ok" : "bg-surface-2 text-ink-3")}>{m.amount >= 0 ? "＋" : "－"}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px]">{MOVE_LABEL[m.kind] ? t(MOVE_LABEL[m.kind]) : m.kind}{m.label ? ` · ${m.label}` : ""}{m.status === "pending_approval" ? ` · ${t("pending")}` : ""}</span>
                          <span className="block text-[11.5px] text-ink-3">{fmtDate(m.date, L)}{m.ref ? ` · ${m.ref}` : ""}{m.by ? ` · ${t("by {name}", { name: m.by })}` : ""}</span>
                        </span>
                        <span className={cx("num shrink-0 text-[13.5px]", m.amount >= 0 ? "text-ok" : "text-ink-2")} dir="ltr">{sar(Math.abs(m.amount))}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-center text-[12px] text-ink-3">{t("Total held across portals")}: <span className="num" dir="ltr">{sar(total)}</span></p>
    </>
  );
}
