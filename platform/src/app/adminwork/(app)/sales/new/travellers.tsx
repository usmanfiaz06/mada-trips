"use client";
import { useEffect, useState } from "react";
import { Minus, Plus, TriangleAlert, Users } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { cx } from "@/components/ui";
import { ALL_NAMES, COUNT_LABEL, NATIONALITIES, PASSPORT_RULE, expiresSoon, type Traveller } from "@/lib/services";

const MAX = 30;
const blank = (): Traveller => ({ name: "", passport: "", nationality: "", expiry: "", dob: "" });

/**
 * How many (visas, tickets, guests) and who. The number drives the rows: set 4 visas and four passport rows appear.
 * Sends one JSON field; the server checks every row again.
 */
export function Travellers({ service, invalid, onNames }: { service: string; invalid?: boolean; onNames: (names: string[], count: number) => void }) {
  const t = useT();
  const [rows, setRows] = useState<Traveller[]>([blank()]);
  const [withPassport, setWithPassport] = useState(false);
  const rule = PASSPORT_RULE[service] ?? "none";
  const showPassport = rule === "required" || (rule === "optional" && withPassport);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => { onNames(rows.map((r) => r.name.trim()).filter(Boolean), rows.length); }, [rows, onNames]);

  const setCount = (n: number) => setRows((r) => { const c = Math.max(1, Math.min(MAX, Math.round(n) || 1)); return c > r.length ? [...r, ...Array.from({ length: c - r.length }, blank)] : r.slice(0, c); });
  const set = (i: number, k: keyof Traveller, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const sameForAll = (k: keyof Traveller) => setRows((r) => r.map((x) => ({ ...x, [k]: r[0][k] })));
  const needName = (i: number) => i === 0 || ALL_NAMES.has(service);
  const payload = rows.map((r) => (showPassport ? r : { name: r.name }));

  return (
    <div className="sm:col-span-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[12.5px] text-ink-3">{t(COUNT_LABEL[service] ?? "Travellers")} <span className="text-gold-2">*</span></span>
          <div className="flex items-center rounded-full bg-surface-2 p-1 ring-1 ring-line">
            <button type="button" onClick={() => setCount(rows.length - 1)} disabled={rows.length <= 1} className="grid size-8 place-items-center rounded-full text-ink-2 transition hover:bg-sunken disabled:opacity-30" aria-label={t("One fewer")}><Minus className="size-3.5" /></button>
            <input type="number" min={1} max={MAX} value={rows.length} onChange={(e) => setCount(Number(e.target.value))} className="num w-10 bg-transparent text-center text-[15px] outline-none" aria-label={t(COUNT_LABEL[service] ?? "Travellers")} />
            <button type="button" onClick={() => setCount(rows.length + 1)} disabled={rows.length >= MAX} className="grid size-8 place-items-center rounded-full text-ink-2 transition hover:bg-sunken disabled:opacity-30" aria-label={t("One more")}><Plus className="size-3.5" /></button>
          </div>
        </div>
        {rule === "optional" && (
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={withPassport} onChange={(e) => setWithPassport(e.target.checked)} className="size-4 accent-[var(--gold)]" />{t("Add passport details")}
          </label>
        )}
      </div>

      <ol className="space-y-2">
        {rows.map((r, i) => {
          const soon = showPassport && r.expiry && r.expiry > today && expiresSoon(r.expiry, today);
          const expired = showPassport && r.expiry && r.expiry <= today;
          return (
            <li key={i} className={cx("rounded-2xl bg-surface-2 p-3 ring-1 ring-line", invalid && needName(i) && !r.name.trim() && "ring-bad")}>
              <div className={cx("grid gap-2", showPassport ? "sm:grid-cols-[28px_minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.1fr)]" : "sm:grid-cols-[28px_minmax(0,1fr)]")}>
                <span className="num grid size-7 place-items-center self-center rounded-full bg-sunken text-[12px] text-ink-3">{i + 1}</span>
                <input value={r.name} onChange={(e) => set(i, "name", e.target.value)} maxLength={80} autoComplete="off"
                  placeholder={needName(i) ? t("Full name, as on passport") : t("Name (optional)")} aria-label={t("Traveller {n} name", { n: i + 1 })} className="field h-10" />
                {showPassport && (
                  <>
                    <input value={r.passport} onChange={(e) => set(i, "passport", e.target.value.toUpperCase())} maxLength={15} autoComplete="off" dir="ltr"
                      placeholder={t("Passport no.")} aria-label={t("Traveller {n} passport number", { n: i + 1 })} className="field num h-10 uppercase tracking-wider" />
                    <div className="relative">
                      <select value={r.nationality} onChange={(e) => set(i, "nationality", e.target.value)} aria-label={t("Traveller {n} nationality", { n: i + 1 })} className="field h-10">
                        <option value="">{t("Nationality")}</option>
                        {NATIONALITIES.map((n) => <option key={n.code} value={n.code}>{t.locale === "ar" ? n.ar : n.en}</option>)}
                      </select>
                    </div>
                    <label className="relative"><span className="pointer-events-none absolute -top-2 start-3 bg-surface-2 px-1 text-[10.5px] text-ink-3">{t("Expiry")}</span>
                      <input type="date" value={r.expiry} min={today} onChange={(e) => set(i, "expiry", e.target.value)} aria-label={t("Traveller {n} passport expiry", { n: i + 1 })} className={cx("field h-10", (soon || expired) && "ring-1 ring-warn")} /></label>
                    <label className="relative"><span className="pointer-events-none absolute -top-2 start-3 bg-surface-2 px-1 text-[10.5px] text-ink-3">{t("Date of birth")}</span>
                      <input type="date" value={r.dob} max={today} onChange={(e) => set(i, "dob", e.target.value)} aria-label={t("Traveller {n} date of birth", { n: i + 1 })} className="field h-10" /></label>
                  </>
                )}
              </div>
              {(soon || expired) && (
                <p className="mt-2 flex items-center gap-1.5 ps-9 text-[12px] text-warn"><TriangleAlert className="size-3.5" />{expired ? t("This passport has expired") : t("Expires within 6 months. Many countries refuse these.")}</p>
              )}
            </li>
          );
        })}
      </ol>

      {showPassport && rows.length > 1 && rows[0].nationality && rows.some((r) => r.nationality !== rows[0].nationality) && (
        <button type="button" onClick={() => sameForAll("nationality")} className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 underline decoration-line-strong underline-offset-4 hover:text-ink">
          <Users className="size-3.5" />{t("Same nationality for everyone")}
        </button>
      )}

      <input type="hidden" name="travellers" value={JSON.stringify(payload)} />
      <input type="hidden" name="paxCount" value={rows.length} />
      <input type="hidden" name="passengers" value={rows.map((r) => r.name.trim()).filter(Boolean).join(", ")} />
    </div>
  );
}
