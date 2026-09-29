"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cx } from "./ui";
import { useT } from "@/lib/i18n/client";

export type PickerItem = {
  value: string;      // what gets saved (e.g. "RUH")
  code: string;       // the short code shown in the badge
  primary: string;    // main line (city / airline)
  secondary?: string; // second line (airport name, country)
  keywords: string;   // everything searchable, lowercased
};

// Arabic-friendly matching: drop diacritics and unify alef / taa marbuta / yaa forms.
const norm = (s: string) => s.toLowerCase()
  .replace(/[ً-ْ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
  .normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Search-as-you-type picker that only accepts values from its list, so data stays consistent. */
export function Picker({ items, value, onChange, placeholder, label, invalid, empty }: {
  items: PickerItem[]; value: string; onChange: (v: string) => void; placeholder: string; label: string; invalid?: boolean; empty?: string;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = items.find((i) => i.value === value);

  const results = useMemo(() => {
    const s = norm(q.trim());
    if (!s) return items.slice(0, 8);
    const scored: [number, PickerItem][] = [];
    for (const it of items) {
      const code = it.code.toLowerCase();
      const primary = norm(it.primary);
      let score = -1;
      if (code === s) score = 0;
      else if (primary.startsWith(s)) score = 1;
      else if (code.startsWith(s)) score = 2;
      else if (norm(it.keywords).split(/\s+/).some((w) => w.startsWith(s))) score = 3;
      else if (norm(it.keywords).includes(s)) score = 4;
      if (score >= 0) scored.push([score, it]);
    }
    return scored.sort((a, b) => a[0] - b[0]).slice(0, 8).map(([, it]) => it);
  }, [q, items]);

  useEffect(() => setHi(0), [q]);
  useEffect(() => { listRef.current?.children[hi]?.scrollIntoView({ block: "nearest" }); }, [hi]);

  const choose = (it: PickerItem) => { onChange(it.value); setQ(""); setOpen(false); };

  if (selected && !open) {
    return (
      <div className={cx("flex h-[42px] items-center gap-2.5 rounded-[12px] bg-surface-2 px-2 ring-1", invalid ? "ring-bad" : "ring-line")}>
        <span className="num rounded-lg bg-ink px-2 py-1 text-[12px] font-medium tracking-wider text-bg" dir="ltr">{selected.code}</span>
        <button type="button" onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }} className="min-w-0 flex-1 truncate text-start text-[14px]" aria-label={`${label}: ${selected.primary}`}>
          {selected.primary}{selected.secondary && <span className="text-ink-3"> · {selected.secondary}</span>}
        </button>
        <button type="button" onClick={() => { onChange(""); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }} className="grid size-7 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink" aria-label={t("Clear")}><X className="size-3.5" /></button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
      <input
        ref={inputRef} value={q} placeholder={placeholder} aria-label={label} aria-invalid={invalid} autoComplete="off" role="combobox" aria-expanded={open}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => Math.min(i + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (results[hi]) choose(results[hi]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        className="field ps-10 pe-9"
      />
      <ChevronDown className="pointer-events-none absolute end-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-4" />
      {open && (
        <ul ref={listRef} role="listbox" className="absolute inset-x-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-2xl bg-surface p-1.5 shadow-float ring-1 ring-line animate-rise">
          {results.map((it, i) => (
            <li key={it.value} role="option" aria-selected={i === hi}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setHi(i)} onClick={() => choose(it)}
                className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start", i === hi && "bg-surface-2")}>
                <span className="num w-11 shrink-0 rounded-lg bg-sunken py-1 text-center text-[12px] font-medium tracking-wider text-ink-2" dir="ltr">{it.code}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{it.primary}</span>
                  {it.secondary && <span className="block truncate text-[12px] text-ink-3">{it.secondary}</span>}
                </span>
                {it.value === value && <Check className="size-4 text-ok" />}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-4 text-center text-[13px] text-ink-3">{empty ?? t("No match. Try the city name or code.")}</li>}
        </ul>
      )}
    </div>
  );
}
