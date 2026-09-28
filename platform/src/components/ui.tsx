import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { sar } from "@/lib/money";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ───────── Layout ───────── */

export function PageHeader({ eyebrow, title, subtitle, actions, children }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-ink-3"><span className="size-1.5 rounded-full bg-gold" />{eyebrow}</div>}
          <h1 className="text-[34px] font-[380] leading-[1.05] tracking-[-0.035em] text-ink">{title}</h1>
          {subtitle && <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-3">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function Card({ className, children, pad = true, ...rest }: ComponentProps<"section"> & { pad?: boolean }) {
  return <section {...rest} className={cx("rounded-card bg-surface shadow-card", pad && "p-6", className)}>{children}</section>;
}

/** The dark "ink" tile used for hero numbers and signature charts. Dark in both themes. */
export function InkCard({ className, children, pad = true, grain, ...rest }: ComponentProps<"section"> & { pad?: boolean; grain?: boolean }) {
  return <section {...rest} className={cx("night relative overflow-hidden rounded-card", grain && "grain", pad && "p-6", className)}>{children}</section>;
}

export function CardHead({ title, hint, action, className }: { title: ReactNode; hint?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-4 flex items-start justify-between gap-3", className)}>
      <div>
        <h2 className="text-[17px] font-[450] tracking-[-0.02em]">{title}</h2>
        {hint && <p className="mt-0.5 text-[13px] opacity-60">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function Grid({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("grid gap-4", className)}>{children}</div>;
}

/* ───────── Buttons ───────── */

type Variant = "primary" | "gold" | "ghost" | "outline" | "danger" | "soft";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-bg hover:opacity-85",
  gold: "bg-gold text-[#1a140a] hover:brightness-105 shadow-[0_8px_24px_-10px_var(--gold)]",
  outline: "border border-line-strong bg-transparent text-ink hover:bg-surface hover:border-ink-4",
  ghost: "text-ink-2 hover:bg-sunken hover:text-ink",
  soft: "bg-sunken text-ink hover:bg-line",
  danger: "bg-bad text-white hover:opacity-90",
};
const sizes = { sm: "h-8 px-3.5 text-[13px] gap-1.5 rounded-full", md: "h-10 px-5 text-[14px] gap-2 rounded-full", lg: "h-[52px] px-7 text-[15px] gap-2 rounded-full" };

export function btn(variant: Variant = "primary", size: keyof typeof sizes = "md", extra?: string) {
  return cx("inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background,color,border,box-shadow,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50", variants[variant], sizes[size], extra);
}

export function Button({ variant, size, className, ...rest }: ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <button {...rest} className={btn(variant, size, className)} />;
}

export function LinkButton({ variant, size, className, ...rest }: ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <Link {...rest} className={btn(variant, size, className)} />;
}

/* ───────── Data display ───────── */

export function Money({ v, className, sign, compact, muted }: { v: number; className?: string; sign?: boolean; compact?: boolean; muted?: boolean }) {
  return (
    <span className={cx("num whitespace-nowrap", className)} dir="ltr">
      {sar(v, { sign, compact })}
      {!muted && <span className="ms-1 text-[0.72em] font-medium text-ink-4">SAR</span>}
    </span>
  );
}

const tones = {
  neutral: "bg-sunken text-ink-2",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  gold: "bg-gold-soft text-gold-2",
  brand: "bg-brand text-brand-ink",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[12px] font-medium", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, tone, icon, href }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone; icon?: ReactNode; href?: string }) {
  const body = (
    <Card className={cx("group relative flex h-full flex-col overflow-hidden transition", href && "hover:-translate-y-0.5 hover:shadow-float")}>
      <div className="flex items-center justify-between text-[13px] text-ink-3">
        <span>{label}</span>
        {icon && <span className={cx("grid size-8 place-items-center rounded-full", tone ? tones[tone] : "bg-sunken text-ink-3")}>{icon}</span>}
      </div>
      <div className="figure mt-auto pt-6 text-[40px] text-ink">{value}</div>
      {sub && <div className="mt-2 text-[12.5px] text-ink-3">{sub}</div>}
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export function Empty({ icon, title, hint, action }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-4 grid size-12 place-items-center rounded-full bg-sunken text-ink-3">{icon}</div>}
      <div className="text-[14.5px] font-semibold text-ink">{title}</div>
      {hint && <div className="mt-1 max-w-sm text-[13px] text-ink-3">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function KV({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx("grid gap-x-6 gap-y-4", cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3")}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[12px] font-medium text-ink-3">{k}</dt>
          <dd className="mt-0.5 truncate text-[14px] text-ink">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Avatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const initials = name.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className={cx("inline-grid shrink-0 place-items-center rounded-full font-semibold text-white ring-2 ring-surface", className)}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, hsl(${h} 32% 36%), hsl(${(h + 40) % 360} 38% 26%))` }}>
      {initials}
    </span>
  );
}

/* ───────── Tables ───────── */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[13.5px]">{children}</table>
    </div>
  );
}
export function Th({ children, className, align }: { children?: ReactNode; className?: string; align?: "end" }) {
  return <th className={cx("whitespace-nowrap border-b border-line px-4 py-3 text-[12px] font-normal text-ink-3 first:ps-6 last:pe-6", align === "end" ? "text-end" : "text-start", className)}>{children}</th>;
}
export function Td({ children, className, align }: { children?: ReactNode; className?: string; align?: "end" }) {
  return <td className={cx("border-b border-line px-4 py-3.5 align-middle text-ink-2 first:ps-6 last:pe-6 [tr:last-child_&]:border-0", align === "end" && "text-end", className)}>{children}</td>;
}
export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="font-medium text-ink decoration-gold decoration-2 underline-offset-4 hover:underline">{children}</Link>;
}

/* ───────── Forms ───────── */

export function Field({ label, hint, children, className, required }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 flex items-center gap-1 text-[12.5px] text-ink-3">
        {label}{required && <span className="text-gold-2">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-3">{hint}</span>}
    </label>
  );
}

export function Input(props: ComponentProps<"input">) { return <input {...props} className={cx("field", props.className)} />; }
export function Textarea(props: ComponentProps<"textarea">) { return <textarea {...props} className={cx("field", props.className)} />; }
export function Select({ options, placeholder, ...props }: ComponentProps<"select"> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select {...props} className={cx("field", props.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Segmented({ name, options, defaultValue }: { name: string; options: { value: string; label: ReactNode }[]; defaultValue?: string }) {
  return (
    <div className="inline-flex w-full rounded-full bg-sunken p-1">
      {options.map((o) => (
        <label key={o.value} className="flex-1">
          <input type="radio" name={name} value={o.value} defaultChecked={o.value === defaultValue} className="peer sr-only" />
          <span className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 text-[13px] text-ink-3 transition peer-checked:bg-ink peer-checked:text-bg peer-focus-visible:ring-2 peer-focus-visible:ring-gold">{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export function Tabs({ items, active }: { items: { href: string; label: ReactNode; count?: number; key: string }[]; active: string }) {
  return (
    <nav className="mb-5 flex gap-1.5 overflow-x-auto pb-1">
      {items.map((it) => (
        <Link key={it.key} href={it.href}
          className={cx("flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13.5px] transition",
            it.key === active ? "bg-ink text-bg" : "bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink")}>
          {it.label}
          {typeof it.count === "number" && it.count > 0 && <span className={cx("num rounded-full px-1.5 text-[11px]", it.key === active ? "bg-gold text-[#1a140a]" : "bg-sunken text-ink-2")}>{it.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Notice({ tone = "info", title, children, icon }: { tone?: Tone; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className={cx("flex gap-3 rounded-2xl px-4 py-3.5 text-[13.5px]", tones[tone])}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div>
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className="opacity-90">{children}</div>}
      </div>
    </div>
  );
}

/** Progress bar that shows a part of a whole. */
export function Meter({ value, max, tone = "brand" }: { value: number; max: number; tone?: "brand" | "gold" | "bad" | "warn" | "ok" }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color = { brand: "bg-brand", gold: "bg-gold", bad: "bg-bad", warn: "bg-warn", ok: "bg-ok" }[tone];
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"><div className={cx("h-full rounded-full transition-[width] duration-700", color)} style={{ width: `${pct}%` }} /></div>;
}
