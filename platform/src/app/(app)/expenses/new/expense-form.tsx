"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Building2, Check, FileUp, Loader2, UserRound } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { btn, cx } from "@/components/ui";
import { submitExpense } from "../actions";

function Submit({ ready, label }: { ready: boolean; label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending || !ready} className={btn("gold", "lg", "w-full")}>{pending && <Loader2 className="size-4 animate-spin" />}{label}</button>;
}

export function ExpenseForm({ categories, isPartner, today }: { categories: [string, string][]; isPartner: boolean; today: string }) {
  const t = useT();
  const [state, action] = useActionState(submitExpense, null);
  const [cat, setCat] = useState("");
  const [paidBy, setPaidBy] = useState(isPartner ? "partner" : "retail");
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [desc, setDesc] = useState("");
  const [why, setWhy] = useState("");
  const checks = [
    { ok: Number(amount) > 0, label: t("Exact amount in SAR") },
    { ok: !!file, label: t("Proof of payment") },
    { ok: desc.trim().length >= 3 && why.trim().length >= 5, label: t("Description & business reason") },
  ];
  const ready = checks.every((c) => c.ok) && !!cat;

  return (
    <form action={action} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        {state?.error && <div role="alert" className="flex items-start gap-2 rounded-2xl bg-bad-soft px-4 py-3 text-[13.5px] text-bad"><AlertCircle className="mt-0.5 size-4" />{t(state.error)}</div>}
        <section className="rounded-card bg-surface p-6 shadow-card">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="sm:col-span-2"><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Amount paid")} <span className="text-gold-2">*</span></span>
              <div className="relative"><input name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="field field-lg pe-14" placeholder="0.00" dir="ltr" autoFocus />
                <span className="absolute end-4 top-1/2 -translate-y-1/2 text-[12px] text-ink-3">SAR</span></div></label>
            <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("of which VAT")}</span>
              <input name="vatAmount" defaultValue="0" inputMode="decimal" className="field field-lg" dir="ltr" /></label>
          </div>
          <div className="mt-5"><span className="mb-2 block text-[12.5px] text-ink-3">{t("Category")} <span className="text-gold-2">*</span></span>
            <div className="flex flex-wrap gap-2">
              {categories.map(([k, v]) => (
                <button key={k} type="button" onClick={() => setCat(k)} className={cx("h-9 rounded-full px-4 text-[13px] transition", cat === k ? "bg-ink text-bg" : "bg-surface-2 text-ink-2 ring-1 ring-line hover:ring-line-strong")}>{t(v)}</button>
              ))}
            </div>
            <input type="hidden" name="category" value={cat} />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("What was it for?")} <span className="text-gold-2">*</span></span>
              <input name="description" value={desc} onChange={(e) => setDesc(e.target.value)} className="field" placeholder={t("e.g. Office internet, September")} /></label>
            <label className="sm:col-span-2"><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Business justification")} <span className="text-gold-2">*</span></span>
              <textarea name="justification" value={why} onChange={(e) => setWhy(e.target.value)} rows={2} className="field" placeholder={t("Why the company needed this")} /></label>
            <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Vendor")}</span><input name="vendor" className="field" /></label>
            <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Date paid")} <span className="text-gold-2">*</span></span><input name="expenseDate" type="date" defaultValue={today} max={today} className="field" /></label>
          </div>
        </section>

        <section className="rounded-card bg-surface p-6 shadow-card">
          <span className="mb-3 block text-[12.5px] text-ink-3">{t("Who paid?")}</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {[...(isPartner ? [["partner", t("I paid personally"), t("Added to your partner ledger once verified"), UserRound] as const] : []),
              ["retail", t("Retail account"), t("Company B2C account"), Building2] as const,
              ["corporate", t("Corporate account"), t("Company B2B account"), Building2] as const].map(([k, title, sub, Icon]) => (
              <button key={k} type="button" onClick={() => setPaidBy(k)} className={cx("rounded-2xl p-4 text-start ring-1 transition", paidBy === k ? "bg-ink text-bg ring-ink" : "bg-surface-2 ring-line hover:ring-line-strong")}>
                <Icon className="size-4 opacity-70" /><div className="mt-3 text-[14px]">{title}</div><div className={cx("mt-0.5 text-[12px]", paidBy === k ? "opacity-60" : "text-ink-3")}>{sub}</div>
              </button>
            ))}
          </div>
          <input type="hidden" name="paidBy" value={paidBy} />
          {paidBy === "partner" && (
            <label className="mt-4 flex items-start gap-3 rounded-2xl bg-surface-2 p-4 ring-1 ring-line">
              <input type="checkbox" name="isStartup" className="mt-1 size-4 accent-[var(--gold)]" />
              <span><span className="block text-[14px]">{t("This is a startup cost")}</span><span className="block text-[12.5px] text-ink-3">{t("Registration, licences, lease, furnishing: booked as a capital advance, not a monthly overhead.")}</span></span>
            </label>
          )}
        </section>

        <label className={cx("flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed p-8 text-center transition", file ? "border-ok bg-ok-soft" : "border-line-strong bg-surface hover:border-gold")}>
          <input type="file" name="proof" accept="application/pdf,image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file ? <Check className="size-6 text-ok" /> : <FileUp className="size-6 text-ink-3" />}
          <div className="mt-3 text-[14.5px]">{file ? file.name : t("Attach proof of payment")} <span className="text-gold-2">*</span></div>
          <div className="mt-1 text-[12.5px] text-ink-3">{file ? `${(file.size / 1024).toFixed(0)} KB · ${t("tap to replace")}` : t("Bank transfer confirmation or tax invoice. PDF or photo, up to 6 MB.")}</div>
        </label>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-card bg-surface p-6 shadow-card">
          <div className="text-[15px]">{t("Before you submit")}</div>
          <p className="mt-1 text-[12.5px] text-ink-3">{t("The partnership agreement requires all three.")}</p>
          <ul className="mt-4 space-y-3">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-3 text-[13.5px]">
                <span className={cx("grid size-6 place-items-center rounded-full transition", c.ok ? "bg-ok text-white" : "bg-sunken text-ink-4")}><Check className="size-3.5" strokeWidth={3} /></span>
                <span className={c.ok ? "text-ink" : "text-ink-3"}>{c.label}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 rounded-2xl bg-surface-2 p-3.5 text-[12.5px] text-ink-3">{t("Next: someone other than you verifies it. If you paid personally, it's added to your partner ledger and repaid from the Day-25 waterfall.")}</div>
          <div className="mt-5"><Submit ready={ready} label={t("Submit for verification")} /></div>
        </div>
      </aside>
    </form>
  );
}
