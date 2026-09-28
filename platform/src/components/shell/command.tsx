"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CornerDownLeft, Search, FileText, User, Receipt, Ticket } from "lucide-react";
import { cx } from "../ui";
import { useT } from "@/lib/i18n/client";

type Item = { id: string; label: string; hint?: string; href: string; kind: "page" | "booking" | "client" | "expense" | "approval" };
const KIND_ICON = { page: ArrowRight, booking: Ticket, client: User, expense: Receipt, approval: FileText };

export function CommandPalette({ pages }: { pages: { label: string; href: string; section: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Item[]>([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "n" && pages.some((p) => p.href === "/sales/new")) { e.preventDefault(); router.push("/sales/new"); }
      else if (!typing && e.key === "/") { e.preventDefault(); setOpen(true); }
      else if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mada:command", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mada:command", onOpen); };
  }, [router, pages]);

  useEffect(() => { if (open) { setQ(""); setIdx(0); setTimeout(() => inputRef.current?.focus(), 10); } }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) { setRemote([]); return; }
    const c = new AbortController();
    const h = setTimeout(() => fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: c.signal }).then((r) => r.json()).then(setRemote).catch(() => {}), 140);
    return () => { clearTimeout(h); c.abort(); };
  }, [q]);

  const items: Item[] = useMemo(() => {
    const s = q.trim().toLowerCase();
    const p = pages.filter((x) => !s || x.label.toLowerCase().includes(s) || x.section.toLowerCase().includes(s))
      .map((x) => ({ id: x.href, label: x.label, hint: x.section, href: x.href, kind: "page" as const }));
    return [...remote, ...p].slice(0, 14);
  }, [q, remote, pages]);

  useEffect(() => setIdx(0), [items.length]);
  if (!open) return null;
  const go = (it?: Item) => { if (!it) return; setOpen(false); router.push(it.href); };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-[#07100c]/50 backdrop-blur-[2px] animate-fade" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-[600px] overflow-hidden rounded-[26px] bg-surface shadow-float animate-rise">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-[18px] text-ink-3" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter") go(items[idx]);
            }}
            placeholder={t("Search sales, PNRs, clients, expenses or jump to a page…")}
            className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-4" />
          <kbd className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-3">Esc</kbd>
        </div>
        <ul className="max-h-[52vh] overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-8 text-center text-[13.5px] text-ink-3">{t("Nothing found")}</li>}
          {items.map((it, i) => {
            const Icon = KIND_ICON[it.kind];
            return (
              <li key={it.kind + it.id}>
                <button onMouseEnter={() => setIdx(i)} onClick={() => go(it)}
                  className={cx("flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-start text-[14px]", i === idx ? "bg-sunken text-ink" : "text-ink-2")}>
                  <span className={cx("grid size-7 place-items-center rounded-lg", it.kind === "page" ? "bg-sunken text-ink-3" : "bg-gold-soft text-gold-2")}><Icon className="size-3.5 rtl:[&.lucide-arrow-right]:rotate-180" /></span>
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="truncate text-[12px] text-ink-3">{it.hint}</span>}
                  {i === idx && <CornerDownLeft className="size-3.5 text-ink-4" />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-line bg-surface-2 px-4 py-2 text-[11.5px] text-ink-3">
          <span><kbd className="font-sans">↑↓</kbd> {t("move")}</span><span><kbd>↵</kbd> {t("open")}</span><span className="ms-auto"><kbd>N</kbd> {t("new sale anywhere")}</span>
        </div>
      </div>
    </div>
  );
}

export function CommandTrigger() {
  const t = useT();
  return (
    <button onClick={() => window.dispatchEvent(new Event("mada:command"))}
      className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-full bg-white/[0.06] px-4 text-[13.5px] text-tile-ink-3 transition hover:bg-white/10 hover:text-tile-ink sm:max-w-[420px]">
      <Search className="size-4" /><span className="truncate">{t("Search or jump to…")}</span>
      <kbd className="ms-auto hidden rounded-full border border-white/15 px-2 py-0.5 text-[11px] sm:inline" dir="ltr">⌘K</kbd>
    </button>
  );
}
