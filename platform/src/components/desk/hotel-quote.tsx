"use client";
import { useActionState, useMemo, useState } from "react";
import { AlertCircle, BedDouble, Copy, Send, Trash2 } from "lucide-react";
import { btn, cx } from "../ui";
import { PendingContext, SubmitButton, useSubmit } from "../client";
import { useT } from "@/lib/i18n/client";
import { BOARDS, BOARD_LABEL, HAND_SUPPLIERS, HAND_SUPPLIER_LABEL, handStayPrice, type HandSupplier } from "@/lib/app/desk/hotel-quote-math";
import type { PricingRules } from "@/lib/app/suppliers/hotelbeds/money";

type State = { error?: string; ok?: string } | null;
type Action = (prev: State, fd: FormData) => Promise<State>;

export type HotelSeed = { city: string; checkIn: string; checkOut: string; guests: number };

type Opt = {
  hotel: string; city: string; room: string; board: (typeof BOARDS)[number]; checkIn: string; checkOut: string; guests: string;
  supplier: HandSupplier | ""; net: string; currency: string; refundable: boolean; until: string; note: string; supplierRef: string;
  sell: string; reason: string;
};

const CURRENCIES = ["SAR", "USD", "EUR", "GBP", "AED", "TRY", "EGP", "AZN", "GEL"];
const ROOMS = ["Double room", "Twin room", "Deluxe room", "Family room", "Junior suite", "Suite"];

const num = (s: string) => { const v = Number(String(s).replace(/[^\d.]/g, "")); return Number.isFinite(v) ? v : 0; };
const sar = (h: number) => `SAR ${(h / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const nightsOf = (a: string, b: string) => { const n = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000); return Number.isFinite(n) && n > 0 ? n : 0; };
const dayBefore = (d: string) => (d ? new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : "");

function blank(seed: HotelSeed): Opt {
  return {
    hotel: "", city: seed.city, room: "", board: "BB", checkIn: seed.checkIn, checkOut: seed.checkOut, guests: String(seed.guests || 1),
    supplier: "", net: "", currency: "EUR", refundable: true, until: seed.checkIn ? `${dayBefore(seed.checkIn)}T18:00` : "", note: "", supplierRef: "", sell: "", reason: "",
  };
}

/**
 * "Add hotel quote" on a stay request (desk/hotel-quotes.ts): the agent found the room by hand on a portal or with the
 * hotel, and enters exactly what a quote needs, up to three hotels. The price is worked out with the instant-stay rules
 * as they type (net → cost → sell → margin); another price needs a reason. The supplier, the net and its reference
 * never go to the traveller.
 */
export function HotelQuoteBuilder({ action, requestId, seed, rules }: { action: Action; requestId: string; seed: HotelSeed; rules: PricingRules }) {
  const t = useT();
  const [state, run, pending] = useActionState(action, null);
  const onSubmit = useSubmit(run);
  const [opts, setOpts] = useState<Opt[]>([blank(seed)]);
  const [message, setMessage] = useState("");
  const set = (i: number, patch: Partial<Opt>) => setOpts((o) => o.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const payload = useMemo(() => JSON.stringify({
    message: message || null,
    options: opts.map((o) => ({
      hotel: o.hotel, city: o.city, room: o.room, board: o.board, checkIn: o.checkIn, checkOut: o.checkOut, guests: o.guests, supplier: o.supplier,
      net: o.net, currency: o.currency, freeCancelUntil: o.refundable ? o.until : null, note: o.note || null, supplierRef: o.supplierRef || null,
      sellSar: o.sell || null, overrideReason: o.reason || null,
    })),
  }), [opts, message]);

  return (
    <PendingContext.Provider value={pending}>
      <form onSubmit={onSubmit} className="space-y-4" data-testid="hotel-quote-builder">
        <input type="hidden" name="id" value={requestId} />
        <input type="hidden" name="payload" value={payload} />
        {state?.error && <div role="alert" className="flex items-start gap-2 rounded-xl bg-bad-soft px-3.5 py-2.5 text-[13.5px] text-bad"><AlertCircle className="mt-0.5 size-4 shrink-0" />{t(state.error)}</div>}
        {state?.ok && <div role="status" className="rounded-xl bg-ok-soft px-3.5 py-2.5 text-[13.5px] text-ok">{t(state.ok)}</div>}

        {opts.map((o, i) => {
          const nights = nightsOf(o.checkIn, o.checkOut);
          let price: ReturnType<typeof handStayPrice> | null = null;
          try { price = num(o.net) > 0 ? handStayPrice(num(o.net), o.currency, rules) : null; } catch { price = null; }
          const sell = o.sell ? Math.round(num(o.sell) * 100) : price?.sell ?? 0;
          const overridden = !!o.sell && !!price && sell !== price.sell;
          const margin = price ? sell - price.cost : 0;
          return (
            <fieldset key={i} className="space-y-3 rounded-2xl bg-surface-2 p-3.5" data-testid={`hotel-${i + 1}`}>
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-lg bg-info-soft text-info"><BedDouble className="size-3.5" /></span>
                <legend className="text-[14px] font-medium text-ink">{t("Hotel {n}", { n: i + 1 })}</legend>
                <span className="ms-auto text-[12.5px] text-ink-3">{nights ? t(nights === 1 ? "1 night" : "{n} nights", { n: nights }) : null}</span>
                {opts.length > 1 && <button type="button" aria-label={t("Remove this hotel")} onClick={() => setOpts((x) => x.filter((_, j) => j !== i))} className="text-ink-3 hover:text-bad"><Trash2 className="size-4" /></button>}
              </div>

              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
                <label className="space-y-1 text-[12px] text-ink-3"><span>{t("Hotel name")}</span><input className="field" required maxLength={120} value={o.hotel} onChange={(e) => set(i, { hotel: e.target.value })} /></label>
                <label className="space-y-1 text-[12px] text-ink-3"><span>{t("City")}</span><input className="field" required maxLength={80} value={o.city} onChange={(e) => set(i, { city: e.target.value })} /></label>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_170px]">
                <label className="space-y-1 text-[12px] text-ink-3"><span>{t("Room type")}</span><input className="field" required list="hq-rooms" maxLength={120} value={o.room} onChange={(e) => set(i, { room: e.target.value })} /></label>
                <label className="space-y-1 text-[12px] text-ink-3"><span>{t("Board")}</span>
                  <select className="field" value={o.board} onChange={(e) => set(i, { board: e.target.value as Opt["board"] })}>
                    {BOARDS.map((b) => <option key={b} value={b}>{t(BOARD_LABEL[b])}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_90px] gap-2">
                <label className="space-y-1 text-[12px] text-ink-3"><span>{t("Check-in")}</span><input type="date" className="field num" dir="ltr" required value={o.checkIn} onChange={(e) => set(i, { checkIn: e.target.value })} /></label>
                <label className="space-y-1 text-[12px] text-ink-3"><span>{t("Check-out")}</span><input type="date" className="field num" dir="ltr" required value={o.checkOut} onChange={(e) => set(i, { checkOut: e.target.value })} /></label>
                <label className="space-y-1 text-[12px] text-ink-3"><span>{t("Guests")}</span><input className="field num" dir="ltr" inputMode="numeric" required value={o.guests} onChange={(e) => set(i, { guests: e.target.value.replace(/\D/g, "") })} /></label>
              </div>

              <div className="space-y-2 rounded-xl border border-dashed border-line-strong p-2.5">
                <p className="text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-3">{t("Internal: never shown to the traveller")}</p>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_90px]">
                  <label className="space-y-1 text-[12px] text-ink-3"><span>{t("Found on")}</span>
                    <select className="field" required value={o.supplier} onChange={(e) => set(i, { supplier: e.target.value as HandSupplier })}>
                      <option value="" disabled>{t("Choose")}</option>
                      {HAND_SUPPLIERS.map((s) => <option key={s} value={s}>{t(HAND_SUPPLIER_LABEL[s])}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1 text-[12px] text-ink-3"><span>{t("Net cost")}</span><input className="field num" dir="ltr" inputMode="decimal" required value={o.net} onChange={(e) => set(i, { net: e.target.value })} /></label>
                  <label className="space-y-1 text-[12px] text-ink-3"><span>{t("Currency")}</span>
                    <select className="field num" dir="ltr" value={o.currency} onChange={(e) => set(i, { currency: e.target.value })}>
                      {CURRENCIES.filter((c) => rules.rates[c]).map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block space-y-1 text-[12px] text-ink-3"><span>{t("Supplier reference (optional)")}</span><input className="field num" dir="ltr" maxLength={60} value={o.supplierRef} onChange={(e) => set(i, { supplierRef: e.target.value })} /></label>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface px-2.5 py-2 text-[13px]" data-testid={`hotel-${i + 1}-price`}>
                  <span className="text-ink-3">{t("Net")}</span><span className="num" dir="ltr">{price ? sar(price.cost) : "—"}</span>
                  <span className="text-ink-4">→</span>
                  <span className="text-ink-3">{t("Sell")}</span><span className="num font-medium text-ink" dir="ltr">{price ? sar(sell) : "—"}</span>
                  <span className="text-ink-4">·</span>
                  <span className="text-ink-3">{t("Margin")}</span>
                  <span className={cx("num", margin < 0 ? "text-bad" : "text-ok")} dir="ltr">{price ? `${sar(margin)}${sell ? ` (${Math.round((margin / sell) * 1000) / 10}%)` : ""}` : "—"}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)]">
                  <label className="space-y-1 text-[12px] text-ink-3"><span>{t("Another price (SAR)")}</span><input className="field num" dir="ltr" inputMode="decimal" placeholder={price ? String(price.sell / 100) : ""} value={o.sell} onChange={(e) => set(i, { sell: e.target.value })} /></label>
                  <label className="space-y-1 text-[12px] text-ink-3"><span>{t("Why (needed for another price)")}</span><input className={cx("field", overridden && !o.reason.trim() && "ring-2 ring-warn/50")} maxLength={200} required={overridden} value={o.reason} onChange={(e) => set(i, { reason: e.target.value })} /></label>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
                  <label className="inline-flex items-center gap-2"><input type="radio" name={`refund-${i}`} checked={o.refundable} onChange={() => set(i, { refundable: true })} />{t("Free cancellation until")}</label>
                  <input type="datetime-local" className="field num h-9 w-auto" dir="ltr" disabled={!o.refundable} aria-label={t("Free cancellation until, hotel time")} value={o.until} onChange={(e) => set(i, { until: e.target.value })} />
                  <span className="text-[12px] text-ink-3">{t("hotel time")}</span>
                  <label className="inline-flex items-center gap-2"><input type="radio" name={`refund-${i}`} checked={!o.refundable} onChange={() => set(i, { refundable: false })} />{t("Non-refundable")}</label>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <input className="field h-9 min-w-0 flex-1" maxLength={300} placeholder={t("A line for the traveller (optional)")} value={o.note} onChange={(e) => set(i, { note: e.target.value })} />
                {opts.length < 3 && <button type="button" className={btn("outline", "sm")} onClick={() => setOpts((x) => [...x, { ...o, hotel: "", room: "", net: "", supplierRef: "", sell: "", reason: "", note: "" }])}><Copy className="size-3.5" />{t("Add another hotel")}</button>}
              </div>
            </fieldset>
          );
        })}

        <datalist id="hq-rooms">{ROOMS.map((r) => <option key={r} value={r} />)}</datalist>
        <textarea className="field" rows={2} maxLength={600} placeholder={t("Your words with the hotels (optional). Leave empty for “Faisal at Mada found your room. Book it when you’re ready.”")} value={message} onChange={(e) => setMessage(e.target.value)} />
        <p className="text-[12px] text-ink-3">{t("The traveller gets it in their Ask chat with a notification, and can book it there for 24 hours.")}</p>
        <SubmitButton className="w-full"><Send className="size-4 rtl:-scale-x-100" />{t("Send to the traveller")}</SubmitButton>
      </form>
    </PendingContext.Provider>
  );
}
