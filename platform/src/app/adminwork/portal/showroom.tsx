"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Home, MapPin, Minus, PackageCheck, Plus } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { ActionForm, SubmitButton } from "@/components/client";
import { cx } from "@/components/ui";
import { submitPlan } from "./actions";

export type ShowroomCar = {
  id: string; key: string; make: string; model: string; trim: string | null; category: string; year: number;
  engine: string | null; drive: string | null; fuel: string | null; seats: number | null; image: string | null;
  onRequest: boolean; prices: Record<number, number | null>;
};

const sar = (h: number) => Math.round(h / 100).toLocaleString("en-US");

/** Counts smoothly from the last value to the new one, so changing the term feels like the price moving. */
function useRolling(target: number) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now(), a = from.current, b = target;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 550), e = 1 - Math.pow(1 - k, 3);
      setShown(a + (b - a) * e);
      if (k < 1) raf = requestAnimationFrame(step); else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = b; };
  }, [target]);
  return shown;
}

const PLACES = [
  { k: "office", label: "Office", sub: "Your company", Icon: Building2 },
  { k: "home", label: "Home", sub: "Driver's address", Icon: Home },
  { k: "site", label: "Project site", sub: "Pin or address", Icon: MapPin },
  { k: "collect", label: "Collect", sub: "Mada branch", Icon: PackageCheck },
] as const;

export function Showroom({ cars, terms, base, canSend, sendLabel, defaultContact }: {
  cars: ShowroomCar[]; terms: number[]; base: string; canSend: boolean; sendLabel: string; defaultContact: string;
}) {
  const t = useT();
  const priced = cars.filter((c) => !c.onRequest);
  const onRequest = cars.filter((c) => c.onRequest);
  const [sel, setSel] = useState(priced[0]?.id ?? "");
  const [term, setTerm] = useState(terms.includes(36) ? 36 : terms[0]);
  const [qty, setQty] = useState(1);
  const [plan, setPlan] = useState<Record<string, number>>({});
  const [enter, setEnter] = useState(false);
  const [delivery, setDelivery] = useState({ place: "office", address: "", city: "Riyadh", contact: defaultContact, window: "morning" });
  const [note, setNote] = useState("");
  const car = priced.find((c) => c.id === sel) ?? priced[0];
  const unit = car?.prices[term] ?? 0;
  const rolled = useRolling(unit);
  const first = terms[0];
  const saving = car && car.prices[first] ? Math.round((1 - unit / (car.prices[first] as number)) * 100) : 0;
  const lines = useMemo(() => priced.filter((c) => plan[c.id]).map((c) => ({ car: c, q: plan[c.id], m: (c.prices[term] ?? 0) * plan[c.id] })), [priced, plan, term]);
  const monthly = lines.reduce((a, l) => a + l.m, 0);
  const rolledPlan = useRolling(monthly);

  if (!car) return null;
  const pick = (id: string) => { if (id === sel) return; setSel(id); setQty(plan[id] ?? 1); setEnter(true); setTimeout(() => setEnter(false), 40); };
  const payload = JSON.stringify({ term, lines: lines.map((l) => ({ vehicleId: l.car.id, qty: l.q })), delivery, note: note || undefined });

  return (
    <div className="space-y-4">
      {/* Stage */}
      <section className="relative overflow-hidden rounded-[28px] bg-surface-2 shadow-card">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_55%_at_55%_62%,var(--surface),transparent_70%)]" />
        <div aria-hidden className={cx("pointer-events-none absolute inset-x-0 top-[88px] select-none overflow-hidden whitespace-nowrap text-center text-[180px] font-bold leading-none tracking-[-0.05em] text-line transition-opacity duration-500", enter ? "opacity-0" : "opacity-100")}>{car.model.split(" ").pop()?.toUpperCase()}</div>
        <div className="relative flex flex-wrap justify-between gap-6 p-7 pb-0">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 font-medium"><span className="size-1.5 rounded-full bg-ok" />{t("Available")}</span>
              <span className="rounded-full bg-surface/60 px-2.5 py-1 text-ink-3">{car.category} · {car.year}</span>
            </div>
            <h2 className="mt-3 text-[46px] font-[450] leading-none tracking-[-0.04em]">{car.make} {car.model}</h2>
            <p className="mt-2 text-[14.5px] text-ink-3">{[car.trim, car.engine, car.drive, car.fuel].filter(Boolean).join(" · ")}</p>
          </div>
          <ul className="hidden gap-2 self-start md:flex">
            {[[t("Engine"), car.engine], [t("Drive"), car.drive], [t("Seats"), car.seats], [t("Gearbox"), t("Auto")]].filter(([, v]) => v).map(([k, v]) => (
              <li key={String(k)} className="min-w-[66px] rounded-2xl bg-surface/80 px-3.5 py-2"><div className="text-[11px] text-ink-3">{k}</div><div className="text-[14px] font-medium">{v}</div></li>
            ))}
          </ul>
        </div>
        <div className="relative grid min-h-[280px] place-items-center px-6">
          <div aria-hidden className="absolute inset-x-[18%] bottom-7 h-7 rounded-[50%] bg-[radial-gradient(closest-side,rgba(15,26,22,.3),transparent)]" />
          {car.image
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={`${base}${car.image}`} alt={`${car.make} ${car.model}`} className={cx("relative max-h-[320px] w-[min(78%,760px)] object-contain", enter ? "translate-x-14 scale-[.97] opacity-0" : "translate-x-0 opacity-100 transition-[opacity,transform] duration-700 ease-[cubic-bezier(.22,1,.36,1)]")} />
            : <div className="relative text-ink-3">{t("Photo coming soon")}</div>}
        </div>
        <div className="relative flex flex-wrap items-end justify-between gap-4 px-7 pb-6">
          <div role="group" aria-label={t("Lease term")} className="flex rounded-full bg-surface p-1 shadow-card">
            {terms.map((tm) => (
              <button key={tm} type="button" aria-pressed={tm === term} onClick={() => setTerm(tm)}
                className={cx("h-10 rounded-full px-4 text-[13.5px] transition", tm === term ? "bg-ink text-bg" : "text-ink-2 hover:text-ink")}>{tm} {t("months")}</button>
            ))}
          </div>
          <div className="text-end">
            <div className="flex items-baseline justify-end gap-1.5" dir="ltr"><span className="text-[13px] text-ink-3">SAR</span><span className="figure text-[44px]">{sar(rolled)}</span><span className="text-[13px] text-ink-3">/ {t("month")}</span></div>
            <div className={cx("text-[12.5px] font-medium", saving > 0 ? "text-ok" : "text-ink-3")}>{saving > 0 ? t("{p}% less than {m} months", { p: saving, m: first }) : t("Per car, before VAT")}</div>
          </div>
        </div>
      </section>

      {/* Strip */}
      <div role="listbox" aria-label={t("Vehicles")} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {priced.map((c) => (
          <button key={c.id} type="button" role="option" aria-selected={c.id === sel} onClick={() => pick(c.id)}
            className={cx("flex flex-col gap-0.5 rounded-[18px] p-3 text-start transition hover:-translate-y-0.5", c.id === sel ? "bg-ink text-bg" : "bg-surface shadow-card")}>
            <span className="grid h-14 place-items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.image && <img src={`${base}${c.image}`} alt="" className="max-h-[52px] max-w-full object-contain" />}
            </span>
            <span className="truncate text-[13px] font-medium">{c.model}{plan[c.id] ? ` · ${plan[c.id]}` : ""}</span>
            <span className="num text-[12px] opacity-70" dir="ltr">SAR {sar(c.prices[term] ?? 0)}</span>
          </button>
        ))}
      </div>
      {onRequest.length > 0 && <p className="text-[12.5px] text-ink-3">{t("Also available, priced on request: {list}. Ask the Mada desk.", { list: onRequest.map((c) => `${c.make} ${c.model}`).join(", ") })}</p>}

      {/* Configure */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-card bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between"><h3 className="text-[15px] font-medium">{t("How many {model}", { model: car.model })}</h3></div>
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-sunken p-1.5">
            <button type="button" aria-label={t("One less")} onClick={() => setQty(Math.max(1, qty - 1))} className="grid size-10 place-items-center rounded-xl bg-surface"><Minus className="size-4" /></button>
            <span className="num flex-1 text-center text-[22px] font-medium" aria-live="polite">{qty}</span>
            <button type="button" aria-label={t("One more")} onClick={() => setQty(Math.min(200, qty + 1))} className="grid size-10 place-items-center rounded-xl bg-surface"><Plus className="size-4" /></button>
          </div>
          <dl className="mt-4 space-y-1.5 text-[13px]">
            <div className="flex justify-between"><dt className="text-ink-3">{t("Monthly")}</dt><dd className="num font-medium" dir="ltr">SAR {sar(unit * qty)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-3">{t("{n}-month total", { n: term })}</dt><dd className="num font-medium" dir="ltr">SAR {sar(unit * qty * term)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-3">{t("Deposit (2 months)")}</dt><dd className="num" dir="ltr">SAR {sar(unit * qty * 2)}</dd></div>
          </dl>
          <button type="button" onClick={() => setPlan({ ...plan, [car.id]: qty })}
            className="mt-4 h-11 w-full rounded-full bg-ink text-[14px] font-medium text-bg transition hover:opacity-85">
            {plan[car.id] === qty ? t("In your plan") : plan[car.id] ? t("Update plan") : t("Add to plan")}
          </button>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">{t("Includes insurance, maintenance, a yearly tyre change, recovery and a replacement car. Prices exclude 15% VAT.")}</p>
        </section>

        <section className="rounded-card bg-surface p-5 shadow-card">
          <h3 className="text-[15px] font-medium">{t("Delivery")}</h3>
          <div role="radiogroup" aria-label={t("Deliver to")} className="mt-3 grid grid-cols-2 gap-2">
            {PLACES.map(({ k, label, sub, Icon }) => (
              <button key={k} type="button" role="radio" aria-checked={delivery.place === k} onClick={() => setDelivery({ ...delivery, place: k })}
                className={cx("flex flex-col items-start gap-1.5 rounded-2xl p-3 text-start transition", delivery.place === k ? "bg-ink text-bg" : "bg-sunken hover:bg-line")}>
                <Icon className="size-4" /><span className="text-[13px] font-medium">{t(label)}</span><span className="text-[11px] opacity-70">{t(sub)}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {delivery.place !== "collect" && <input className="field" aria-label={t("Address")} placeholder={t("Address")} value={delivery.address} onChange={(e) => setDelivery({ ...delivery, address: e.target.value })} />}
            <div className="grid grid-cols-2 gap-2">
              <select className="field" aria-label={t("City")} value={delivery.city} onChange={(e) => setDelivery({ ...delivery, city: e.target.value })}>
                {["Riyadh", "Jeddah", "Dammam", "Baha", "Other city"].map((c) => <option key={c} value={c}>{t(c)}</option>)}
              </select>
              <select className="field" aria-label={t("Handover time")} value={delivery.window} onChange={(e) => setDelivery({ ...delivery, window: e.target.value })}>
                <option value="morning">{t("Morning")}</option><option value="evening">{t("Evening")}</option>
              </select>
            </div>
            <input className="field" aria-label={t("Handover contact")} placeholder={t("Handover contact")} value={delivery.contact} onChange={(e) => setDelivery({ ...delivery, contact: e.target.value })} />
          </div>
          <p className="mt-3 text-[12px] text-ink-3">{t("Usually 90–120 days after the order is confirmed. Registered and insured before it arrives.")}</p>
        </section>

        <section className="night flex flex-col rounded-card p-5">
          <div className="flex items-center justify-between"><h3 className="text-[15px] font-medium text-tile-ink">{t("Your plan")}</h3><span className="text-[12px] text-tile-ink-3">{lines.reduce((a, l) => a + l.q, 0)} {t("cars")} · {term} {t("months")}</span></div>
          <ul className="mt-3 flex-1 space-y-1.5 text-[13px] text-tile-ink">
            {lines.length === 0 && <li className="text-tile-ink-3">{t("Pick a car, set the number and add it.")}</li>}
            {lines.map((l) => (
              <li key={l.car.id} className="flex items-center justify-between gap-2">
                <span>{l.car.model} × {l.q}</span>
                <span className="flex items-center gap-2"><span className="num text-tile-ink-3" dir="ltr">{sar(l.m)}</span>
                  <button type="button" aria-label={t("Remove")} onClick={() => { const p = { ...plan }; delete p[l.car.id]; setPlan(p); }} className="text-tile-ink-3 hover:text-tile-ink">×</button></span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-baseline justify-between border-t border-tile-line pt-3">
            <span className="text-[13px] text-tile-ink-3">{t("Monthly")}</span>
            <span className="figure text-[30px] text-glow-gold" dir="ltr">SAR {sar(rolledPlan)}</span>
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t("Anything Mada should know (optional)")}
            className="mt-3 w-full rounded-xl border border-tile-line bg-transparent px-3 py-2 text-[13px] text-tile-ink placeholder:text-tile-ink-3" />
          {canSend ? (
            <ActionForm action={submitPlan} className="mt-3">
              <input type="hidden" name="plan" value={payload} />
              <SubmitButton variant="gold" className="w-full">{sendLabel}</SubmitButton>
            </ActionForm>
          ) : <p className="mt-3 text-[12.5px] text-tile-ink-3">{t("Viewers can't send plans. Ask your admin.")}</p>}
        </section>
      </div>
    </div>
  );
}
