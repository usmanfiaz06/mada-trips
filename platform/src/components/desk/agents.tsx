"use client";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, Copy, KeyRound } from "lucide-react";
import { btn } from "../ui";
import { PendingContext, useSubmit } from "../client";
import { useT } from "@/lib/i18n/client";

type State = { error?: string; ok?: string; fields?: Record<string, string> } | null;
type Action = (prev: State, fd: FormData) => Promise<State>;

/**
 * Add agent: the form, then (once) the new login's temporary password and sign-in link, with copy buttons. The
 * password is never shown again; a lost one is reset from Team.
 */
export function AddAgentForm({ action, children, className }: { action: Action; children: ReactNode; className?: string }) {
  const t = useT();
  const [state, run, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const onSubmit = useSubmit(run);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  const pw = state?.fields?.password, link = state?.fields?.link;
  return (
    <PendingContext.Provider value={pending}>
      {state?.ok && pw && (
        <div role="status" className="mb-4 space-y-3 rounded-2xl bg-ok-soft px-4 py-3.5 text-[13.5px] text-ok animate-rise" data-testid="agent-invite">
          <div className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0" /><span>{t(state.ok)}</span></div>
          <div className="grid gap-2 text-ink">
            <Copyable label={t("Temporary password")} value={pw} icon={<KeyRound className="size-3.5" />} />
            {link && <Copyable label={t("Sign-in link")} value={link} />}
          </div>
          <p className="text-[12.5px] text-ink-2">{t("Pass the password on privately. It shows only now; they choose their own at first sign-in.")}</p>
        </div>
      )}
      <form ref={ref} onSubmit={onSubmit} className={className}>
        {state?.error && (
          <div role="alert" className="mb-1 flex items-start gap-2 rounded-xl bg-bad-soft px-3.5 py-2.5 text-[13.5px] text-bad animate-rise sm:col-span-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{t(state.error)}</span>
          </div>
        )}
        {children}
      </form>
    </PendingContext.Provider>
  );
}

function Copyable({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-ink-3">{label}</span>
        <code className="num block break-all text-[13px]" dir="ltr">{value}</code>
      </span>
      <button type="button" className={btn("ghost", "sm")} onClick={() => { navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {}); }}>
        {icon ?? <Copy className="size-3.5" />}{done ? t("Copied") : t("Copy")}
      </button>
    </div>
  );
}
