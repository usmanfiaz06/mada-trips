import { BadgeCheck, BedDouble } from "lucide-react";
import { Badge, Card, CardHead, Field, Input, Money } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import type { T } from "@/lib/i18n";
import { BOARD_LABEL, HAND_SUPPLIER_LABEL, handStayCostsOf } from "@/lib/app/desk/hotel-quote-math";
import { stayQuoteOf, type StayQuoteOption } from "@mada/shared";

/*
 * Hotel quotes on the desk (desk/hotel-quotes.ts): the hotels sent, as the traveller reads them, with what each cost
 * and the margin for those who may see what Mada pays; and, once paid, "Confirm on the portal".
 */

const nights = (t: T, n: number) => t(n === 1 ? "1 night" : "{n} nights", { n });
const cancelLine = (t: T, o: StayQuoteOption) => (o.freeCancelUntil ? t("Free cancellation until {when} hotel time", { when: o.freeCancelUntil.replace("T", " ") }) : t("Non-refundable"));

/** The hotels sent: hotel, dates, room and board, the price, and (finance) the supplier, net and margin. */
export function HandQuoteSummary({ snapshot, finance, t }: { snapshot: unknown; finance: boolean; t: T }) {
  const options = stayQuoteOf(snapshot) ?? [];
  const costs = handStayCostsOf(snapshot);
  return (
    <ul className="divide-y divide-line" data-testid="hand-quote-summary">
      {options.map((o) => {
        const c = costs.find((x) => x.id === o.id);
        return (
          <li key={o.id} className="space-y-1 py-2.5 text-[13px]">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0"><bdi className="font-medium text-ink">{o.hotel}</bdi> <span className="text-ink-3">· <bdi>{o.city}</bdi></span></span>
              <Money v={o.total} />
            </div>
            <div className="text-ink-2"><span className="num" dir="ltr">{o.checkIn} → {o.checkOut}</span> · {nights(t, o.nights)} · <bdi>{o.room}</bdi> · {t(BOARD_LABEL[o.board])} · {t(o.guests === 1 ? "1 guest" : "{n} guests", { n: o.guests })}</div>
            <div className="text-[12px] text-ink-3">{cancelLine(t, o)}</div>
            {finance && c && (
              <div className="text-[12px] text-ink-3" data-testid="hand-quote-cost">
                {t(HAND_SUPPLIER_LABEL[c.supplier])}{c.supplierRef ? <> · <span className="num" dir="ltr">{c.supplierRef}</span></> : null} · {t("Net")} <span className="num" dir="ltr">{c.netAmount} {c.currency}</span> · {t("Margin")} <Money v={c.marginHalalas} />
                {c.overrideReason ? <> · <Badge tone="warn">{t("Price set by hand")}</Badge> <bdi>{c.overrideReason}</bdi></> : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

type Action = (prev: { error?: string; ok?: string } | null, fd: FormData) => Promise<{ error?: string; ok?: string } | null>;

/** Paid: book it on the portal by hand, then enter the hotel's confirmation here. The stay goes on the trip. */
export function HandStayConfirmCard({ requestId, stay, total, canIssue, action, t }: { requestId: string; stay: StayQuoteOption; total: number; canIssue: boolean; action: Action; t: T }) {
  return (
    <Card className="ring-2 ring-gold/40" data-testid="hand-stay-confirm">
      <CardHead title={t("Paid · confirm on the portal")} hint={t("Book this room on the portal or with the hotel, then enter the hotel's confirmation. The traveller sees it on their trip.")} action={<BedDouble className="size-4 text-ink-3" />} />
      <div className="mb-3 rounded-2xl bg-surface-2 px-3.5 py-2.5 text-[13px]">
        <div className="flex justify-between gap-3"><bdi className="font-medium text-ink">{stay.hotel}</bdi><Money v={total} /></div>
        <div className="text-ink-2"><span className="num" dir="ltr">{stay.checkIn} → {stay.checkOut}</span> · {nights(t, stay.nights)} · <bdi>{stay.room}</bdi> · {t(BOARD_LABEL[stay.board])}</div>
        <div className="text-[12px] text-ink-3">{cancelLine(t, stay)}</div>
      </div>
      {canIssue ? (
        <ActionForm action={action} className="space-y-2">
          <input type="hidden" name="id" value={requestId} />
          <Field label={t("Hotel confirmation number")} required><Input name="hotelRef" required maxLength={40} className="num" dir="ltr" placeholder="HTL-48213" /></Field>
          <Field label={t("Supplier booking reference (internal, optional)")}><Input name="supplierRef" maxLength={60} className="num" dir="ltr" placeholder="1-2345678" /></Field>
          <SubmitButton variant="gold" className="w-full" confirm={t("Booked on the portal? This captures the card and puts the stay on the trip.")}><BadgeCheck className="size-4" />{t("Save and mark booked")}</SubmitButton>
        </ActionForm>
      ) : <p className="text-[12.5px] text-ink-3">{t("Confirming needs the desk issuing right. Hand it to someone who has it.")}</p>}
    </Card>
  );
}
