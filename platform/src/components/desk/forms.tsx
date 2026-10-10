"use client";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Lock, MessageSquareText, Paperclip, Plus, Send, Trash2, X } from "lucide-react";
import { btn, cx } from "../ui";
import { PendingContext, SubmitButton, useSubmit } from "../client";
import { useT } from "@/lib/i18n/client";

type State = { error?: string; ok?: string } | null;
type Action = (prev: State, fd: FormData) => Promise<State>;

/**
 * The reply box: reply to the traveller as yourself, or switch to a note only the team sees. Saved replies drop in
 * at the cursor, files go along as attachments, and while you type the app shows "Faisal is typing…".
 */
export function Composer({ action, typing, threadKind, threadId, agentName, canned, locale }: {
  action: Action; typing: (kind: string, id: string) => Promise<void>; threadKind: string; threadId: string; agentName: string;
  canned: { id: string; title: string; en: string; ar: string }[]; locale: "en" | "ar";
}) {
  const t = useT();
  const [state, run, pending] = useActionState(action, null);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [showCanned, setShowCanned] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const last = useRef(0);
  const onSubmit = useSubmit(run);
  useEffect(() => { if (state?.ok) { setText(""); setFile(null); form.current?.reset(); } }, [state]);

  const ping = () => {
    if (mode !== "reply" || Date.now() - last.current < 3500) return;
    last.current = Date.now();
    typing(threadKind, threadId).catch(() => {});
  };
  const insert = (s: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? text.length;
    const next = `${text.slice(0, at)}${text && at > 0 && !/\s$/.test(text.slice(0, at)) ? " " : ""}${s}${text.slice(at)}`;
    setText(next); setShowCanned(false);
    requestAnimationFrame(() => el?.focus());
  };
  const note = mode === "note";
  return (
    <PendingContext.Provider value={pending}>
      <form ref={form} onSubmit={onSubmit} className="relative">
        <input type="hidden" name="threadKind" value={threadKind} />
        <input type="hidden" name="threadId" value={threadId} />
        <input type="hidden" name="mode" value={mode} />
        {state?.error && <div role="alert" className="mb-2 flex items-center gap-2 rounded-xl bg-bad-soft px-3 py-2 text-[13px] text-bad"><AlertCircle className="size-4" />{t(state.error)}</div>}
        <div className={cx("rounded-[20px] p-2 ring-1 transition focus-within:ring-2", note ? "bg-gold-soft/70 ring-gold/50 focus-within:ring-gold" : "bg-surface-2 ring-line focus-within:ring-gold")}>
          <div className="flex items-center gap-1 px-1 pb-1.5">
            <div className="flex rounded-full bg-sunken p-0.5 text-[12px]">
              <button type="button" onClick={() => setMode("reply")} className={cx("h-7 rounded-full px-3 transition", !note ? "bg-ink text-bg" : "text-ink-3 hover:text-ink")}>{t("Reply as {name}", { name: agentName })}</button>
              <button type="button" onClick={() => setMode("note")} className={cx("inline-flex h-7 items-center gap-1 rounded-full px-3 transition", note ? "bg-gold text-[#1a140a]" : "text-ink-3 hover:text-ink")}><Lock className="size-3" />{t("Note for the team")}</button>
            </div>
            {!note && canned.length > 0 && (
              <button type="button" onClick={() => setShowCanned((v) => !v)} className="ms-auto inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-ink-3 transition hover:bg-sunken hover:text-ink" aria-expanded={showCanned}>
                <MessageSquareText className="size-3.5" />{t("Saved replies")}
              </button>
            )}
          </div>
          <textarea ref={area} name="body" rows={3} value={text} maxLength={4000}
            onChange={(e) => { setText(e.target.value); ping(); }}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.current?.requestSubmit(); } }}
            placeholder={note ? t("Only the team sees this") : t("Write to the traveller…")}
            className="block w-full resize-none bg-transparent px-2 py-1 text-[14.5px] leading-relaxed outline-none placeholder:text-ink-4" />
          <div className="flex items-center gap-2 px-1 pt-1">
            {!note && (
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-ink-3 transition hover:bg-sunken hover:text-ink">
                <Paperclip className="size-4" /><span className="max-w-[160px] truncate">{file ?? t("Attach")}</span>
                <input type="file" name="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} />
              </label>
            )}
            {file && <button type="button" className="text-ink-3 hover:text-ink" aria-label={t("Remove")} onClick={() => { setFile(null); const f = form.current?.querySelector<HTMLInputElement>("input[type=file]"); if (f) f.value = ""; }}><X className="size-3.5" /></button>}
            <span className="ms-auto hidden text-[11.5px] text-ink-4 sm:inline">⌘ Enter</span>
            <SubmitButton size="sm" variant={note ? "gold" : "primary"}>{note ? <Lock className="size-3.5" /> : <Send className="size-3.5 rtl:-scale-x-100" />}{note ? t("Add note") : t("Send")}</SubmitButton>
          </div>
        </div>
        {showCanned && (
          <div className="absolute bottom-full end-0 z-20 mb-2 max-h-[320px] w-[min(420px,100%)] overflow-y-auto rounded-[20px] bg-surface p-2 shadow-float ring-1 ring-line animate-rise">
            {canned.map((c) => (
              <button type="button" key={c.id} onClick={() => insert(locale === "ar" ? c.ar : c.en)} className="block w-full rounded-2xl px-3 py-2.5 text-start transition hover:bg-surface-2">
                <span className="block text-[13px] font-medium text-ink">{c.title}</span>
                <span className="line-clamp-2 block text-[12.5px] text-ink-3">{locale === "ar" ? c.ar : c.en}</span>
              </button>
            ))}
          </div>
        )}
      </form>
    </PendingContext.Provider>
  );
}

type Line = { key: number; label: string; amount: string; kind: string };
const KINDS = ["flight", "stay", "pickup", "visa", "service", "discount", "other"];

/** A line per person or per service; the total adds up as you type. */
export function QuoteBuilder({ action, requestId, people, defaultKind }: { action: Action; requestId: string; people: string[]; defaultKind: string }) {
  const t = useT();
  const [state, run, pending] = useActionState(action, null);
  const onSubmit = useSubmit(run);
  const seq = useRef(10);
  const [lines, setLines] = useState<Line[]>(() => (people.length ? people : [""]).map((p, i) => ({ key: i, label: p ? `${p} · ${t(defaultKind === "umrah" ? "Umrah package" : defaultKind === "visa" ? "Visa" : "Service")}` : "", amount: "", kind: defaultKind === "umrah" ? "service" : defaultKind === "visa" ? "visa" : "service" })));
  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.amount.replace(/,/g, "")) || 0), 0), [lines]);
  const set = (k: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  useEffect(() => { if (state?.ok) setLines((ls) => ls.map((l) => ({ ...l, amount: "" }))); }, [state]);
  return (
    <PendingContext.Provider value={pending}>
      <form onSubmit={onSubmit} className="space-y-3">
        <input type="hidden" name="id" value={requestId} />
        {state?.error && <div role="alert" className="flex items-center gap-2 rounded-xl bg-bad-soft px-3 py-2 text-[13px] text-bad"><AlertCircle className="size-4" />{t(state.error)}</div>}
        {state?.ok && <div role="status" className="rounded-xl bg-ok-soft px-3 py-2 text-[13px] text-ok">{t(state.ok)}</div>}
        <div className="space-y-2">
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_110px_32px] gap-2 sm:grid-cols-[minmax(0,1fr)_120px_130px_32px]">
              <input name="lineLabel" value={l.label} onChange={(e) => set(l.key, { label: e.target.value })} placeholder={t("What it's for")} className="field" maxLength={80} aria-label={t("Line")} />
              <select name="lineKind" value={l.kind} onChange={(e) => set(l.key, { kind: e.target.value })} className="field hidden sm:block" aria-label={t("Type")}>
                {KINDS.map((k) => <option key={k} value={k}>{t(k[0]!.toUpperCase() + k.slice(1))}</option>)}
              </select>
              <input name="lineAmount" value={l.amount} onChange={(e) => set(l.key, { amount: e.target.value })} inputMode="decimal" placeholder="0" className="field num text-end" dir="ltr" aria-label={t("Amount (SAR)")} />
              <button type="button" onClick={() => setLines((ls) => ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls)} className="grid size-10 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-bad" aria-label={t("Remove")}><Trash2 className="size-4" /></button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setLines((ls) => [...ls, { key: (seq.current += 1), label: "", amount: "", kind: "service" }])} className={btn("ghost", "sm")}><Plus className="size-3.5" />{t("Add a line")}</button>
          <div className="text-[13px] text-ink-3">{t("Total")} <span className="num ms-1 text-[20px] font-[450] tracking-[-0.02em] text-ink" dir="ltr">SAR {total.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span></div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
          <input name="cancellation" className="field" maxLength={200} placeholder={t("Cancellation rule the traveller sees")} />
          <select name="holdHours" className="field" defaultValue="24" aria-label={t("Price held for")}>
            {[["0", t("No hold")], ["2", t("Hold 2 hours")], ["24", t("Hold 24 hours")], ["72", t("Hold 3 days")]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <SubmitButton className="w-full"><Send className="size-4 rtl:-scale-x-100" />{t("Send the quote")}</SubmitButton>
      </form>
    </PendingContext.Provider>
  );
}
