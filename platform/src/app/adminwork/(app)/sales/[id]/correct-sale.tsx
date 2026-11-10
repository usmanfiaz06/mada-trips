"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { ActionForm, SubmitButton } from "@/components/client";
import { PASSPORT_RULE, type Traveller } from "@/lib/services";
import { correctSale } from "../actions";

type Props = {
  id: string; serviceType: string;
  netCost: string; sellPrice: string; supplier: string; pnr: string; ticketNumbers: string;
  travellers: Traveller[];
  marginLimitLabel: string;
};

const toH = (v: string) => { const n = Number(String(v).replace(/,/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const show = (h: number) => (h / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CorrectSaleForm({ id, serviceType, netCost, sellPrice, supplier, pnr, ticketNumbers, travellers, marginLimitLabel }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [cost, setCost] = useState(netCost);
  const [sell, setSell] = useState(sellPrice);
  const [rows, setRows] = useState<Traveller[]>(travellers.length ? travellers : [{ name: "" }]);
  const [travellersEdited, setTravellersEdited] = useState(false);
  const passports = PASSPORT_RULE[serviceType] ?? "none";
  const isFlight = serviceType === "flight";
  const newMargin = toH(sell) - toH(cost);
  const setRow = (i: number, k: keyof Traveller, v: string) => { setTravellersEdited(true); setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x))); };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[13px] text-ink-3 underline decoration-ink-4 decoration-1 underline-offset-4 hover:text-ink">
        {t("Correct this sale")}
      </button>
    );
  }

  return (
    <ActionForm action={correctSale} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      {travellersEdited && <input type="hidden" name="travellers" value={JSON.stringify(rows)} />}
      <p className="text-[12.5px] text-ink-3">{t("Fix a wrong figure or detail without refunding. A change that moves the margin by less than {lim} applies right away; a bigger one is sent to a director to approve. Every change is logged.", { lim: marginLimitLabel })}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Net cost")}</span>
          <input name="netCost" value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className="field num" dir="ltr" /></label>
        <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Selling price")}</span>
          <input name="sellPrice" value={sell} onChange={(e) => setSell(e.target.value)} inputMode="decimal" className="field num" dir="ltr" /></label>
        <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Supplier")}</span>
          <input name="supplier" defaultValue={supplier} className="field" /></label>
        {isFlight && <label><span className="mb-1.5 block text-[12.5px] text-ink-3">PNR</span>
          <input name="pnr" defaultValue={pnr} className="field num uppercase" dir="ltr" /></label>}
        <label className="sm:col-span-2"><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Ticket no.")}</span>
          <input name="ticketNumbers" defaultValue={ticketNumbers} className="field num" dir="ltr" /></label>
      </div>

      <div className="rounded-2xl bg-surface-2 p-3.5 text-[12.5px] text-ink-3">
        {t("New margin")}: <span className="num text-ink" dir="ltr">{show(newMargin)}</span>
      </div>

      <div>
        <span className="mb-2 block text-[12.5px] text-ink-3">{t("Travellers")}</span>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-2">
              <input value={r.name} onChange={(e) => setRow(i, "name", e.target.value)} className="field" placeholder={t("Name")} aria-label={t("Name")} />
              {passports !== "none" && <input value={r.passport ?? ""} onChange={(e) => setRow(i, "passport", e.target.value)} className="field num uppercase" dir="ltr" placeholder={t("Passport no.")} aria-label={t("Passport no.")} />}
              {passports !== "none" && <input value={r.nationality ?? ""} onChange={(e) => setRow(i, "nationality", e.target.value)} className="field uppercase" dir="ltr" placeholder={t("Nationality")} aria-label={t("Nationality")} />}
              {passports !== "none" && <input type="date" value={r.expiry ?? ""} onChange={(e) => setRow(i, "expiry", e.target.value)} className="field" aria-label={t("Expiry")} />}
            </div>
          ))}
        </div>
      </div>

      <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Reason (shown to the director if approval is needed)")}</span>
        <textarea name="reason" rows={2} className="field" placeholder={t("e.g. Net cost was entered as 200 instead of 250")} /></label>

      <div className="flex items-center gap-2">
        <SubmitButton variant="primary">{t("Save correction")}</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="text-[13px] text-ink-3 hover:text-ink">{t("Cancel")}</button>
      </div>
    </ActionForm>
  );
}
