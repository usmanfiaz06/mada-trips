import { BedDouble, Car, FileText } from "lucide-react";
import { Badge, Card, CardHead, KV } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import type { T } from "@/lib/i18n";
import { orderForRequest, stayRateOf, supplierBookingsFor, type SupplierBookingRow, type TransferDetails } from "@/lib/app/suppliers/hotelbeds/bookings";
import { hotelbedsBookingAllowed, hotelbedsMode, staysMode } from "@/lib/app/suppliers/hotelbeds/app";
import { hotelbedsEnv } from "@/lib/app/suppliers/hotelbeds/client";
import { hbBookStayAction, hbBookTransferAction, hbCancelAction } from "@/app/adminwork/(app)/desk/hotelbeds-actions";

/*
 * On a desk order or request that carries a Hotelbeds rate: book it in one click, see the supplier reference, open the
 * voucher, cancel (Hotelbeds' simulation first). Renders nothing for anything else.
 */

const TONE: Record<string, "ok" | "warn" | "bad" | "info"> = { confirmed: "ok", booking: "info", unknown: "warn", failed: "bad", cancelled: "bad" };

/** `finance`: the viewer may see what Mada pays (finance.view or desk.finance, DESK-PLAN §4.3); support agents don't. */
export async function HotelbedsCard({ requestId, details, act, finance = false, t }: { requestId: string; details: Record<string, unknown>; act: boolean; finance?: boolean; t: T }) {
  const transfer = (details as { transfer?: TransferDetails }).transfer ?? null;
  const order = transfer ? null : await orderForRequest(requestId);
  const rate = order ? await stayRateOf(order) : null;
  if (!transfer && !rate) return null;
  const source = transfer ? { kind: "request" as const, id: requestId } : { kind: "order" as const, id: order!.id };
  const rows = await supplierBookingsFor(source.kind, source.id);
  const live = rows.find((r) => ["booking", "confirmed", "unknown"].includes(r.status));
  const product = transfer ? "transfers" : "hotels";
  const allowed = hotelbedsBookingAllowed(product);
  const env = `${hotelbedsMode(product) === "mock" ? "mock" : hotelbedsEnv()}`;
  return (
    <Card>
      <CardHead title={t("Hotelbeds")} hint={transfer ? t("Airport pickup · {vehicle}", { vehicle: transfer.vehicle }) : t("Stays: {mode} mode", { mode: t(staysMode() === "live" ? "live" : "request") })}
        action={<Badge tone={env === "live" ? "ok" : "warn"}>{env}</Badge>} />
      {transfer && (
        <KV items={[
          [t("Route"), <span key="r" dir="ltr">{transfer.airport} → {transfer.hotel ?? "—"}</span>],
          [t("Lands"), <span key="l" className="num" dir="ltr">{transfer.arrival.replace("T", " ")}{transfer.flightNumber ? ` · ${transfer.flightNumber}` : ""}</span>],
          ...(finance ? [[t("Supplier price"), <span key="n" className="num" dir="ltr">{transfer.net.toFixed(2)} {transfer.currency}</span>] as [string, React.ReactNode]] : []),
          [t("Free to cancel until"), transfer.freeCancelUntil ?? t("Not refundable")],
        ]} />
      )}
      {rows.map((r) => <BookingRow key={r.id} r={r} act={act} t={t} />)}
      {!live && act && (allowed.ok ? (
        <ActionForm action={transfer ? hbBookTransferAction : hbBookStayAction} className="mt-3">
          <input type="hidden" name={transfer ? "requestId" : "orderId"} value={transfer ? requestId : order!.id} />
          <SubmitButton variant="gold" className="w-full" confirm={t("Book this on Hotelbeds now?")}>{transfer ? <Car className="size-4" /> : <BedDouble className="size-4" />}{t("Book on Hotelbeds")}</SubmitButton>
          <p className="mt-2 text-[12px] text-ink-3">{rate?.recheck ? t("This rate needs a price check first; it runs before booking.") : t("Books the exact rate the traveller picked, with their names.")}</p>
        </ActionForm>
      ) : <p className="mt-3 text-[12.5px] text-warn">{allowed.why}</p>)}
    </Card>
  );
}

function BookingRow({ r, act, t }: { r: SupplierBookingRow; act: boolean; t: T }) {
  return (
    <div className="mt-3 rounded-2xl bg-surface-2 p-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <span className="num font-medium" dir="ltr">{r.supplierRef ?? t("No reference yet")}</span>
        <Badge tone={TONE[r.status] ?? "info"}>{t(r.status)}</Badge>
      </div>
      <div className="mt-1 text-[12px] text-ink-3">{t("Our reference")} <span className="num" dir="ltr">{r.clientReference}</span> · {r.environment}/{r.mode}{r.bookedBy ? ` · ${r.bookedBy}` : ""}</div>
      {r.problem && <p className="mt-1 text-[12px] text-bad">{r.problem}</p>}
      {r.supplierRef && ["confirmed", "cancelled"].includes(r.status) && (
        <div className="mt-2 flex flex-wrap gap-3 text-[12.5px]">
          <a className="inline-flex items-center gap-1 text-ink underline" href={`/adminwork/desk/hotelbeds/${r.id}/voucher?lang=en`} target="_blank" rel="noreferrer"><FileText className="size-3.5" />{t("Voucher")}</a>
          <a className="text-ink underline" href={`/adminwork/desk/hotelbeds/${r.id}/voucher?lang=ar`} target="_blank" rel="noreferrer">{t("Voucher (Arabic)")}</a>
        </div>
      )}
      {act && r.status === "confirmed" && (
        <div className="mt-2 flex gap-2">
          <ActionForm action={hbCancelAction}><input type="hidden" name="bookingId" value={r.id} /><SubmitButton variant="outline" size="sm">{t("What would cancelling cost?")}</SubmitButton></ActionForm>
          <ActionForm action={hbCancelAction}><input type="hidden" name="bookingId" value={r.id} /><input type="hidden" name="confirm" value="yes" /><SubmitButton variant="danger" size="sm" confirm={t("Cancel this booking on Hotelbeds?")}>{t("Cancel on Hotelbeds")}</SubmitButton></ActionForm>
        </div>
      )}
    </div>
  );
}
