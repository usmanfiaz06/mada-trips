"use client";
import { useActionState, useMemo, useState } from "react";
import { AlertCircle, ArrowLeftRight, Copy, Plane, Plus, Send, Trash2 } from "lucide-react";
import { btn, cx } from "../ui";
import { PendingContext, SubmitButton, useSubmit } from "../client";
import { useT } from "@/lib/i18n/client";

type State = { error?: string; ok?: string } | null;
type Action = (prev: State, fd: FormData) => Promise<State>;

export type QuoteTraveller = { personId: string | null; name: string; type: "adult" | "child" | "infant" };
export type QuoteSeed = { from: string; to: string; depart: string; ret: string | null; cabin: "economy" | "premium" | "business" | "first"; bags: string | null };

type Leg = { direction: "out" | "back"; flightNumber: string; from: string; to: string; date: string; dep: string; arr: string; nextDay: boolean };
type Opt = {
  airline: string; carrier: string; cabin: QuoteSeed["cabin"]; legs: Leg[]; fares: Record<QuoteTraveller["type"], string>; prices: string[];
  baggage: string; changeRule: string; refundRule: string; refundable: boolean; note: string;
};

const CARRIERS: [string, string][] = [["SV", "Saudia"], ["XY", "flynas"], ["F3", "flyadeal"], ["TK", "Turkish Airlines"], ["EK", "Emirates"], ["QR", "Qatar Airways"], ["MS", "EgyptAir"], ["BA", "British Airways"], ["J2", "Azerbaijan Airlines"]];
const BAGS = ["23 kg checked and 7 kg cabin, each", "2 × 23 kg checked, each", "Cabin bag only (7 kg)", "20 kg checked, each"];
const RULES = { change: ["SAR 300 per person", "Free", "Not allowed"], refund: ["Refund minus SAR 400 per person", "Not refundable, taxes back", "Fully refundable"] };

const addDay = (d: string, n: number) => (d ? new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10) : d);
const sarNum = (s: string) => { const v = Number(String(s).replace(/[^\d.]/g, "")); return Number.isFinite(v) ? v : 0; };
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
/** datetime-local for Riyadh (UTC+3 all year), n hours from now. */
const riyadhLocal = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3600_000 + 3 * 3600_000).toISOString().slice(0, 16);

function blankLeg(dir: "out" | "back", seed: QuoteSeed): Leg {
  return dir === "out"
    ? { direction: "out", flightNumber: "", from: seed.from, to: seed.to, date: seed.depart, dep: "", arr: "", nextDay: false }
    : { direction: "back", flightNumber: "", from: seed.to, to: seed.from, date: seed.ret ?? addDay(seed.depart, 7), dep: "", arr: "", nextDay: false };
}

function blankOpt(seed: QuoteSeed, travellers: QuoteTraveller[]): Opt {
  return {
    airline: "", carrier: "", cabin: seed.cabin, legs: [blankLeg("out", seed), ...(seed.ret ? [blankLeg("back", seed)] : [])],
    fares: { adult: "", child: "", infant: "" }, prices: travellers.map(() => ""),
    baggage: seed.bags === "cabin" ? BAGS[2]! : seed.bags === "two" ? BAGS[1]! : BAGS[0]!, changeRule: "", refundRule: "", refundable: true, note: "",
  };
}

/**
 * The quote builder for a flight request: book the fares in Mada's own system, then put them here, up to four.
 * Each fare has its flights (a connection is one more row), a price for each traveller (type a fare per adult,
 * child or infant and it fills everyone in), bags, change and refund rules, and the hold. "Copy this fare" starts
 * the next one from it, so a second airline is a few edits.
 */
export function FlightQuoteBuilder({ action, requestId, travellers, seed }: { action: Action; requestId: string; travellers: QuoteTraveller[]; seed: QuoteSeed }) {
  const t = useT();
  const [state, run, pending] = useActionState(action, null);
  const onSubmit = useSubmit(run);
  const [opts, setOpts] = useState<Opt[]>([blankOpt(seed, travellers)]);
  const [hold, setHold] = useState(riyadhLocal(24));
  const [pnr, setPnr] = useState("");
  const [message, setMessage] = useState("");

  const set = (i: number, patch: Partial<Opt>) => setOpts((o) => o.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setLeg = (i: number, k: number, patch: Partial<Leg>) => setOpts((o) => o.map((x, j) => (j === i ? { ...x, legs: x.legs.map((l, m) => (m === k ? { ...l, ...patch } : l)) } : x)));
  const fill = (i: number, type: QuoteTraveller["type"], v: string) => setOpts((o) => o.map((x, j) => (j !== i ? x : { ...x, fares: { ...x.fares, [type]: v }, prices: x.prices.map((p, m) => (travellers[m]!.type === type ? v : p)) })));
  const types = [...new Set(travellers.map((p) => p.type))];

  const payload = useMemo(() => JSON.stringify({
    holdUntil: hold, pnr, message,
    options: opts.map((o) => ({
      airline: o.airline, carrier: o.carrier, cabin: o.cabin, baggage: o.baggage, changeRule: o.changeRule, refundRule: o.refundRule, refundable: o.refundable, note: o.note || null,
      legs: o.legs.map((l) => ({ direction: l.direction, flightNumber: l.flightNumber, from: l.from, to: l.to, date: l.date, dep: l.dep, arr: l.arr, arrDate: l.nextDay ? addDay(l.date, 1) : null })),
      prices: travellers.map((p, m) => ({ personId: p.personId, name: p.name, type: p.type, sar: o.prices[m] ?? "" })),
    })),
  }), [opts, hold, pnr, message, travellers]);

  return (
    <PendingContext.Provider value={pending}>
      <form onSubmit={onSubmit} className="space-y-4" data-testid="flight-quote-builder">
        <input type="hidden" name="id" value={requestId} />
        <input type="hidden" name="payload" value={payload} />
        {state?.error && <div role="alert" className="flex items-start gap-2 rounded-xl bg-bad-soft px-3.5 py-2.5 text-[13.5px] text-bad"><AlertCircle className="mt-0.5 size-4 shrink-0" />{t(state.error)}</div>}
        {state?.ok && <div role="status" className="rounded-xl bg-ok-soft px-3.5 py-2.5 text-[13.5px] text-ok">{t(state.ok)}</div>}

        {opts.map((o, i) => {
          const total = o.prices.reduce((a, p) => a + sarNum(p), 0);
          return (
            <fieldset key={i} className="space-y-3 rounded-2xl bg-surface-2 p-3.5" data-testid={`fare-${i + 1}`}>
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-lg bg-info-soft text-info"><Plane className="size-3.5" /></span>
                <legend className="text-[14px] font-medium text-ink">{t("Fare {n}", { n: i + 1 })}</legend>
                <span className="ms-auto num text-[15px] text-ink" dir="ltr">SAR {fmt(total)}</span>
                {opts.length > 1 && <button type="button" aria-label={t("Remove this fare")} onClick={() => setOpts((x) => x.filter((_, j) => j !== i))} className="text-ink-3 hover:text-bad"><Trash2 className="size-4" /></button>}
              </div>
              <div className="grid grid-cols-[90px_minmax(0,1fr)_120px] gap-2">
                <input className="field num uppercase" list="carriers" placeholder="SV" maxLength={2} aria-label={t("Airline code")} value={o.carrier} dir="ltr"
                  onChange={(e) => { const c = e.target.value.toUpperCase(); const known = CARRIERS.find(([k]) => k === c)?.[1]; set(i, { carrier: c, ...(known && !o.airline ? { airline: known } : {}), legs: o.legs.map((l) => (!l.flightNumber || /^[A-Z0-9]{2}$/.test(l.flightNumber) ? { ...l, flightNumber: c } : l)) }); }} />
                <input className="field" placeholder={t("Airline")} aria-label={t("Airline")} value={o.airline} onChange={(e) => set(i, { airline: e.target.value })} />
                <select className="field" aria-label={t("Cabin")} value={o.cabin} onChange={(e) => set(i, { cabin: e.target.value as Opt["cabin"] })}>
                  {(["economy", "premium", "business", "first"] as const).map((c) => <option key={c} value={c}>{t(c[0]!.toUpperCase() + c.slice(1))}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <div className="grid grid-cols-[52px_88px_58px_58px_minmax(0,1fr)_68px_68px_34px_24px] gap-1.5 px-0.5 text-[11.5px] text-ink-3">
                  <span /> <span>{t("Flight")}</span><span>{t("From")}</span><span>{t("To")}</span><span>{t("Date")}</span><span>{t("Departs")}</span><span>{t("Lands")}</span><span title={t("Lands the next day")}>+1</span><span />
                </div>
                {o.legs.map((l, k) => (
                  <div key={k} className="grid grid-cols-[52px_88px_58px_58px_minmax(0,1fr)_68px_68px_34px_24px] items-center gap-1.5" data-testid={`leg-${i + 1}-${k + 1}`}>
                    <span className="text-[12px] text-ink-3">{t(l.direction === "out" ? "Out" : "Back")}</span>
                    <input className="field num h-9 px-2 uppercase" dir="ltr" placeholder="SV263" aria-label={t("Flight number")} value={l.flightNumber} onChange={(e) => setLeg(i, k, { flightNumber: e.target.value.toUpperCase() })} />
                    <input className="field num h-9 px-2 uppercase" dir="ltr" maxLength={3} aria-label={t("From")} value={l.from} onChange={(e) => setLeg(i, k, { from: e.target.value.toUpperCase() })} />
                    <input className="field num h-9 px-2 uppercase" dir="ltr" maxLength={3} aria-label={t("To")} value={l.to} onChange={(e) => setLeg(i, k, { to: e.target.value.toUpperCase() })} />
                    <input type="date" className="field num h-9 px-2" dir="ltr" aria-label={t("Date")} value={l.date} onChange={(e) => setLeg(i, k, { date: e.target.value })} />
                    <input type="time" className="field num h-9 px-1.5" dir="ltr" aria-label={t("Departs")} value={l.dep} onChange={(e) => setLeg(i, k, { dep: e.target.value })} />
                    <input type="time" className="field num h-9 px-1.5" dir="ltr" aria-label={t("Lands")} value={l.arr} onChange={(e) => setLeg(i, k, { arr: e.target.value })} />
                    <input type="checkbox" aria-label={t("Lands the next day")} checked={l.nextDay} onChange={(e) => setLeg(i, k, { nextDay: e.target.checked })} className="size-4 justify-self-center accent-[var(--gold)]" />
                    {o.legs.length > 1 ? <button type="button" aria-label={t("Remove this flight")} onClick={() => set(i, { legs: o.legs.filter((_, m) => m !== k) })} className="text-ink-4 hover:text-bad"><Trash2 className="size-3.5" /></button> : <span />}
                  </div>
                ))}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button type="button" className={btn("ghost", "sm")} onClick={() => { const last = o.legs.filter((l) => l.direction === "out").at(-1)!; set(i, { legs: [...o.legs.filter((l) => l.direction === "out"), { ...last, flightNumber: o.carrier, from: last.to, to: seed.to, dep: "", arr: "", nextDay: false }, ...o.legs.filter((l) => l.direction === "back")] }); }}><Plus className="size-3.5" />{t("Connection out")}</button>
                  {o.legs.some((l) => l.direction === "back")
                    ? <button type="button" className={btn("ghost", "sm")} onClick={() => { const last = o.legs.at(-1)!; set(i, { legs: [...o.legs, { ...last, flightNumber: o.carrier, from: last.to, to: seed.from, dep: "", arr: "", nextDay: false }] }); }}><Plus className="size-3.5" />{t("Connection back")}</button>
                    : <button type="button" className={btn("ghost", "sm")} onClick={() => set(i, { legs: [...o.legs, { ...blankLeg("back", seed), flightNumber: o.carrier }] })}><ArrowLeftRight className="size-3.5" />{t("Add the return")}</button>}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                  {types.map((ty) => (
                    <label key={ty} className="inline-flex items-center gap-1.5">{t(ty === "adult" ? "Adult fare" : ty === "child" ? "Child fare" : "Infant fare")}
                      <input className="field num h-8 w-24 px-2" dir="ltr" inputMode="decimal" placeholder="SAR" value={o.fares[ty]} onChange={(e) => fill(i, ty, e.target.value)} />
                    </label>
                  ))}
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {travellers.map((p, m) => (
                    <label key={m} className="flex items-center gap-2 rounded-xl bg-surface px-2.5 py-1.5 text-[13px]">
                      <span className="min-w-0 flex-1 truncate text-ink">{p.name} <span className="text-ink-4">· {t(p.type === "adult" ? "Adult" : p.type === "child" ? "Child" : "Infant")}</span></span>
                      <input className="field num h-8 w-24 px-2" dir="ltr" inputMode="decimal" aria-label={t("Price for {name}", { name: p.name })} value={o.prices[m] ?? ""} onChange={(e) => set(i, { prices: o.prices.map((x, n) => (n === m ? e.target.value : x)) })} />
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <label className="space-y-1 text-[12px] text-ink-3"><span>{t("Bags")}</span><input className="field" list="bags" value={o.baggage} onChange={(e) => set(i, { baggage: e.target.value })} /></label>
                <label className="space-y-1 text-[12px] text-ink-3"><span>{t("Changes")}</span><input className="field" list="change" placeholder="SAR 300 per person" value={o.changeRule} onChange={(e) => set(i, { changeRule: e.target.value })} /></label>
                <label className="space-y-1 text-[12px] text-ink-3"><span>{t("Refund")}</span><input className="field" list="refund" placeholder="Refund minus SAR 400 per person" value={o.refundRule} onChange={(e) => set(i, { refundRule: e.target.value, refundable: !/^not refundable/i.test(e.target.value) })} /></label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={o.refundable} onChange={(e) => set(i, { refundable: e.target.checked })} className="size-4" />{t("Refundable")}</label>
                <input className="field h-9 min-w-0 flex-1" maxLength={200} placeholder={t("A line about this one, for the traveller (optional)")} value={o.note} onChange={(e) => set(i, { note: e.target.value })} />
                {opts.length < 4 && <button type="button" className={btn("outline", "sm")} onClick={() => setOpts((x) => [...x, { ...o, legs: o.legs.map((l) => ({ ...l })), note: "" }])}><Copy className="size-3.5" />{t("Copy this fare")}</button>}
              </div>
            </fieldset>
          );
        })}

        <datalist id="carriers">{CARRIERS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</datalist>
        <datalist id="bags">{BAGS.map((b) => <option key={b} value={b} />)}</datalist>
        <datalist id="change">{RULES.change.map((b) => <option key={b} value={b} />)}</datalist>
        <datalist id="refund">{RULES.refund.map((b) => <option key={b} value={b} />)}</datalist>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
          <label className="space-y-1 text-[12px] text-ink-3">
            <span>{t("Held until (Riyadh time)")}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <input type="datetime-local" className="field num h-9 min-w-0 flex-1" dir="ltr" name="holdLocal" value={hold} onChange={(e) => setHold(e.target.value)} />
              {[2, 6, 24].map((h) => <button key={h} type="button" className={cx(btn("ghost", "sm"), "num")} onClick={() => setHold(riyadhLocal(h))}>{h}h</button>)}
            </div>
          </label>
          <label className="space-y-1 text-[12px] text-ink-3"><span>{t("PNR (optional)")}</span><input className="field num h-9 uppercase" dir="ltr" maxLength={8} placeholder="X7K2QD" value={pnr} onChange={(e) => setPnr(e.target.value.toUpperCase())} /></label>
        </div>
        <textarea className="field" rows={2} maxLength={600} placeholder={t("Your words with the fares (optional). Leave empty for “I found 2 fares and I’m holding them for you.”")} value={message} onChange={(e) => setMessage(e.target.value)} />
        <SubmitButton className="w-full"><Send className="size-4 rtl:-scale-x-100" />{opts.length === 1 ? t("Send this fare") : t("Send {n} fares", { n: opts.length })}</SubmitButton>
      </form>
    </PendingContext.Provider>
  );
}
