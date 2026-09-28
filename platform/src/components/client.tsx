"use client";
import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Loader2, Moon, Sun, X } from "lucide-react";
import { btn, cx } from "./ui";
import { useT } from "@/lib/i18n/client";
import { BASE } from "@/lib/base";

type State = { error?: string; ok?: string; fields?: Record<string, string> } | null;
type Action = (prev: State, fd: FormData) => Promise<State>;

export function SubmitButton({ children, variant = "primary", size = "md", className, name, value, confirm }: {
  children: ReactNode; variant?: Parameters<typeof btn>[0]; size?: Parameters<typeof btn>[1]; className?: string; name?: string; value?: string; confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={btn(variant, size, className)}
      onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function ActionForm({ action, children, className, resetOnOk }: { action: Action; children: ReactNode; className?: string; resetOnOk?: boolean }) {
  const t = useT();
  const [state, run] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnOk) ref.current?.reset(); }, [state, resetOnOk]);
  return (
    <form ref={ref} action={run} className={className}>
      {state?.error && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl bg-bad-soft px-3.5 py-2.5 text-[13.5px] text-bad animate-rise">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{t(state.error)}</span>
        </div>
      )}
      {state?.ok && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-xl bg-ok-soft px-3.5 py-2.5 text-[13.5px] text-ok animate-rise">
          <Check className="mt-0.5 size-4 shrink-0" /><span>{t(state.ok)}</span>
        </div>
      )}
      {children}
    </form>
  );
}

/** Reads the one-shot flash cookie set by server actions and shows it as a toast. */
export function Toaster() {
  const t = useT();
  const [msg, setMsg] = useState<string | null>(null);
  // Server actions set a one-shot cookie. Watch for it, so the toast shows even when the action
  // redirects back to the page you're already on.
  useEffect(() => {
    let hide: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const m = document.cookie.split("; ").find((c) => c.startsWith("mada_flash="));
      if (!m) return;
      document.cookie = `mada_flash=; Max-Age=0; path=${BASE || "/"}`;
      setMsg(decodeURIComponent(decodeURIComponent(m.split("=")[1])));
      clearTimeout(hide);
      hide = setTimeout(() => setMsg(null), 4200);
    };
    check();
    const i = setInterval(check, 350);
    return () => { clearInterval(i); clearTimeout(hide); };
  }, []);
  if (!msg) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-tile py-2 ps-2 pe-4 text-[14px] text-tile-ink shadow-float animate-rise">
        <span className="grid size-6 place-items-center rounded-full bg-gold text-[#1a140a]"><Check className="size-3.5" strokeWidth={3} /></span>
        {t(msg)}
        <button onClick={() => setMsg(null)} className="ms-2 opacity-60 hover:opacity-100" aria-label="Dismiss"><X className="size-4" /></button>
      </div>
    </div>
  );
}

export function ThemeToggle() {
  const t = useT();
  const toggle = () => {
    const dark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    document.cookie = `mada_theme=${dark ? "dark" : "light"}; path=${BASE || "/"}; max-age=31536000; samesite=lax`;
  };
  return (
    <button onClick={toggle} className="grid size-10 place-items-center rounded-full text-tile-ink-3 transition hover:bg-white/10 hover:text-tile-ink" aria-label={t("Toggle theme")} title={t("Toggle theme")}>
      <Sun className="size-[18px] dark:hidden" /><Moon className="hidden size-[18px] dark:block" />
    </button>
  );
}

export function LocaleSwitch({ dark = true }: { dark?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = t.locale === "ar" ? "en" : "ar";
  return (
    <button disabled={pending} className={cx("grid h-10 min-w-10 place-items-center rounded-full px-2.5 text-[13px] font-medium transition", dark ? "text-tile-ink-3 hover:bg-white/10 hover:text-tile-ink" : "text-ink-2 hover:bg-surface")} title={t("Language")}
      onClick={() => { document.cookie = `mada_locale=${next}; path=${BASE || "/"}; max-age=31536000; samesite=lax`; start(() => router.refresh()); }}>
      {next === "ar" ? "عربي" : "EN"}
    </button>
  );
}

/** Live countdown to the 10 PM Riyadh close. Shows Pakistan time too for the remote team. */
export function CloseClock({ closeHour, showPk }: { closeHour: number; showPk: boolean }) {
  const t = useT();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const i = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(i); }, []);
  if (!now) return <div className="h-9 w-40" />;
  const fmt = (tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const [h, m] = fmt("Asia/Riyadh").split(":").map(Number);
  const mins = h * 60 + m < closeHour * 60 ? closeHour * 60 - (h * 60 + m) : 24 * 60 - (h * 60 + m) + closeHour * 60;
  const urgent = mins <= 60;
  return (
    <div className={cx("me-1 hidden h-10 items-center gap-3 rounded-full px-4 text-[12.5px] md:flex", urgent ? "bg-glow-gold/15 text-glow-gold" : "bg-white/[0.06] text-tile-ink-3")}>
      <span className={cx("size-1.5 rounded-full", urgent ? "bg-glow-gold live-dot" : "bg-glow-green")} />
      <span className="num text-tile-ink" dir="ltr">RUH {fmt("Asia/Riyadh")}</span>
      {showPk && <span className="num" dir="ltr">PK {fmt("Asia/Karachi")}</span>}
      <span className="h-3 w-px bg-white/15" />
      <span className="num">{t("Close in {h}h {m}m", { h: Math.floor(mins / 60), m: mins % 60 })}</span>
    </div>
  );
}

/** Submit a hidden form after confirming. For destructive one-click actions. */
export function ConfirmAction({ action, fields, label, confirm, variant = "outline", size = "sm" }: {
  action: (fd: FormData) => Promise<void>; fields: Record<string, string>; label: ReactNode; confirm: string; variant?: Parameters<typeof btn>[0]; size?: Parameters<typeof btn>[1];
}) {
  return (
    <form action={action}>
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SubmitButton variant={variant} size={size} confirm={confirm}>{label}</SubmitButton>
    </form>
  );
}

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] ring-1 ring-line-strong hover:bg-surface print:hidden">
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z" /></svg>{label}
    </button>
  );
}
