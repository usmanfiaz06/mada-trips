import Link from "next/link";
import { Undo2 } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { sar } from "@/lib/money";
import { DeskError } from "@/lib/app/desk/core";
import { refundTarget, startDeskRefund, type DeskRefundResult } from "@/lib/app/finance/refunds";
import { Card, CardHead, Empty, Field, Input, KV, Money, Notice, PageHeader, Textarea, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { startDeskRefundAction } from "../../finance-actions";

export const metadata = { title: "Cancel & refund · Desk" };

/*
 * The desk starts a cancel and refund (DESK-PLAN U6): find the app booking by its reference, pick what to cancel with
 * the supplier (a Hotelbeds stay or transfer, a TBO flight, or nothing), see what the supplier keeps, then confirm.
 * Confirming cancels with the supplier and opens the refund at "To decide", where the usual limits apply.
 */

export default async function NewRefundPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePerm("desk.refund");
  const t = await getT();
  const sp = await searchParams;
  const ref = (sp.order ?? "").trim().slice(0, 40);
  const target = ref ? await refundTarget(ref) : null;
  const cancel = sp.cancel ?? (target?.options.length === 1 ? target.options[0]!.kind : undefined);
  let preview: DeskRefundResult | null = null;
  let problem: string | null = null;
  if (target?.payment && cancel) {
    try { preview = await startDeskRefund(u, { orderRef: ref, cancel, reason: "", confirm: false }); }
    catch (e) { problem = e instanceof DeskError ? e.message : t("The supplier didn't answer. Try again in a minute"); }
  }
  const key = (o: NonNullable<typeof target>["options"][number]) => (o.kind === "hotelbeds" ? `hotelbeds:${o.id}` : o.kind);
  return (
    <>
      <PageHeader eyebrow={t("Refunds & credits")} title={t("Cancel & refund a booking")}
        subtitle={t("Cancel with the supplier first, then the refund waits at To decide like any other. Hotelbeds tells us what it keeps before anything is cancelled.")} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="self-start">
          <form action="/adminwork/desk/refunds/new" className="flex flex-wrap items-end gap-2">
            <Field label={t("Booking reference")} className="min-w-[220px] flex-1"><Input name="order" defaultValue={ref} placeholder="MT-7K2Q4P" dir="ltr" required /></Field>
            <button className="h-[42px] rounded-full bg-ink px-5 text-[13.5px] text-bg">{t("Find")}</button>
          </form>
          {ref && !target && <div className="mt-6"><Empty icon={<Undo2 className="size-5" />} title={t("No paid app booking with that reference")} hint={t("Use the reference on the order, e.g. from the live board.")} /></div>}
          {target && (
            <div className="mt-6 space-y-5">
              <KV items={[
                [t("Booking"), target.order.ref ?? "—"],
                [t("Paid"), target.payment ? <Money key="p" v={target.payment.amount} /> : "—"],
                [t("Left to refund"), <Money key="l" v={target.left} />],
                [t("Paid with"), target.payment?.label ?? target.payment?.method ?? "—"],
              ]} />
              {target.left <= 0 ? <Notice tone="warn">{t("Everything paid on this booking has already been refunded.")}</Notice> : (
                <div>
                  <div className="mb-2 text-[12px] text-ink-3">{t("What to cancel")}</div>
                  <div className="flex flex-wrap gap-2">
                    {target.options.map((o) => (
                      <Link key={key(o)} href={`/adminwork/desk/refunds/new?order=${encodeURIComponent(ref)}&cancel=${encodeURIComponent(key(o))}`}
                        className={cx("rounded-full border px-4 py-2 text-[13px] transition", cancel === key(o) ? "border-ink bg-ink text-bg" : "border-line text-ink-2 hover:border-ink-3")}>{o.label}</Link>
                    ))}
                  </div>
                </div>
              )}
              {problem && <Notice tone="bad">{problem}</Notice>}
            </div>
          )}
        </Card>

        <aside className="space-y-4">
          {preview?.preview && target && cancel && (
            <Card className="ring-2 ring-gold/40">
              <CardHead title={t("Refund to open")} hint={preview.note} />
              {preview.supplierFee && preview.supplierFee.amount > 0 && <p className="mb-3 text-[12.5px] text-ink-3">{t("Supplier fee {fee}, the traveller's share {share}", { fee: `${preview.supplierFee.amount} ${preview.supplierFee.currency ?? ""}`.trim(), share: `SAR ${sar(preview.fee)}` })}</p>}
              <ActionForm action={startDeskRefundAction} className="space-y-3">
                <input type="hidden" name="order" value={ref} />
                <input type="hidden" name="cancel" value={cancel} />
                <Field label={t("Amount to refund (SAR)")}><Input name="amount" inputMode="decimal" defaultValue={(preview.refund / 100).toFixed(2)} dir="ltr" className="num" required /></Field>
                <Field label={t("Reason")}><Textarea name="reason" rows={2} required minLength={5} maxLength={300} placeholder={t("Why, in words the traveller will read")} /></Field>
                <SubmitButton variant="gold" className="w-full" confirm={cancel === "none" ? undefined : t("This cancels the booking with the supplier. It can't be undone.")}>{cancel === "none" ? t("Open the refund") : t("Cancel and open the refund")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
