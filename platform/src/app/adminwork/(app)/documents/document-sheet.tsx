import { type ReactNode } from "react";
import { Plane, TrainFront, Bus, Ship, Car } from "lucide-react";
import { StampImg } from "./stamp-img";
import { AirlineLogo } from "./airline-logo";
import {
  type DocType, type ItineraryData, type TransportData, type VoucherData, type ReceiptData, type FlightItem, type LayoverItem, type TransportMode,
  TRANSPORT_LABEL, receiptTotals, money2, nights, itineraryItems,
} from "./types";

const GREEN = "#1e352d", GREEN2 = "#284539", GOLD = "#c99c52", INK = "#14211c", SUB = "#6b7a71", HAIR = "#e6e9e6", TINT = "#eef2ef", TINTLINE = "#dde6e0";

function fmtD(iso: string, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function titleFor(type: DocType, data: unknown): string {
  if (type === "itinerary") return "E-Ticket · Itinerary";
  if (type === "transport") return `${TRANSPORT_LABEL[(data as TransportData).mode]} Ticket`;
  if (type === "voucher") return "Hotel Voucher";
  return (data as ReceiptData).invoice ? "Tax Invoice" : "Payment Receipt";
}

const MODE_ICON: Record<TransportMode, typeof Bus> = { train: TrainFront, bus: Bus, ferry: Ship, car: Car };

const Label = ({ children, tone = SUB }: { children: ReactNode; tone?: string }) => (
  <div style={{ color: tone, fontSize: 9, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase" }}>{children}</div>
);
// Muted caption inside the dark header band.
const HLabel = ({ children }: { children: ReactNode }) => (
  <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 8.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>{children}</div>
);
const Val = ({ children }: { children: ReactNode }) => (
  <div style={{ color: INK, fontSize: 13, fontWeight: 500, marginTop: 3 }}>{children || "—"}</div>
);
const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div><Label>{label}</Label><Val>{children}</Val></div>
);
const SectionTitle = ({ children }: { children: ReactNode }) => (
  <div style={{ color: GREEN, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>{children}</div>
);

// A tinted strip of key/value cells — the modern boarding-pass "info band".
function InfoStrip({ cells }: { cells: { label: string; value: ReactNode }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cells.length}, 1fr)`, gap: 14, background: TINT, border: `1px solid ${TINTLINE}`, borderRadius: 14, padding: "13px 18px", margin: "18px 0" }}>
      {cells.map((c, i) => (
        <div key={i}><Label tone={GREEN2}>{c.label}</Label><div style={{ color: INK, fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>{c.value || "—"}</div></div>
      ))}
    </div>
  );
}

// The boarding-pass route header: big endpoints, a dashed connector with a mode icon, and a centre pill.
function RouteHero({ left, leftSub, leftTime, right, rightSub, rightTime, pill, Icon, big }: {
  left: string; leftSub?: string; leftTime?: string; right: string; rightSub?: string; rightTime?: string; pill?: string; Icon: typeof Plane; big?: boolean;
}) {
  const code = { fontSize: big ? 36 : 24, fontWeight: 800, color: INK, lineHeight: 1.05, letterSpacing: big ? "0.01em" : 0 };
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 14 }}>
        <div style={{ minWidth: 0 }}><div style={code as object}>{left || "—"}</div></div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 128 }}>
          {pill && <div style={{ fontSize: 10.5, color: GREEN2, fontWeight: 600 }}>{pill}</div>}
          <div style={{ display: "flex", alignItems: "center", width: "100%", gap: 6 }}>
            <div style={{ flex: 1, height: 0, borderTop: `1.5px dashed ${TINTLINE}` }} />
            <span style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 999, background: GREEN }}><Icon size={15} color="#fff" strokeWidth={2} /></span>
            <div style={{ flex: 1, height: 0, borderTop: `1.5px dashed ${TINTLINE}` }} />
          </div>
        </div>
        <div style={{ minWidth: 0, textAlign: "end" }}><div style={code as object}>{right || "—"}</div></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 11.5, color: SUB }}>{leftSub || ""}</div>
          {leftTime && <div style={{ fontSize: 12.5, fontWeight: 600, color: GREEN, marginTop: 2 }}>{leftTime}</div>}
        </div>
        <div style={{ textAlign: "end" }}>
          <div style={{ fontSize: 11.5, color: SUB }}>{rightSub || ""}</div>
          {rightTime && <div style={{ fontSize: 12.5, fontWeight: 600, color: GREEN, marginTop: 2 }}>{rightTime}</div>}
        </div>
      </div>
    </div>
  );
}

export function DocumentSheet({ type, refNo, date, data, locale = "en" }: {
  type: DocType; refNo: string; date: string; data: ItineraryData | TransportData | VoucherData | ReceiptData; locale?: string;
}) {
  const qr = (type === "itinerary" || type === "transport") ? (data as { qrImage?: string }).qrImage : "";
  return (
    <div className="sheet relative mx-auto flex flex-col bg-white shadow-card" style={{ color: INK }}>
      {/* Header band */}
      <div style={{ background: GREEN, padding: "15mm 16mm 13mm", color: "#fff", position: "relative", overflow: "hidden" }}>
        {/* faint brand symbol watermark */}
        <img src="/adminwork/symbol-sand.svg" alt="" style={{ position: "absolute", top: -46, insetInlineEnd: -40, height: 190, opacity: 0.05, pointerEvents: "none" }} />
        <div className="flex items-center justify-between" style={{ gap: 20, position: "relative" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <img src="/adminwork/symbol-sand.svg" alt="" style={{ height: 42, width: "auto" }} />
              <img src="/adminwork/wordmark-sand.svg" alt="Mada Trips" style={{ height: 31, width: "auto" }} />
            </div>
            <div style={{ marginTop: 14, fontSize: 15, fontWeight: 700, letterSpacing: "0.11em", textTransform: "uppercase", color: GOLD }}>{titleFor(type, data)}</div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexShrink: 0 }}>
            <div style={{ textAlign: "end" }}>
              <HLabel>Reference</HLabel>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginTop: 2 }}>{refNo}</div>
              <div style={{ marginTop: 9 }}><HLabel>Issued</HLabel></div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.86)", marginTop: 2 }}>{fmtD(date, locale)}</div>
            </div>
            {qr && (
              <div style={{ background: "#fff", borderRadius: 10, padding: 6, flexShrink: 0 }}>
                <img src={qr} alt="QR" style={{ width: 70, height: 70, display: "block" }} />
                <div style={{ fontSize: 7, color: SUB, textAlign: "center", marginTop: 2, letterSpacing: "0.04em" }}>SCAN TO VERIFY</div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={{ height: 3, background: GOLD }} />

      {/* Body */}
      <div className="flex-1" style={{ padding: "22px 16mm 0" }}>
        {type === "itinerary" && <Itinerary d={data as ItineraryData} locale={locale} />}
        {type === "transport" && <Transport d={data as TransportData} locale={locale} />}
        {type === "voucher" && <Voucher d={data as VoucherData} locale={locale} />}
        {type === "receipt" && <Receipt d={data as ReceiptData} locale={locale} />}
      </div>

      <Authorisation />
      {stampOn(type, data) && <StampImg />}
      <Footer type={type} data={data} />
    </div>
  );
}

function stampOn(type: DocType, data: unknown): boolean {
  return !!(data as { stamp?: boolean }).stamp;
}

// Branded authorisation — the document is issued by the company, never a named individual.
function Authorisation() {
  return (
    <div style={{ padding: "0 16mm", marginTop: 24 }}>
      <div style={{ display: "inline-block" }}>
        <div style={{ fontSize: 9, color: SUB, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase" }}>Issued &amp; authorised by</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: GREEN, marginTop: 3 }}>Mada Trips</div>
      </div>
    </div>
  );
}

function Transport({ d, locale }: { d: TransportData; locale: string }) {
  const Icon = MODE_ICON[d.mode] ?? Bus;
  const pill = [TRANSPORT_LABEL[d.mode], d.operator].filter(Boolean).join(" · ") || TRANSPORT_LABEL[d.mode];
  return (
    <div>
      <RouteHero
        left={d.fromPlace || "—"} leftTime={d.departTime ? `Departs ${d.departTime}` : ""}
        right={d.toPlace || "—"} rightTime={d.arriveTime ? `Arrives ${d.arriveTime}` : ""}
        leftSub={fmtD(d.date, locale)} rightSub={d.serviceNo ? `Service ${d.serviceNo}` : ""}
        pill={pill} Icon={Icon}
      />

      <InfoStrip cells={[
        { label: "Class", value: d.travelClass },
        { label: "Seat", value: d.seat },
        { label: "Coach / platform", value: d.coach },
        { label: "Booking ref", value: d.bookingRef },
      ]} />

      {d.passengers.some((p) => p.name.trim()) && (
        <div style={{ marginBottom: 6 }}>
          <SectionTitle>Passengers</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
            {d.passengers.filter((p) => p.name.trim()).map((p, i) => <PaxChip key={i} name={p.name} kind={p.kind} n={i + 1} />)}
          </div>
        </div>
      )}
      {d.notes.trim() && <Notes text={d.notes} />}
    </div>
  );
}

function PaxChip({ name, kind, n }: { name: string; kind: string; n: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${HAIR}`, borderRadius: 10, padding: "9px 12px" }}>
      <span style={{ display: "grid", placeItems: "center", width: 22, height: 22, borderRadius: 999, background: TINT, color: GREEN, fontSize: 11, fontWeight: 700 }}>{n}</span>
      <span style={{ fontSize: 13, color: INK, fontWeight: 500 }}>{name}</span>
      <span style={{ marginInlineStart: "auto", fontSize: 10.5, color: SUB }}>{kind}</span>
    </div>
  );
}

function Footer({ type, data }: { type: DocType; data: ItineraryData | TransportData | VoucherData | ReceiptData }) {
  const c = type === "receipt" ? (data as ReceiptData).company : null;
  const parts = c
    ? [c.address, c.phone, c.email, c.cr && `C.R. ${c.cr}`, c.vat && `VAT ${c.vat}`].filter(Boolean)
    : ["Riyadh, Kingdom of Saudi Arabia", "+966 59 305 4981", "info@madatrips.sa", "madatrips.sa"];
  const note = type === "itinerary"
    ? "This itinerary reflects your confirmed booking. Please carry a valid passport/ID and arrive at the airport at least 3 hours before departure."
    : type === "transport"
    ? "Please carry a valid ID and arrive at the station/terminal in good time before departure. Keep this ticket for inspection."
    : type === "voucher"
    ? "Please present this voucher at check-in. Charges beyond those stated are settled directly with the hotel."
    : "Thank you for your business.";
  return (
    <div style={{ marginTop: "auto", padding: "18px 16mm 16mm" }}>
      <div style={{ borderTop: `1px solid ${HAIR}`, paddingTop: 12, fontSize: 10, color: SUB, lineHeight: 1.7, textAlign: "center" }}>
        <div style={{ fontStyle: "italic", marginBottom: 7 }}>{note}</div>
        <span style={{ fontWeight: 600, color: GREEN }}>Mada Trips</span>{"  ·  "}{parts.join("  ·  ")}
      </div>
    </div>
  );
}

/* ─────────── Itinerary ─────────── */
function Itinerary({ d, locale }: { d: ItineraryData; locale: string }) {
  const tickets = d.ticketNumbers.split("\n").map((s) => s.trim()).filter(Boolean);
  const items = itineraryItems(d);
  const flights = items.filter((it): it is FlightItem => it.kind === "flight");
  const first = flights[0], last = flights[flights.length - 1];
  const stops = Math.max(0, flights.length - 1);
  return (
    <div>
      {first && (
        <RouteHero
          big
          left={first.fromCode || "—"} leftSub={[first.fromCity, fmtD(first.departDate, locale)].filter(Boolean).join(" · ")} leftTime={first.departTime}
          right={last.toCode || "—"} rightSub={[last.toCity, fmtD(last.arriveDate, locale)].filter(Boolean).join(" · ")} rightTime={last.arriveTime}
          pill={stops === 0 ? "Direct" : `${stops} stop${stops > 1 ? "s" : ""}`} Icon={Plane}
        />
      )}

      <InfoStrip cells={[
        { label: "Booking ref (PNR)", value: d.bookingRef },
        { label: "Ticket number(s)", value: tickets.length ? tickets.join(", ") : "—" },
      ]} />

      <SectionTitle>Passengers</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", marginBottom: 22 }}>
        {d.passengers.filter((p) => p.name.trim()).map((p, i) => <PaxChip key={i} name={p.name} kind={p.kind} n={i + 1} />)}
        {!d.passengers.some((p) => p.name.trim()) && <div style={{ fontSize: 13, color: SUB }}>—</div>}
      </div>

      <SectionTitle>Flights</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((it, i) =>
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
    <div style={{ border: `1px solid ${HAIR}`, borderRadius: 14, padding: 15 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <AirlineLogo code={s.airlineCode} name={s.airline} />
          <div style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>{[s.airline, s.flightNo].filter(Boolean).join(" ") || "Flight"}</div>
        </div>
        <div style={{ fontSize: 11, color: SUB, whiteSpace: "nowrap" }}>{[s.cabin, s.baggage && `${s.baggage} bags`].filter(Boolean).join(" · ")}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ fontSize: 21, fontWeight: 800, color: INK }}>{s.fromCode || "—"}</div>
          <div style={{ fontSize: 11, color: SUB }}>{[s.fromCity, s.fromTerminal && `Terminal ${s.fromTerminal}`].filter(Boolean).join(" · ")}</div>
          <div style={{ fontSize: 11, color: GREEN, marginTop: 4, fontWeight: 600 }}>{fmtD(s.departDate, locale)} {s.departTime}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 22, height: 0, borderTop: `1.5px dashed ${TINTLINE}` }} />
          <Plane size={14} color={GOLD} strokeWidth={2.2} style={{ transform: "rotate(45deg)" }} />
          <div style={{ width: 22, height: 0, borderTop: `1.5px dashed ${TINTLINE}` }} />
        </div>
        <div style={{ textAlign: "end" }}>
          <div style={{ fontSize: 21, fontWeight: 800, color: INK }}>{s.toCode || "—"}</div>
          <div style={{ fontSize: 11, color: SUB }}>{[s.toCity, s.toTerminal && `Terminal ${s.toTerminal}`].filter(Boolean).join(" · ")}</div>
          <div style={{ fontSize: 11, color: GREEN, marginTop: 4, fontWeight: 600 }}>{fmtD(s.arriveDate, locale)} {s.arriveTime}</div>
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
      <div style={{ marginBottom: 4 }}>
        <Label>Hotel</Label>
        <div style={{ fontSize: 24, fontWeight: 800, color: GREEN, marginTop: 3 }}>{d.hotel || "—"}</div>
        <div style={{ fontSize: 12, color: SUB, marginTop: 3 }}>{[d.address, d.city].filter(Boolean).join(", ")}</div>
      </div>

      <InfoStrip cells={[
        { label: "Check-in", value: fmtD(d.checkIn, locale) },
        { label: "Check-out", value: fmtD(d.checkOut, locale) },
        { label: "Nights", value: n ?? "—" },
        { label: "Rooms", value: d.rooms },
      ]} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px 16px" }}>
        <Field label="Guest">{d.guest}</Field>
        <Field label="Confirmation no.">{d.confirmationNo}</Field>
        <Field label="Occupancy">{d.occupancy}</Field>
        <Field label="Room type">{d.roomType}</Field>
        <Field label="Board">{d.board}</Field>
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
      <div style={{ display: "flex", alignItems: "stretch", justifyContent: "space-between", gap: 16, background: GREEN, borderRadius: 14, padding: "16px 20px", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 9, color: GOLD, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase" }}>Total {d.invoice ? "(incl. VAT)" : "paid"}</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#fff", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>SAR {money2(total, locale)}</div>
        </div>
        <div style={{ textAlign: "end", color: "rgba(255,255,255,0.82)", fontSize: 11.5 }}>
          <div style={{ color: GOLD, fontSize: 9, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase" }}>Payment method</div>
          <div style={{ color: "#fff", fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>{d.method}</div>
          {d.reference && <div style={{ marginTop: 2 }}>{d.reference}</div>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, marginBottom: 18 }}>
        <Field label="Billed to">{d.billTo}{d.billToVat && <span style={{ fontSize: 11, color: SUB, fontWeight: 400 }}> · VAT {d.billToVat}</span>}</Field>
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
              <td style={{ padding: "10px 0", fontSize: 13, color: INK }}>{it.description || "—"}</td>
              <td style={{ padding: "10px 0", fontSize: 13, color: INK, textAlign: "end", fontVariantNumeric: "tabular-nums" }}>{money2(Number(String(it.amount).replace(/,/g, "")) || 0, locale)}</td>
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
