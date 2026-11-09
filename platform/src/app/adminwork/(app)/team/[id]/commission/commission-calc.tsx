"use client";
import { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { SERVICE } from "@/lib/labels";
import { fmtDate } from "@/lib/dates";
import { Card, CardHead, cx } from "@/components/ui";

type Row = { id: string; ref: string; date: string; serviceType: string; client: string; revenue: number; cost: number; margin: number };
type Props = { memberName: string; isPartner: boolean; byName: string; defaultRate: number; from: string; to: string; rows: Row[]; basePath: string };

const show = (h: number) => (h / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CommissionCalc({ memberName, isPartner, byName, defaultRate, from, to, rows, basePath }: Props) {
  const t = useT();
  const L = t.locale;
  const [basis, setBasis] = useState<"revenue" | "profit">("profit");
  const [pct, setPct] = useState(String(defaultRate || 5));

  const totals = useMemo(() => rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, cost: a.cost + r.cost, margin: a.margin + r.margin }), { revenue: 0, cost: 0, margin: 0 }), [rows]);
  const rate = Math.max(0, Number(pct.replace(/,/g, "")) || 0);
  const base = basis === "revenue" ? totals.revenue : totals.margin;
  const commission = Math.round((base * rate) / 100);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {/* Print styles: when printing, show only the statement */}
      <style>{`@media print { body * { visibility: hidden !important; } #stmt, #stmt * { visibility: visible !important; } #stmt { position: absolute; inset: 0; margin: 0; padding: 24px; } .no-print { display: none !important; } }`}</style>

      {/* Controls — not printed */}
      <Card className="no-print">
        <CardHead title={t("Commission calculator")} hint={t("Pick a period, choose a basis and rate, then save or print. Nothing is paid automatically — this is a calculation you keep.")} />
        <form method="get" action={basePath} className="flex flex-wrap items-end gap-3">
          <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("From")}</span><input type="date" name="from" defaultValue={from} max={to} className="field h-9" /></label>
          <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("To")}</span><input type="date" name="to" defaultValue={to} max={today} className="field h-9" /></label>
          <button className="h-9 rounded-full bg-surface-2 px-4 text-[13px] font-medium text-ink-2 ring-1 ring-line hover:text-ink">{t("Load sales")}</button>
        </form>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-2 block text-[12.5px] text-ink-3">{t("Calculate on")}</span>
            <div className="flex gap-1 rounded-full bg-sunken p-1">
              {([["profit", t("Profit (margin)")], ["revenue", t("Revenue (sales)")]] as const).map(([k, lbl]) => (
                <button key={k} type="button" onClick={() => setBasis(k)} className={cx("h-9 flex-1 rounded-full text-[13px] transition", basis === k ? "bg-ink text-bg" : "text-ink-3 hover:text-ink")}>{lbl}</button>
              ))}
            </div>
          </div>
          <label><span className="mb-2 block text-[12.5px] text-ink-3">{t("Rate")} (%)</span>
            <input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" className="field num" dir="ltr" /></label>
        </div>
        <button type="button" onClick={() => window.print()} className="mt-5 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13.5px] text-bg hover:opacity-90">
          <Printer className="size-4" />{t("Print / Save as PDF")}
        </button>
      </Card>

      {/* The statement — the only thing that prints */}
      <Card id="stmt">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="text-[20px] font-[450] tracking-[-0.02em]">{t("Commission statement")}</div>
            <div className="mt-1 text-[13px] text-ink-3">{memberName}{isPartner ? ` · ${t("Partner")}` : ""}</div>
          </div>
          <div className="text-end text-[12px] text-ink-3">
            <div>{t("Period")}: {fmtDate(from, L)} – {fmtDate(to, L)}</div>
            <div>{t("Prepared by {name}", { name: byName })} · {fmtDate(today, L)}</div>
          </div>
        </div>

        {isPartner && <p className="mb-4 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-ink-3">{t("This team member is a partner. Partners normally take profit through the Day-25 settlement, not sales commission — calculate only if you intend to.")}</p>}

        {rows.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-3">{t("No sales credited to this person in this period.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-ink-4">
                  <th className="py-2 pe-3 text-start font-semibold">{t("Date")}</th>
                  <th className="py-2 pe-3 text-start font-semibold">{t("Ref")}</th>
                  <th className="py-2 pe-3 text-start font-semibold">{t("Client")}</th>
                  <th className="py-2 pe-3 text-start font-semibold">{t("Service")}</th>
                  <th className="py-2 pe-3 text-end font-semibold">{t("Revenue")}</th>
                  <th className="py-2 text-end font-semibold">{t("Margin")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className="py-2 pe-3">{fmtDate(r.date, L)}</td>
                    <td className="num py-2 pe-3" dir="ltr">{r.ref}</td>
                    <td className="py-2 pe-3">{r.client}</td>
                    <td className="py-2 pe-3">{t(SERVICE[r.serviceType] ?? r.serviceType)}</td>
                    <td className="num py-2 pe-3 text-end" dir="ltr">{show(r.revenue)}</td>
                    <td className="num py-2 text-end" dir="ltr">{show(r.margin)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-semibold">
                  <td className="py-2.5" colSpan={4}>{t("Total")} · {t("{n} sales", { n: rows.length })}</td>
                  <td className="num py-2.5 text-end" dir="ltr">{show(totals.revenue)}</td>
                  <td className="num py-2.5 text-end" dir="ltr">{show(totals.margin)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="mt-5 rounded-xl bg-surface-2 p-4">
          <div className="flex items-center justify-between text-[13px] text-ink-2">
            <span>{basis === "revenue" ? t("Revenue (sales)") : t("Profit (margin)")} × {rate}%</span>
            <span className="num" dir="ltr">{show(base)} × {rate}%</span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
            <span className="text-[15px] font-semibold">{t("Commission")}</span>
            <span className="figure text-[26px]" dir="ltr">{show(commission)}<span className="figure-unit">SAR</span></span>
          </div>
        </div>
      </Card>
    </div>
  );
}
