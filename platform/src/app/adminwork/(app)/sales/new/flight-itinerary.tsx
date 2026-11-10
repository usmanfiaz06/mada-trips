"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, X, ArrowLeftRight, Plane } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { cx } from "@/components/ui";
import { Picker, type PickerItem } from "@/components/picker";
import { layoverMinutes, fmtDuration, fullRoute, type FlightLeg } from "@/lib/itinerary";

type Props = {
  airports: PickerItem[]; airlines: PickerItem[];
  invalid?: boolean;
  onPrimaryAirline: (airline: string) => void;
};

const blankLeg = (from = "", to = ""): FlightLeg => ({ from, to, airline: "", flightNo: "", dep: "", arr: "" });

/** One editable flight leg: from → to, airline, flight no., departure & arrival times. */
function LegRow({ airports, airlines, leg, n, canRemove, onChange, onRemove, invalid }: {
  airports: PickerItem[]; airlines: PickerItem[]; leg: FlightLeg; n: number; canRemove: boolean;
  onChange: (patch: Partial<FlightLeg>) => void; onRemove: () => void; invalid?: boolean;
}) {
  const t = useT();
  const same = leg.from && leg.to && leg.from === leg.to;
  return (
    <div className="rounded-2xl bg-surface-2 p-3 ring-1 ring-line">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-3"><Plane className="size-3.5" />{t("Leg {n}", { n })}</span>
        {canRemove && <button type="button" onClick={onRemove} className="grid size-6 place-items-center rounded-full text-ink-3 hover:bg-surface hover:text-bad" aria-label={t("Remove leg")}><X className="size-3.5" /></button>}
      </div>
      <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <Picker items={airports} value={leg.from} onChange={(v) => onChange({ from: v })} label={t("From")} placeholder={t("From: city or code")} invalid={invalid && !leg.from} />
        <button type="button" onClick={() => onChange({ from: leg.to, to: leg.from })} className="mx-auto grid size-8 place-items-center rounded-full text-ink-3 ring-1 ring-line transition hover:bg-surface hover:text-ink" aria-label={t("Swap")}><ArrowLeftRight className="size-3.5" /></button>
        <Picker items={airports} value={leg.to} onChange={(v) => onChange({ to: v })} label={t("To")} placeholder={t("To: city or code")} invalid={invalid && !leg.to} />
      </div>
      {same && <p className="mt-1.5 text-[12px] text-bad">{t("From and To can't be the same airport")}</p>}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Picker items={airlines} value={leg.airline} onChange={(v) => onChange({ airline: v })} label={t("Airline")} placeholder={t("Airline name or code")} invalid={invalid && !leg.airline} />
        <input value={leg.flightNo ?? ""} onChange={(e) => onChange({ flightNo: e.target.value.toUpperCase() })} maxLength={10} className="field num uppercase tracking-wide" placeholder={t("Flight no. (e.g. SV553)")} dir="ltr" />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label><span className="mb-1 block text-[11.5px] text-ink-3">{t("Departs")}</span><input type="time" value={leg.dep ?? ""} onChange={(e) => onChange({ dep: e.target.value })} className="field" dir="ltr" /></label>
        <label><span className="mb-1 block text-[11.5px] text-ink-3">{t("Arrives")}</span><input type="time" value={leg.arr ?? ""} onChange={(e) => onChange({ arr: e.target.value })} className="field" dir="ltr" /></label>
      </div>
    </div>
  );
}

/** Editable list of legs for one direction, with "Add stop" and layover readouts between legs. */
function Direction({ airports, airlines, legs, setLegs, invalid, addLabel }: {
  airports: PickerItem[]; airlines: PickerItem[]; legs: FlightLeg[]; setLegs: (f: (p: FlightLeg[]) => FlightLeg[]) => void; invalid?: boolean; addLabel: string;
}) {
  const t = useT();
  const update = (i: number, patch: Partial<FlightLeg>) => setLegs((prev) => prev.map((l, j) => {
    if (j === i) return { ...l, ...patch };
    // Keep the next leg's departure airport in sync with this leg's arrival (a connection).
    if (j === i + 1 && patch.to !== undefined) return { ...l, from: patch.to };
    return l;
  }));
  const addStop = () => setLegs((prev) => [...prev, blankLeg(prev[prev.length - 1]?.to ?? "")]);
  const remove = (i: number) => setLegs((prev) => prev.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      {legs.map((leg, i) => (
        <div key={i}>
          <LegRow airports={airports} airlines={airlines} leg={leg} n={i + 1} canRemove={legs.length > 1} invalid={invalid}
            onChange={(patch) => update(i, patch)} onRemove={() => remove(i)} />
          {i < legs.length - 1 && (() => {
            const mins = layoverMinutes(leg.arr, legs[i + 1].dep);
            return (
              <div className="flex items-center gap-2 py-1.5 ps-3 text-[12px] text-ink-3">
                <span className="h-4 w-px bg-line" />
                {t("Layover in {a}", { a: leg.to || "—" })}: {mins != null ? <span className="font-medium text-ink-2">{fmtDuration(mins)}</span> : <span className="text-ink-4">{t("enter times")}</span>}
              </div>
            );
          })()}
        </div>
      ))}
      <button type="button" onClick={addStop} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3.5 py-1.5 text-[12.5px] text-ink-2 ring-1 ring-line transition hover:text-ink"><Plus className="size-3.5" />{addLabel}</button>
    </div>
  );
}

export function FlightItinerary({ airports, airlines, invalid, onPrimaryAirline }: Props) {
  const t = useT();
  const [trip, setTrip] = useState<"oneway" | "return">("oneway");
  const [outbound, setOutbound] = useState<FlightLeg[]>([blankLeg("RUH", "")]);
  const [ret, setRet] = useState<FlightLeg[]>([]);

  // When switching to a return trip, seed one return leg going back the other way (editable — can differ).
  const switchTrip = (k: "oneway" | "return") => {
    setTrip(k);
    if (k === "return" && ret.length === 0) {
      const lastTo = outbound[outbound.length - 1]?.to ?? "";
      const firstFrom = outbound[0]?.from ?? "RUH";
      setRet([blankLeg(lastTo, firstFrom)]);
    }
  };

  const itinerary = useMemo(() => ({ outbound, ...(trip === "return" ? { return: ret } : {}) }), [outbound, ret, trip]);
  const primaryAirline = outbound[0]?.airline ?? "";
  useEffect(() => { onPrimaryAirline(primaryAirline); }, [primaryAirline, onPrimaryAirline]);

  return (
    <div className="sm:col-span-6">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12.5px] text-ink-3">{t("Route")} <span className="text-gold-2">*</span></span>
        <div className="flex rounded-full bg-sunken p-0.5 text-[12px]">
          {(["oneway", "return"] as const).map((k) => (
            <button key={k} type="button" onClick={() => switchTrip(k)} className={cx("h-7 rounded-full px-3 transition", trip === k ? "bg-ink text-bg" : "text-ink-3 hover:text-ink")}>{k === "return" ? t("Return") : t("One way")}</button>
          ))}
        </div>
      </div>

      <Direction airports={airports} airlines={airlines} legs={outbound} setLegs={setOutbound} invalid={invalid} addLabel={t("Add stop")} />

      {trip === "return" && (
        <div className="mt-4">
          <div className="mb-2 text-[12.5px] font-medium text-ink-2">{t("Return")}</div>
          <Direction airports={airports} airlines={airlines} legs={ret} setLegs={setRet} invalid={invalid} addLabel={t("Add return stop")} />
        </div>
      )}

      <input type="hidden" name="trip" value={trip} />
      <input type="hidden" name="description" value={fullRoute(itinerary)} />
      <input type="hidden" name="supplier" value={primaryAirline} />
      <input type="hidden" name="itinerary" value={JSON.stringify(itinerary)} />
    </div>
  );
}
