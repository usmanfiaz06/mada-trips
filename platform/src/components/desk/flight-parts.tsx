import type { ReactNode } from "react";
import { PhoneCall, PlaneTakeoff } from "lucide-react";
import { AIRPORT_NAMES, DESTINATIONS, fareType, type FlightQuote } from "@mada/shared";
import { fmtDate } from "@/lib/dates";
import { translate } from "@/lib/i18n";
import { ActionForm, SubmitButton } from "@/components/client";
import { Badge } from "@/components/ui";
import type { ContactState } from "@/lib/app/desk/flight-quotes";
import type { QuoteSeed, QuoteTraveller } from "./flight-quote";

/*
 * Flights by request on the desk: the request's answers as facts, the fares as sent, and the badge for a booking
 * whose contact number isn't verified (APP_BOOKING_REQUIRES_PHONE=no) with "Mark confirmed by call".
 */

type Search = { destination?: string | null; destinationName?: string | null; from?: string | null; depart?: string | null; return?: string | null; cabin?: string | null; flexDays?: number; bags?: string; prefs?: string[] };
type Person = { id: string; name: string; dateOfBirth: string | null };
type Locale = "en" | "ar";

const PREFS: Record<string, string> = { direct: "Direct only", morning: "Morning flights", evening: "Evening flights", saudia: "Saudia", together: "Seats together", aisle: "Aisle seats" };
const BAGS: Record<string, string> = { cabin: "Cabin bag only", one: "One checked bag each", two: "Two checked bags each" };

export function flightFacts(details: unknown, people: Person[], locale: Locale) {
  const t = (s: string, v?: Record<string, string | number>) => translate(locale, s, v);
  const d = (details ?? {}) as { search?: Search; note?: string | null };
  const s = d.search ?? {};
  const dest = s.destination ? DESTINATIONS[s.destination] ?? null : null;
  const from = s.from ?? "RUH";
  const to = dest?.code ?? "";
  const depart = s.depart ?? new Date().toISOString().slice(0, 10);
  const travellers: QuoteTraveller[] = people.map((p) => ({ personId: p.id, name: p.name, type: fareType({ dateOfBirth: p.dateOfBirth }, depart) }));
  const rows: [ReactNode, ReactNode][] = [
    [t("Route"), <span key="r" className="num" dir="ltr">{from} → {to || s.destinationName || "?"}{dest ? ` · ${dest.name}` : ""}</span>],
    [t("Dates"), s.depart ? `${fmtDate(s.depart, locale)}${s.return ? ` → ${fmtDate(s.return, locale)}` : ` · ${t("One way")}`}` : t("Dates to agree")],
    [t("Can move"), s.flexDays ? t("±{n} days", { n: s.flexDays }) : s.flexDays === 0 ? t("Exact dates") : "—"],
    [t("Travellers"), travellers.map((p) => `${p.name.split(" ")[0]} (${t(p.type === "adult" ? "Adult" : p.type === "child" ? "Child" : "Infant")})`).join(", ") || "—"],
    [t("Cabin"), t(s.cabin ? s.cabin[0]!.toUpperCase() + s.cabin.slice(1) : "Economy")],
    [t("Bags"), s.bags ? t(BAGS[s.bags] ?? s.bags) : "—"],
    [t("Would like"), s.prefs?.length ? s.prefs.map((p) => t(PREFS[p] ?? p)).join(", ") : "—"],
  ];
  const seed: QuoteSeed = { from: AIRPORT_NAMES[from] ? from : "RUH", to, depart, ret: s.return ?? null, cabin: (s.cabin as QuoteSeed["cabin"]) ?? "economy", bags: s.bags ?? null };
  return { rows, note: d.note ?? null, travellers, seed };
}

/** The fares as the traveller sees them: each with its flights, total, bags and rules. */
export function FlightQuoteSummary({ quote, locale }: { quote: FlightQuote; locale: Locale }) {
  const t = (s: string, v?: Record<string, string | number>) => translate(locale, s, v);
  return (
    <ol className="space-y-2.5">
      {quote.options.map((o, i) => (
        <li key={o.id} className="rounded-2xl bg-surface-2 p-3">
          <div className="flex items-baseline justify-between gap-2"><span className="text-[13.5px] text-ink">{i + 1}. {o.airline} · {t(o.cabin[0]!.toUpperCase() + o.cabin.slice(1))}</span><span className="num text-[14px] text-ink" dir="ltr">SAR {(o.total.amount / 100).toLocaleString("en-US")}</span></div>
          <ul className="mt-1.5 space-y-0.5 text-[12.5px] text-ink-3">
            {o.legs.map((l, k) => <li key={k} className="flex items-center gap-1.5"><PlaneTakeoff className="size-3.5" /><span className="num" dir="ltr">{l.flightNumber} {l.from}→{l.to} · {l.date} {l.dep}–{l.arr}{l.arrDate ? " +1" : ""}</span></li>)}
          </ul>
          <p className="mt-1 text-[12px] text-ink-3">{o.baggage} · {o.changeRule} · {o.refundRule}</p>
        </li>
      ))}
    </ol>
  );
}

type State = { error?: string; ok?: string } | null;

/** "Phone not verified, call to confirm", and the one click that records the call (audited). */
export function ContactBadge({ contact, requestId, canAct, action, locale }: { contact: NonNullable<ContactState>; requestId: string; canAct: boolean; action: (s: State, fd: FormData) => Promise<State>; locale: Locale }) {
  const t = (s: string, v?: Record<string, string | number>) => translate(locale, s, v);
  if (contact.confirmedAt) {
    return <Badge tone="ok"><PhoneCall className="size-3" />{t("Confirmed by call · {name}", { name: contact.confirmedBy ?? "" })}</Badge>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="contact-unverified">
      <Badge tone="warn"><PhoneCall className="size-3" />{t("Phone not verified, call to confirm")}</Badge>
      <a href={`tel:${contact.phone}`} className="num text-ink hover:underline" dir="ltr">{contact.phone}</a>
      {canAct && (
        <ActionForm action={action} className="inline">
          <input type="hidden" name="id" value={requestId} />
          <SubmitButton size="sm" variant="outline" confirm={t("You called {phone} and they confirmed the booking?", { phone: contact.phone })}>{t("Mark confirmed by call")}</SubmitButton>
        </ActionForm>
      )}
    </span>
  );
}
