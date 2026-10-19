import { PlaneTakeoff, RefreshCw, Ticket } from "lucide-react";
import { Badge, Card, CardHead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { Facts } from "@/components/desk/parts";
import type { T } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { flightBookingOf, supplierFlightOf } from "@/lib/app/booking/supplier-flights";
import type { BookingOrder } from "@/lib/app/desk/adapters";
import { supplierFlightAction } from "@/app/adminwork/(app)/desk/flight-supplier-actions";

/*
 * On a desk order whose flight came from TBO: the booking at TBO (booking id, PNR, low-cost or full-service, the last
 * day to ticket, ticket numbers), and the buttons that move it: hold with TBO, ticket now, check with TBO. What TBO
 * says lands on the order as the usual outcome. Renders nothing for any other order.
 */

const TONE: Record<string, "ok" | "warn" | "bad" | "info"> = {
  held: "info", ticket_now: "info", pending: "warn", ticketed: "ok", price_changed: "warn", schedule_changed: "warn", failed: "bad", ticketed_unpaid: "bad",
};
const LABEL: Record<string, string> = {
  held: "Held at TBO", ticket_now: "Fare confirmed · ticket now", pending: "Waiting on TBO", ticketed: "Ticketed", price_changed: "Fare changed",
  schedule_changed: "Times changed", failed: "Didn't go through", ticketed_unpaid: "Ticketed · card not captured",
};

export function FlightSupplierCard({ order, requestId, act, issue, names, t }: { order: BookingOrder | null; requestId: string; act: boolean; issue: boolean; names: string[]; t: T }) {
  if (!order || !supplierFlightOf(order)) return null;
  const fb = flightBookingOf(order);
  const open = ["pending_agent", "held", "price_locked", "issuing"].includes(order.status);
  const canHold = open && (order.status === "pending_agent" || (order.status === "held" && (!fb || fb.state === "failed")));
  const canTicket = open && order.status !== "pending_agent" && !!fb && ["held", "ticket_now", "price_changed"].includes(fb.state);
  const canCheck = !!fb && fb.parts.length > 0 && fb.state !== "ticketed";
  const step = (name: "hold" | "ticket" | "check") => <><input type="hidden" name="id" value={requestId} /><input type="hidden" name="step" value={name} /></>;
  return (
    <Card>
      <CardHead title={t("TBO")} hint={t("Booked and ticketed through TBO Air with the travellers' passport details.")}
        action={fb ? <Badge tone={TONE[fb.state] ?? "info"}>{t(LABEL[fb.state] ?? fb.state)}</Badge> : <Badge>{t("Not held yet")}</Badge>} />
      {fb && fb.parts.map((p, i) => (
        <Facts key={p.resultIndex + i} rows={[
          ...(fb.parts.length > 1 ? [[t("Booking"), t(i === 0 ? "Outbound" : "Return")] as [string, React.ReactNode]] : []),
          [t("Airline type"), t(p.lcc ? "Low-cost (no hold, ticket straight away)" : "Full-service (held, then ticketed)")],
          [t("TBO booking id"), <span key="b" className="num" dir="ltr">{p.bookingId ?? "—"}</span>],
          [t("PNR"), <span key="p" className="num" dir="ltr">{p.pnr ?? "—"}</span>],
          ...(p.lastTicketDate ? [[t("Ticket by"), fmtDate(p.lastTicketDate, t.locale, true)] as [string, React.ReactNode]] : []),
          ...p.tickets.map((tk, j) => [names[j] ?? t("Ticket"), <span key={`t${j}`} className="num" dir="ltr">{tk}</span>] as [string, React.ReactNode]),
        ]} />
      ))}
      {fb?.note && <p className="mt-3 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">{fb.note}</p>}
      {!!fb?.ssrForDesk.length && <p className="mt-3 text-[12.5px] text-ink-3">{t("Not sent through TBO, add with the airline:")} <span className="num" dir="ltr">{fb.ssrForDesk.join(" ")}</span></p>}
      {act && (canHold || canTicket || canCheck) && (
        <div className="mt-3 space-y-2">
          {canHold && (
            <ActionForm action={supplierFlightAction}>
              {step("hold")}
              <SubmitButton variant="gold" className="w-full" confirm={t("Check the fare and hold these seats with TBO?")}><PlaneTakeoff className="size-4" />{t("Confirm and hold with TBO")}</SubmitButton>
            </ActionForm>
          )}
          {canTicket && (issue ? (
            <ActionForm action={supplierFlightAction}>
              {step("ticket")}
              <SubmitButton className="w-full" confirm={t("Issue the tickets at TBO and capture the card?")}><Ticket className="size-4" />{t("Ticket now")}</SubmitButton>
            </ActionForm>
          ) : <p className="text-[12.5px] text-ink-3">{t("Ticketing needs the desk issuing right.")}</p>)}
          {canCheck && (
            <ActionForm action={supplierFlightAction}>
              {step("check")}
              <SubmitButton variant="outline" className="w-full"><RefreshCw className="size-4" />{t("Check with TBO")}</SubmitButton>
            </ActionForm>
          )}
        </div>
      )}
    </Card>
  );
}
