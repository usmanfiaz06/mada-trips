"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { AlertCircle, CalendarDays, Check, Link2, ListPlus, X } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { cx } from "@/components/ui";
import { useSubmit } from "@/components/client";
import type { ActionState } from "@/lib/actions";

type Person = { id: string; name: string; team: string };
const shift = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * Quick add: type what needs doing, pick who and when, press Enter.
 * Details (notes and steps) fold out only when needed, so the common case stays one line.
 */
export function TaskForm({ action, people, meId, today, link, autoFocus }: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  people: Person[]; meId: string; today: string;
  link?: { type: string; id: string; label: string } | null; autoFocus?: boolean;
}) {
  const t = useT();
  const [state, run, pending] = useActionState(action, null);
  const onSubmit = useSubmit(run);
  const form = useRef<HTMLFormElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const [due, setDue] = useState<string>(today);
  const [priority, setPriority] = useState("normal");
  const [who, setWho] = useState(meId);
  const [more, setMore] = useState(false);
  const [linked, setLinked] = useState(link ?? null);
  const [expanded, setExpanded] = useState(!!link);

  useEffect(() => {
    if (!state?.ok) return;
    form.current?.reset();
    setPriority("normal"); setMore(false); setExpanded(false);
  }, [state]);
  useEffect(() => { if (autoFocus) title.current?.focus(); }, [autoFocus]);

  const quick = [
    { v: today, l: t("Today") }, { v: shift(today, 1), l: t("Tomorrow") }, { v: shift(today, 7), l: t("Next week") }, { v: "", l: t("No date") },
  ];
  const custom = due && !quick.some((q) => q.v === due);
  const teams = [...new Set(people.map((p) => p.team))];

  return (
    <form ref={form} onSubmit={onSubmit} className="space-y-3">
      {state?.error && <div role="alert" className="flex items-start gap-2 rounded-xl bg-bad-soft px-3.5 py-2.5 text-[13.5px] text-bad animate-rise"><AlertCircle className="mt-0.5 size-4 shrink-0" />{t(state.error)}</div>}
      {state?.ok && <div role="status" className="flex items-start gap-2 rounded-xl bg-ok-soft px-3.5 py-2.5 text-[13.5px] text-ok animate-rise"><Check className="mt-0.5 size-4 shrink-0" />{t(state.ok)}</div>}

      <input type="hidden" name="dueDate" value={due} />
      <input type="hidden" name="priority" value={priority} />
      {linked && <><input type="hidden" name="linkType" value={linked.type} /><input type="hidden" name="linkId" value={linked.id} /></>}

      <div className="flex items-center gap-2 rounded-[18px] bg-surface-2 p-1.5 ps-4 ring-1 ring-line focus-within:ring-gold">
        <input ref={title} name="title" required minLength={2} maxLength={160} autoComplete="off" placeholder={t("What needs doing?")} onFocus={() => setExpanded(true)}
          className="h-11 min-w-0 flex-1 bg-transparent text-[15.5px] outline-none placeholder:text-ink-4" />
        <button type="submit" disabled={pending} className="flex h-11 shrink-0 items-center gap-1.5 rounded-[14px] bg-ink px-4 text-[14px] text-bg transition hover:opacity-90 disabled:opacity-60">
          <ListPlus className="size-4" />{pending ? t("Adding…") : t("Add task")}
        </button>
      </div>

      {expanded && (<>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 animate-rise">
        <label className="flex items-center gap-2 text-[13px] text-ink-3">
          {t("For")}
          <select name="assigneeId" value={who} onChange={(e) => setWho(e.target.value)} className="h-9 rounded-full bg-surface-2 px-3 text-[13.5px] text-ink ring-1 ring-line outline-none focus:ring-gold">
            <option value={meId}>{t("Me")}</option>
            {teams.map((team) => (
              <optgroup key={team} label={t(team === "riyadh" ? "Riyadh office" : team === "pakistan" ? "Pakistan desk" : "Management")}>
                {people.filter((p) => p.team === team && p.id !== meId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("Due")}>
          <CalendarDays className="me-1 size-4 text-ink-3" />
          {quick.map((q) => (
            <button key={q.l} type="button" onClick={() => setDue(q.v)} aria-pressed={due === q.v}
              className={cx("h-8 rounded-full px-3 text-[12.5px] transition", due === q.v ? "bg-ink text-bg" : "bg-surface-2 text-ink-2 ring-1 ring-line hover:ring-line-strong")}>{q.l}</button>
          ))}
          <input type="date" value={custom ? due : ""} min={today} onChange={(e) => setDue(e.target.value)} aria-label={t("Pick a date")}
            className={cx("h-8 rounded-full px-2.5 text-[12.5px] ring-1 outline-none", custom ? "bg-ink text-bg ring-ink" : "bg-surface-2 text-ink-3 ring-line")} />
        </div>

        <div className="flex items-center gap-1" role="group" aria-label={t("Priority")}>
          {[["normal", t("Normal")], ["high", t("High")], ["urgent", t("Urgent")]].map(([v, l]) => (
            <button key={v} type="button" onClick={() => setPriority(v)} aria-pressed={priority === v}
              className={cx("h-8 rounded-full px-3 text-[12.5px] transition",
                priority === v ? (v === "urgent" ? "bg-bad text-white" : v === "high" ? "bg-warn text-white" : "bg-ink text-bg") : "bg-surface-2 text-ink-2 ring-1 ring-line hover:ring-line-strong")}>{l}</button>
          ))}
        </div>

        <button type="button" onClick={() => setMore((m) => !m)} className="ms-auto text-[13px] text-ink-3 underline decoration-line-strong underline-offset-4 hover:text-ink">
          {more ? t("Fewer details") : t("Add notes or steps")}
        </button>
      </div>

      {linked && (
        <div className="flex items-center gap-2 text-[13px] text-ink-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gold-soft px-3 py-1 text-gold-2"><Link2 className="size-3.5" />{t("About")} {linked.label}</span>
          <button type="button" onClick={() => setLinked(null)} className="grid size-6 place-items-center rounded-full text-ink-3 hover:bg-sunken" aria-label={t("Remove link")}><X className="size-3.5" /></button>
        </div>
      )}

      {more && (
        <div className="grid gap-3 sm:grid-cols-2 animate-rise">
          <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Notes")}</span>
            <textarea name="notes" rows={3} maxLength={4000} className="field" placeholder={t("Anything they need to know")} /></label>
          <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Steps (one per line)")}</span>
            <textarea name="steps" rows={3} className="field" placeholder={t("Call the client\nSend the invoice")} /></label>
        </div>
      )}
      </>)}
    </form>
  );
}
