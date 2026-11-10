"use client";
import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { ActionForm, SubmitButton } from "@/components/client";
import { Badge, Field, Input, cx } from "@/components/ui";
import { updateBank } from "./actions";

const show = (h: number) => (h / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type Acct = { key: string; name: string; bank: string | null; iban: string | null; since: string; openingInput: string };

/**
 * One bank's opening-balance / bank / IBAN editor, collapsed behind its header. Clicking the header opens the
 * form so the setup card stays short with many accounts instead of showing every field at once.
 */
export function AccountEditor({ a }: { a: Acct }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className={cx("rounded-2xl ring-1 transition", open ? "bg-surface-2 ring-line" : "ring-line")}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-start">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[14px]">{a.name}<Badge>{t("since {d}", { d: a.since })}</Badge></span>
          <span className="mt-0.5 block truncate text-[12px] text-ink-3">{a.bank || "—"}{a.iban ? ` · ${a.iban}` : ""}</span>
        </span>
        <ChevronDown className={cx("size-4 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ActionForm action={updateBank} className="grid grid-cols-2 gap-3 px-4 pb-4">
          <input type="hidden" name="key" value={a.key} />
          <Field label={t("Bank")}><Input name="bank" defaultValue={a.bank ?? ""} /></Field>
          <Field label={t("Opening balance")}><Input name="openingBalance" defaultValue={a.openingInput} dir="ltr" /></Field>
          <Field label="IBAN" className="col-span-2"><Input name="iban" defaultValue={a.iban ?? ""} dir="ltr" /></Field>
          <div className="col-span-2"><SubmitButton variant="outline" size="sm">{t("Save")}</SubmitButton></div>
        </ActionForm>
      )}
    </div>
  );
}

const MOVE_LABEL: Record<string, string> = { receipt: "Client payment", supplier: "Supplier paid", bsp: "BSP debit", expense: "Expense", deposit: "Deposit", withdrawal: "Withdrawal", transfer: "Transfer" };
export type Move = { positive: boolean; kind: string; label: string | null; ref: string | null; by: string | null; cleared: boolean; dateLabel: string; amount: number };

/** One account's statement: searchable, and capped in height with its own scroll so the card can't keep growing. */
export function MovementsList({ rows }: { rows: Move[] }) {
  const t = useT();
  const [q, setQ] = useState("");
  const view = useMemo(() => {
    const items = rows.map((m) => {
      const title = `${MOVE_LABEL[m.kind] ? t(MOVE_LABEL[m.kind]) : m.kind}${m.label ? ` · ${m.label}` : ""}`;
      const sub = `${m.dateLabel}${m.ref ? ` · ${m.ref}` : ""}${m.by ? ` · ${t("by {name}", { name: m.by })}` : ""}${m.kind === "receipt" && !m.cleared ? ` · ${t("not cleared")}` : ""}`;
      return { ...m, title, sub, hay: `${title} ${sub}`.toLowerCase() };
    });
    const needle = q.trim().toLowerCase();
    return needle ? items.filter((m) => m.hay.includes(needle)) : items;
  }, [rows, q, t]);

  if (rows.length === 0) return <p className="px-6 pb-6 text-[13px] text-ink-3">{t("No movements yet.")}</p>;
  return (
    <div className="px-3 pb-3">
      <div className="relative mb-1 px-1">
        <Search className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search this account…")} className="field h-9 w-full ps-10 text-[13px]" />
      </div>
      {view.length === 0 ? (
        <p className="px-3 py-6 text-center text-[13px] text-ink-3">{t("Nothing matches “{q}”.", { q: q.trim() })}</p>
      ) : (
        <ul className="max-h-[420px] overflow-y-auto">
          {view.map((m, i) => (
            <li key={i} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-surface-2">
              <span className={cx("grid size-7 shrink-0 place-items-center rounded-full text-[11px]", m.positive ? "bg-ok-soft text-ok" : "bg-surface-2 text-ink-3")}>{m.positive ? "＋" : "－"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px]">{m.title}</span>
                <span className="block text-[11.5px] text-ink-3">{m.sub}</span>
              </span>
              <span className={cx("num shrink-0 text-[13.5px]", m.positive ? "text-ok" : "text-ink-2")} dir="ltr">{show(Math.abs(m.amount))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
