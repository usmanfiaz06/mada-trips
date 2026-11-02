"use client";
import { useActionState, useRef, useState, type ReactNode } from "react";
import { Plane, Hotel, ReceiptText, Printer, Plus, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { createDocument } from "./actions";
import { DocumentSheet } from "./document-sheet";
import {
  type DocType, type ItineraryData, type VoucherData, type ReceiptData, type Pax, type Segment, type LineItem,
  blankData,
} from "./types";

const PAX_KINDS = ["Adult", "Child", "Infant"];
const CABINS = ["Economy", "Premium economy", "Business", "First"];
const BOARDS = ["Room only", "Bed & breakfast", "Half board", "Full board", "All inclusive"];
const METHODS = ["Cash", "mada", "Credit card", "Bank transfer"];

export function DocumentBuilder({ today }: { today: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(createDocument, {} as { error?: string });
  const dataHidden = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<DocType>("itinerary");
  const [date, setDate] = useState(today);
  const [itin, setItin] = useState(() => blankData("itinerary") as ItineraryData);
  const [vouch, setVouch] = useState(() => blankData("voucher") as VoucherData);
  const [rcpt, setRcpt] = useState(() => blankData("receipt") as ReceiptData);
  const data = type === "itinerary" ? itin : type === "voucher" ? vouch : rcpt;

  function onSave() { if (dataHidden.current) dataHidden.current.value = JSON.stringify(data); }

  const TABS: { key: DocType; label: string; icon: ReactNode }[] = [
    { key: "itinerary", label: t("Flight ticket"), icon: <Plane className="size-4" /> },
    { key: "voucher", label: t("Hotel voucher"), icon: <Hotel className="size-4" /> },
    { key: "receipt", label: t("Receipt / invoice"), icon: <ReceiptText className="size-4" /> },
  ];

  return (
    <div className="mx-auto max-w-[1500px]">
      {/* Toolbar — never printed */}
      <div className="no-print sticky top-2 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface/90 p-2 backdrop-blur">
        <div className="flex items-center gap-1">
          {TABS.map((tb) => (
            <button key={tb.key} type="button" onClick={() => setType(tb.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium ${type === tb.key ? "bg-ink text-bg" : "text-ink-2 hover:bg-sunken"}`}>
              {tb.icon}{tb.label}
            </button>
          ))}
        </div>
        <label className="ms-2 flex items-center gap-2 text-[12.5px] text-ink-3">
          {t("Date")}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field h-9" />
        </label>
        <button type="button" onClick={() => window.print()} className="ms-auto inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3.5 py-2 text-[13px] font-medium text-ink-2 hover:border-ink/40"><Printer className="size-4" />{t("Print / PDF")}</button>
        <button type="submit" form="doc-form" onClick={onSave} disabled={pending} className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-bg hover:opacity-85 disabled:opacity-50">{pending ? t("Saving…") : t("Issue & save")}</button>
      </div>
      {state?.error && <div className="no-print mb-3 rounded-xl border border-bad/30 bg-bad-soft px-4 py-2.5 text-[13px] text-bad">{state.error}</div>}

      <form id="doc-form" action={action} className="hidden">
        <input name="type" value={type} readOnly />
        <input name="date" value={date} readOnly />
        <input ref={dataHidden} name="data" type="hidden" />
      </form>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_1fr]">
        {/* The form */}
        <div className="no-print space-y-5">
          {type === "itinerary" && <ItineraryForm d={itin} set={setItin} />}
          {type === "voucher" && <VoucherForm d={vouch} set={setVouch} />}
          {type === "receipt" && <ReceiptForm d={rcpt} set={setRcpt} />}
        </div>

        {/* Live preview — this is what prints */}
        <div className="print-area overflow-auto pb-10">
          <div className="origin-top scale-[0.62] sm:scale-75 md:scale-90 xl:scale-100 preview-scale">
            <DocumentSheet type={type} refNo={t("Draft")} date={date} data={data} locale={t.locale} />
          </div>
        </div>
      </div>

      <style>{`
        .sheet { width: 210mm; min-height: 297mm; }
        .field { border: 1px solid var(--line, #d7ddd7); background: var(--surface-2, #fff); border-radius: 10px; padding: 0 10px; font-size: 13px; width: 100%; }
        @media print {
          @page { size: A4; margin: 0; }
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute; inset: 0; overflow: visible !important; padding: 0 !important; }
          .preview-scale { transform: none !important; }
          .sheet { box-shadow: none !important; margin: 0 !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

/* ─────────── small form primitives ─────────── */
function Lab({ children }: { children: ReactNode }) { return <span className="mb-1 block text-[12px] font-medium text-ink-3">{children}</span>; }
function Txt({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <label className="block"><Lab>{label}</Lab><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="field h-10" /></label>;
}
function Area({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <label className="block"><Lab>{label}</Lab><textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className="field py-2 leading-relaxed" /></label>;
}
function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return <label className="block"><Lab>{label}</Lab><select value={value} onChange={(e) => onChange(e.target.value)} className="field h-10">{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>;
}
function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between"><h3 className="text-[13px] font-semibold text-ink">{title}</h3>{action}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
const AddBtn = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ink-2 hover:text-ink"><Plus className="size-3.5" />{label}</button>
);
const DelBtn = ({ onClick }: { onClick: () => void }) => (
  <button type="button" onClick={onClick} className="grid size-8 place-items-center rounded-lg text-ink-4 hover:bg-sunken hover:text-bad"><Trash2 className="size-4" /></button>
);

/* ─────────── Itinerary form ─────────── */
function ItineraryForm({ d, set }: { d: ItineraryData; set: (f: (p: ItineraryData) => ItineraryData) => void }) {
  const t = useT();
  const patchPax = (i: number, k: keyof Pax, v: string) => set((p) => ({ ...p, passengers: p.passengers.map((x, j) => j === i ? { ...x, [k]: v } : x) }));
  const patchSeg = (i: number, k: keyof Segment, v: string) => set((p) => ({ ...p, segments: p.segments.map((x, j) => j === i ? { ...x, [k]: v } : x) }));
  return (
    <>
      <Card title={t("Booking")}>
        <Txt label={t("Booking reference (PNR)")} value={d.bookingRef} onChange={(v) => set((p) => ({ ...p, bookingRef: v }))} placeholder="e.g. QX7F2P" />
        <Area label={t("Ticket number(s) — one per line")} value={d.ticketNumbers} onChange={(v) => set((p) => ({ ...p, ticketNumbers: v }))} placeholder="065-1234567890" />
      </Card>
      <Card title={t("Passengers")} action={<AddBtn onClick={() => set((p) => ({ ...p, passengers: [...p.passengers, { name: "", kind: "Adult" }] }))} label={t("Add")} />}>
        {d.passengers.map((p, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1"><Txt label={i === 0 ? t("Full name") : ""} value={p.name} onChange={(v) => patchPax(i, "name", v)} placeholder={t("As in passport")} /></div>
            <div className="w-28"><Sel label={i === 0 ? t("Type") : ""} value={p.kind} onChange={(v) => patchPax(i, "kind", v)} options={PAX_KINDS} /></div>
            {d.passengers.length > 1 && <DelBtn onClick={() => set((q) => ({ ...q, passengers: q.passengers.filter((_, j) => j !== i) }))} />}
          </div>
        ))}
      </Card>
      <Card title={t("Flights")} action={<AddBtn onClick={() => set((p) => ({ ...p, segments: [...p.segments, { ...(blankData("itinerary") as ItineraryData).segments[0] }] }))} label={t("Add flight")} />}>
        {d.segments.map((s, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface-2 p-3 space-y-2">
            <div className="flex items-center justify-between"><span className="text-[11.5px] font-medium text-ink-3">{t("Flight")} {i + 1}</span>{d.segments.length > 1 && <DelBtn onClick={() => set((q) => ({ ...q, segments: q.segments.filter((_, j) => j !== i) }))} />}</div>
            <div className="grid grid-cols-2 gap-2">
              <Txt label={t("Airline")} value={s.airline} onChange={(v) => patchSeg(i, "airline", v)} placeholder="Saudia" />
              <Txt label={t("Flight no.")} value={s.flightNo} onChange={(v) => patchSeg(i, "flightNo", v)} placeholder="SV1020" />
              <Txt label={t("From (code)")} value={s.fromCode} onChange={(v) => patchSeg(i, "fromCode", v.toUpperCase())} placeholder="RUH" />
              <Txt label={t("To (code)")} value={s.toCode} onChange={(v) => patchSeg(i, "toCode", v.toUpperCase())} placeholder="JED" />
              <Txt label={t("From city")} value={s.fromCity} onChange={(v) => patchSeg(i, "fromCity", v)} placeholder="Riyadh" />
              <Txt label={t("To city")} value={s.toCity} onChange={(v) => patchSeg(i, "toCity", v)} placeholder="Jeddah" />
              <Txt label={t("Departs — date")} value={s.departDate} onChange={(v) => patchSeg(i, "departDate", v)} placeholder="2026-11-20" />
              <Txt label={t("Departs — time")} value={s.departTime} onChange={(v) => patchSeg(i, "departTime", v)} placeholder="08:30" />
              <Txt label={t("Arrives — date")} value={s.arriveDate} onChange={(v) => patchSeg(i, "arriveDate", v)} placeholder="2026-11-20" />
              <Txt label={t("Arrives — time")} value={s.arriveTime} onChange={(v) => patchSeg(i, "arriveTime", v)} placeholder="10:15" />
              <Sel label={t("Cabin")} value={s.cabin} onChange={(v) => patchSeg(i, "cabin", v)} options={CABINS} />
              <Txt label={t("Baggage")} value={s.baggage} onChange={(v) => patchSeg(i, "baggage", v)} placeholder="2 × 23kg" />
            </div>
          </div>
        ))}
      </Card>
      <Card title={t("More")}>
        <Area label={t("Notes (optional)")} value={d.notes} onChange={(v) => set((p) => ({ ...p, notes: v }))} />
        <Txt label={t("Authorised by (optional)")} value={d.authorisedBy} onChange={(v) => set((p) => ({ ...p, authorisedBy: v }))} placeholder={t("Name on the signature line")} />
        <StampToggle on={d.stamp} set={(v) => set((p) => ({ ...p, stamp: v }))} />
      </Card>
    </>
  );
}

/* ─────────── Voucher form ─────────── */
function VoucherForm({ d, set }: { d: VoucherData; set: (f: (p: VoucherData) => VoucherData) => void }) {
  const t = useT();
  const on = <K extends keyof VoucherData>(k: K) => (v: string) => set((p) => ({ ...p, [k]: v }));
  return (
    <>
      <Card title={t("Hotel")}>
        <Txt label={t("Hotel name")} value={d.hotel} onChange={on("hotel")} placeholder="Hilton Riyadh" />
        <div className="grid grid-cols-2 gap-2">
          <Txt label={t("City")} value={d.city} onChange={on("city")} placeholder="Riyadh" />
          <Txt label={t("Confirmation no.")} value={d.confirmationNo} onChange={on("confirmationNo")} />
        </div>
        <Txt label={t("Address (optional)")} value={d.address} onChange={on("address")} />
      </Card>
      <Card title={t("Stay")}>
        <div className="grid grid-cols-2 gap-2">
          <Txt label={t("Guest name")} value={d.guest} onChange={on("guest")} />
          <Txt label={t("Rooms")} value={d.rooms} onChange={on("rooms")} placeholder="1" />
          <Txt label={t("Check-in")} value={d.checkIn} onChange={on("checkIn")} placeholder="2026-11-20" />
          <Txt label={t("Check-out")} value={d.checkOut} onChange={on("checkOut")} placeholder="2026-11-23" />
          <Txt label={t("Room type")} value={d.roomType} onChange={on("roomType")} placeholder="Deluxe King" />
          <Sel label={t("Board")} value={d.board} onChange={on("board")} options={BOARDS} />
          <Txt label={t("Occupancy")} value={d.occupancy} onChange={on("occupancy")} placeholder="2 adults" />
        </div>
      </Card>
      <Card title={t("More")}>
        <Area label={t("Notes (optional)")} value={d.notes} onChange={on("notes")} />
        <Txt label={t("Authorised by (optional)")} value={d.authorisedBy} onChange={on("authorisedBy")} />
        <StampToggle on={d.stamp} set={(v) => set((p) => ({ ...p, stamp: v }))} />
      </Card>
    </>
  );
}

/* ─────────── Receipt form ─────────── */
function ReceiptForm({ d, set }: { d: ReceiptData; set: (f: (p: ReceiptData) => ReceiptData) => void }) {
  const t = useT();
  const patchItem = (i: number, k: keyof LineItem, v: string) => set((p) => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, [k]: v } : x) }));
  const patchCo = (k: keyof ReceiptData["company"], v: string) => set((p) => ({ ...p, company: { ...p.company, [k]: v } }));
  return (
    <>
      <Card title={t("Document")}>
        <div className="flex gap-2">
          <button type="button" onClick={() => set((p) => ({ ...p, invoice: false }))} className={`flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium ${!d.invoice ? "border-gold bg-sunken text-ink" : "border-line text-ink-3"}`}>{t("Receipt")}</button>
          <button type="button" onClick={() => set((p) => ({ ...p, invoice: true }))} className={`flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium ${d.invoice ? "border-gold bg-sunken text-ink" : "border-line text-ink-3"}`}>{t("Tax invoice")}</button>
        </div>
        <Txt label={t("Billed to")} value={d.billTo} onChange={(v) => set((p) => ({ ...p, billTo: v }))} placeholder={t("Client name")} />
        {d.invoice && <Txt label={t("Client VAT no. (optional)")} value={d.billToVat} onChange={(v) => set((p) => ({ ...p, billToVat: v }))} />}
      </Card>
      <Card title={t("Items")} action={<AddBtn onClick={() => set((p) => ({ ...p, items: [...p.items, { description: "", amount: "" }] }))} label={t("Add item")} />}>
        {d.items.map((it, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1"><Txt label={i === 0 ? t("Description") : ""} value={it.description} onChange={(v) => patchItem(i, "description", v)} placeholder={t("e.g. Flight RUH–JED")} /></div>
            <div className="w-28"><Txt label={i === 0 ? t("Amount (SAR)") : ""} value={it.amount} onChange={(v) => patchItem(i, "amount", v)} placeholder="0.00" /></div>
            {d.items.length > 1 && <DelBtn onClick={() => set((q) => ({ ...q, items: q.items.filter((_, j) => j !== i) }))} />}
          </div>
        ))}
        <label className="flex items-center gap-2 pt-1 text-[12.5px] text-ink-2">
          <input type="checkbox" checked={d.vatEnabled} onChange={(e) => set((p) => ({ ...p, vatEnabled: e.target.checked }))} />
          {t("Add 15% VAT")}
        </label>
      </Card>
      <Card title={t("Payment")}>
        <div className="grid grid-cols-2 gap-2">
          <Sel label={t("Method")} value={d.method} onChange={(v) => set((p) => ({ ...p, method: v }))} options={METHODS} />
          <Txt label={t("Reference (optional)")} value={d.reference} onChange={(v) => set((p) => ({ ...p, reference: v }))} />
        </div>
      </Card>
      <Card title={t("Company details (shown in the footer)")}>
        <div className="grid grid-cols-2 gap-2">
          <Txt label={t("Company name")} value={d.company.name} onChange={(v) => patchCo("name", v)} />
          <Txt label={t("C.R. number")} value={d.company.cr} onChange={(v) => patchCo("cr", v)} />
          <Txt label={t("VAT number")} value={d.company.vat} onChange={(v) => patchCo("vat", v)} />
          <Txt label={t("Phone")} value={d.company.phone} onChange={(v) => patchCo("phone", v)} />
        </div>
        <Txt label={t("Address")} value={d.company.address} onChange={(v) => patchCo("address", v)} />
        <Txt label={t("Email")} value={d.company.email} onChange={(v) => patchCo("email", v)} />
      </Card>
      <Card title={t("More")}>
        <Area label={t("Notes (optional)")} value={d.notes} onChange={(v) => set((p) => ({ ...p, notes: v }))} />
        <Txt label={t("Authorised by (optional)")} value={d.authorisedBy} onChange={(v) => set((p) => ({ ...p, authorisedBy: v }))} />
        <StampToggle on={d.stamp} set={(v) => set((p) => ({ ...p, stamp: v }))} />
      </Card>
    </>
  );
}

function StampToggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  const t = useT();
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      {t("Place the company stamp")}
    </label>
  );
}
