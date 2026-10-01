"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import { ActionForm, SubmitButton } from "@/components/client";
import { cx } from "@/components/ui";
import { clearPayments } from "./actions";

type Row = { id: string; ref: string | null; bookingId: string | null; client: string; method: string; account: string; amount: number; date: string; methodLabel: string; accountLabel: string; dateLabel: string };
const show = (h: number) => (h / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });

export function ClearTable({ rows, today }: { rows: Row[]; today: string }) {
  const t = useT();
  const [acc, setAcc] = useState<"all" | "retail" | "corporate">("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const list = useMemo(() => rows.filter((r) => acc === "all" || r.account === acc), [rows, acc]);
  const total = list.filter((r) => sel.has(r.id)).reduce((s, r) => s + r.amount, 0);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <ActionForm action={clearPayments}>
      <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
        {(["all", "retail", "corporate"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setAcc(k)} className={cx("h-8 rounded-full px-3.5 text-[13px]", acc === k ? "bg-ink text-bg" : "bg-surface-2 text-ink-2 ring-1 ring-line")}>
            {t(k === "all" ? "Both accounts" : k === "retail" ? "SNB" : "Alinma")}
          </button>
        ))}
        <button type="button" onClick={() => setSel(new Set(list.map((r) => r.id)))} className="ms-auto text-[13px] text-ink-3 hover:text-ink">{t("Select all")}</button>
      </div>
      <div className="max-h-[420px] overflow-y-auto border-y border-line">
        {list.map((r) => (
          <label key={r.id} className={cx("flex cursor-pointer items-center gap-4 border-b border-line px-6 py-3 last:border-0 transition", sel.has(r.id) ? "bg-gold-soft" : "hover:bg-surface-2")}>
            <input type="checkbox" name="ids" value={r.id} checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="size-4 accent-[var(--gold)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] text-ink">{r.client} {r.ref && <Link href={`/adminwork/sales/${r.bookingId}`} className="num text-ink-3 hover:underline" onClick={(e) => e.stopPropagation()}>· {r.ref}</Link>}</span>
              <span className="block text-[12px] text-ink-3">{r.dateLabel} · {r.methodLabel} · {r.accountLabel}</span>
            </span>
            <span className="num text-[14px]" dir="ltr">{show(r.amount)}</span>
          </label>
        ))}
        {list.length === 0 && <div className="px-6 py-10 text-center text-[13px] text-ink-3">{t("Every receipt is cleared.")}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-3 px-6 py-4">
        <span className="text-[13px] text-ink-3">{t("{n} selected", { n: sel.size })} · <span className="num text-ink" dir="ltr">{show(total)}</span></span>
        <label className="ms-auto flex items-center gap-2 text-[13px] text-ink-3">{t("Cleared on")}<input type="date" name="clearedOn" defaultValue={today} max={today} className="field h-9 w-auto" /></label>
        <SubmitButton variant="primary" size="sm">{t("Mark cleared")}</SubmitButton>
      </div>
    </ActionForm>
  );
}
