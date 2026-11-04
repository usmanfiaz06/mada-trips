import { type ReactNode } from "react";
import { StampImg } from "./stamp-img";
import { AirlineLogo } from "./airline-logo";
import {
  type DocType, type ItineraryData, type VoucherData, type ReceiptData, type FlightItem, type LayoverItem,
  receiptTotals, money2, nights, itineraryItems,
} from "./types";

const GREEN = "#1e352d", GOLD = "#d9b77a", INK = "#14211c", SUB = "#6b7a71", HAIR = "#e6e9e6";

function fmtD(iso: string, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function titleFor(type: DocType, data: unknown): string {
  if (type === "itinerary") return "E-Ticket · Itinerary";
  if (type === "voucher") return "Hotel Voucher";
  return (data as ReceiptData).invoice ? "Tax Invoice" : "Payment Receipt";
}

const Label = ({ children }: { children: ReactNode }) => (
  <div style={{ color: SUB, fontSize: 9.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>{children}</div>
);
const Val = ({ children }: { children: ReactNode }) => (
  <div style={{ color: INK, fontSize: 13, fontWeight: 500, marginTop: 2 }}>{children || "—"}</div>
);
const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div><Label>{label}</Label><Val>{children}</Val></div>
);
const SectionTitle = ({ children }: { children: ReactNode }) => (
  <div style={{ color: GREEN, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>{children}</div>
);

export function DocumentSheet({ type, refNo, date, data, locale = "en" }: {
  type: DocType; refNo: string; date: string; data: ItineraryData | VoucherData | ReceiptData; locale?: string;
}) {
  return (
    <div className="sheet relative mx-auto flex flex-col bg-white shadow-card" style={{ color: INK }}>
      {/* Header */}
      <div className="flex items-start justify-between" style={{ padding: "16mm 16mm 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <img src="/adminwork/symbol-green.svg" alt="" style={{ height: 44, width: "auto" }} />
          <img src="/adminwork/wordmark-green.svg" alt="Mada Trips" style={{ height: 34, width: "auto" }} />
        </div>
        <div style={{ textAlign: "end" }}>
          <div style={{ color: GREEN, fontSize: 15, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>{titleFor(type, data)}</div>
          <div style={{ color: SUB, fontSize: 11, marginTop: 4 }}>
            <span style={{ fontWeight: 600, color: INK }}>{refNo}</span> · {fmtD(date, locale)}
          </div>
        </div>
      </div>
      <div style={{ margin: "12px 16mm 0", height: 2, background: GOLD }} />
      <div style={{ margin: "0 16mm", height: 1, background: HAIR }} />

      {/* Body */}
      <div className="flex-1" style={{ padding: "22px 16mm 0" }}>
        {type === "itinerary" && <Itinerary d={data as ItineraryData} locale={locale} />}
        {type === "voucher" && <Voucher d={data as VoucherData} locale={locale} />}
        {type === "receipt" && <Receipt d={data as ReceiptData} locale={locale} />}
      </div>

      {/* Authorised-by + stamp + footer */}
      <AuthorisedBy name={authName(type, data)} />
      {stampOn(type, data) && <StampImg />}
      <Footer type={type} data={data} />
    </div>
  );
}

function authName(type: DocType, data: unknown): string {
  return (data as { authorisedBy?: string }).authorisedBy ?? "";
}
function stampOn(type: DocType, data: unknown): boolean {
  return !!(data as { stamp?: boolean }).stamp;
}

function AuthorisedBy({ name }: { name: string }) {
  if (!name) return null;
  return (
    <div style={{ padding: "0 16mm", marginTop: 18 }}>
      <div style={{ display: "inline-block" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>{name}</div>
        <div style={{ borderTop: `1px solid ${HAIR}`, marginTop: 4, paddingTop: 4, fontSize: 9.5, color: SUB, letterSpacing: "0.06em", textTransform: "uppercase" }}>Authorised signatory · Mada Trips</div>
      </div>
    </div>
  );
}

function Footer({ type, data }: { type: DocType; data: ItineraryData | VoucherData | ReceiptData }) {
  const c = type === "receipt" ? (data as ReceiptData).company : null;
  const parts = c
    ? [c.address, c.phone, c.email, c.cr && `C.R. ${c.cr}`, c.vat && `VAT ${c.vat}`].filter(Boolean)
    : ["Mada Trips · Riyadh, Kingdom of Saudi Arabia", "+966 59 305 4981", "info@madatrips.sa", "madatrips.sa"];
  const note = type === "itinerary"
    ? "This itinerary reflects your confirmed booking. Please carry a valid passport/ID and arrive at the airport at least 3 hours before departure."
    : type === "voucher"
    ? "Please present this voucher at check-in. Charges beyond those stated are settled directly with the hotel."
    : "Thank you for your business.";
  return (
    <div style={{ marginTop: "auto", padding: "16px 16mm 16mm" }}>
      <div style={{ borderTop: `1px solid ${HAIR}`, paddingTop: 10, fontSize: 10, color: SUB, lineHeight: 1.7, textAlign: "center" }}>
        <div style={{ fontStyle: "italic", marginBottom: 6 }}>{note}</div>
        {parts.join("  ·  ")}
      </div>
    </div>
  );
}

/* ─────────── Itinerary ─────────── */
function Itinerary({ d, locale }: { d: ItineraryData; locale: string }) {
  const tickets = d.ticketNumbers.split("\n").map((s) => s.trim()).filter(Boolean);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <Field label="Booking reference (PNR)">{d.bookingRef}</Field>
        <Field label="Ticket number(s)">{tickets.length ? tickets.join(", ") : "—"}</Field>
      </div>

      <SectionTitle>Passengers</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", marginBottom: 22 }}>
        {d.passengers.filter((p) => p.name.trim()).map((p, i) => (
          <div key={i} style={{ fontSize: 13, color: INK }}>
            <span style={{ color: SUB, marginInlineEnd: 8 }}>{i + 1}.</span>{p.name}
            <span style={{ color: SUB, fontSize: 11 }}> · {p.kind}</span>
          </div>
        ))}
        {!d.passengers.some((p) => p.name.trim()) && <div style={{ fontSize: 13, color: SUB }}>—</div>}
      </div>

      <SectionTitle>Flights</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {itineraryItems(d).map((it, i) =>
          it.kind === "flight" ? <FlightCard key={i} s={it} locale={locale} />
          : it.kind === "layover" ? <LayoverBar key={i} lay={it} />
          : <JourneyDivider key={i} label={it.label} />
        )}
      </div>

      {d.notes.trim() && <Notes text={d.notes} />}
    </div>
  );
}

function FlightCard({ s, locale }: { s: FlightItem; locale: string }) {
  return (
    <div style={{ border: `1px solid ${HAIR}`, borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <AirlineLogo code={s.airlineCode} name={s.airline} />
          <div style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>{[s.airline, s.flightNo].filter(Boolean).join(" ") || "Flight"}</div>
        </div>
        <div style={{ fontSize: 11, color: SUB, whiteSpace: "nowrap" }}>{[s.cabin, s.baggage && `${s.baggage} bags`].filter(Boolean).join(" · ")}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: INK }}>{s.fromCode || "—"}</div>
          <div style={{ fontSize: 11, color: SUB }}>{[s.fromCity, s.fromTerminal && `Terminal ${s.fromTerminal}`].filter(Boolean).join(" · ")}</div>
          <div style={{ fontSize: 11, color: INK, marginTop: 4 }}>{fmtD(s.departDate, locale)} {s.departTime}</div>
        </div>
        <div style={{ color: GOLD, fontSize: 18 }}>→</div>
        <div style={{ textAlign: "end" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: INK }}>{s.toCode || "—"}</div>
          <div style={{ fontSize: 11, color: SUB }}>{[s.toCity, s.toTerminal && `Terminal ${s.toTerminal}`].filter(Boolean).join(" · ")}</div>
          <div style={{ fontSize: 11, color: INK, marginTop: 4 }}>{fmtD(s.arriveDate, locale)} {s.arriveTime}</div>
        </div>
      </div>
    </div>
  );
}

function LayoverBar({ lay }: { lay: LayoverItem }) {
  const text = ["Layover", lay.place && `in ${lay.place}`, lay.duration, lay.note].filter(Boolean).join(" · ");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "1px 10px" }}>
      <div style={{ flex: 1, height: 1, background: HAIR }} />
      <div style={{ fontSize: 10, color: SUB, whiteSpace: "nowrap", letterSpacing: "0.02em" }}>{text}</div>
      <div style={{ flex: 1, height: 1, background: HAIR }} />
    </div>
  );
}

function JourneyDivider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px 2px" }}>
      <div style={{ flex: 1, height: 1, background: HAIR }} />
      <div style={{ fontSize: 9.5, fontWeight: 700, color: GREEN, letterSpacing: "0.12em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{label || "Return"}</div>
      <div style={{ flex: 1, height: 1, background: HAIR }} />
    </div>
  );
}

/* ─────────── Voucher ─────────── */
function Voucher({ d, locale }: { d: VoucherData; locale: string }) {
  const n = nights(d.checkIn, d.checkOut);
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <Label>Hotel</Label>
        <div style={{ fontSize: 22, fontWeight: 700, color: GREEN, marginTop: 2 }}>{d.hotel || "—"}</div>
        <div style={{ fontSize: 12, color: SUB, marginTop: 2 }}>{[d.address, d.city].filter(Boolean).join(", ")}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px 16px", marginBottom: 20 }}>
        <Field label="Guest">{d.guest}</Field>
        <Field label="Confirmation no.">{d.confirmationNo}</Field>
        <Field label="Rooms">{d.rooms}</Field>
        <Field label="Check-in">{fmtD(d.checkIn, locale)}</Field>
        <Field label="Check-out">{fmtD(d.checkOut, locale)}</Field>
        <Field label="Nights">{n ?? "—"}</Field>
        <Field label="Room type">{d.roomType}</Field>
        <Field label="Board">{d.board}</Field>
        <Field label="Occupancy">{d.occupancy}</Field>
      </div>
      {d.notes.trim() && <Notes text={d.notes} />}
    </div>
  );
}

/* ─────────── Receipt / Invoice ─────────── */
function Receipt({ d, locale }: { d: ReceiptData; locale: string }) {
  const { subtotal, vat, total } = receiptTotals(d);
  const items = d.items.filter((it) => it.description.trim() || it.amount.trim());
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
        <Field label="Billed to">{d.billTo}{d.billToVat && <div style={{ fontSize: 11, color: SUB, fontWeight: 400 }}>VAT {d.billToVat}</div>}</Field>
        <div style={{ textAlign: "end" }}>
          <Field label="Payment method">{d.method}{d.reference && <span style={{ color: SUB }}> · {d.reference}</span>}</Field>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${GREEN}` }}>
            <th style={{ textAlign: "start", padding: "0 0 8px", fontSize: 9.5, color: SUB, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Description</th>
            <th style={{ textAlign: "end", padding: "0 0 8px", fontSize: 9.5, color: SUB, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Amount (SAR)</th>
          </tr>
        </thead>
        <tbody>
          {items.length ? items.map((it, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${HAIR}` }}>
              <td style={{ padding: "9px 0", fontSize: 13, color: INK }}>{it.description || "—"}</td>
              <td style={{ padding: "9px 0", fontSize: 13, color: INK, textAlign: "end", fontVariantNumeric: "tabular-nums" }}>{money2(Number(String(it.amount).replace(/,/g, "")) || 0, locale)}</td>
            </tr>
          )) : (
            <tr><td colSpan={2} style={{ padding: "9px 0", fontSize: 13, color: SUB }}>—</td></tr>
          )}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ width: 240 }}>
          <Totline label="Subtotal" value={money2(subtotal, locale)} />
          {d.vatEnabled && <Totline label="VAT (15%)" value={money2(vat, locale)} />}
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: `2px solid ${GREEN}`, marginTop: 6, paddingTop: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>Total</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: GREEN, fontVariantNumeric: "tabular-nums" }}>SAR {money2(total, locale)}</span>
          </div>
        </div>
      </div>

      {d.notes.trim() && <Notes text={d.notes} />}
    </div>
  );
}
const Totline = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5, color: INK }}>
    <span style={{ color: SUB }}>{label}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
  </div>
);

function Notes({ text }: { text: string }) {
  return (
    <div style={{ marginTop: 22 }}>
      <Label>Notes</Label>
      <div style={{ fontSize: 12.5, color: INK, marginTop: 4, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{text}</div>
    </div>
  );
}
