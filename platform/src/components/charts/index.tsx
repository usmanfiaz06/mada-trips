"use client";
import { useId, useMemo, useState, type ReactNode } from "react";
import { cx } from "../ui";

const fmt = (h: number) => (h / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });

/* Margin → colour on the ink tile. Diverging around the target margin:
   ember (loss) · neutral sand (below target) · green (at target) · mint (well above). Validated for CVD. */
function marginColor(bps: number, target: number) {
  if (bps < 0) return "var(--glow-ember)";
  if (bps < target) return "var(--glow-neutral)";
  if (bps < target * 1.6) return "var(--glow-green)";
  return "var(--glow-mint)";
}

export type BarcodeItem = { id: string; ref: string; day: number; sell: number; margin: number; label: string };

/**
 * The cycle barcode: every sale in the settlement cycle is one vertical line, placed by day,
 * height by value, coloured by margin. You can see the rhythm of the month at a glance.
 */
export function CycleBarcode({ items, days, today, target, dayLabels, emptyText, legend }: {
  items: BarcodeItem[]; days: number; today: number; target: number; dayLabels: string[]; emptyText: string;
  legend: { loss: string; thin: string; healthy: string };
}) {
  const [hover, setHover] = useState<BarcodeItem | null>(null);
  const W = 1000, H = 120;
  const max = Math.max(1, ...items.map((i) => i.sell));
  // Spread same-day sales across the day's slot so each line stays visible.
  const placed = useMemo(() => {
    const byDay = new Map<number, BarcodeItem[]>();
    for (const it of items) byDay.set(it.day, [...(byDay.get(it.day) ?? []), it]);
    const slot = W / days;
    return items.map((it) => {
      const group = byDay.get(it.day)!;
      const k = group.indexOf(it);
      const x = it.day * slot + ((k + 0.5) / group.length) * slot * 0.86 + slot * 0.07;
      const h = 18 + (Math.sqrt(it.sell / max)) * (H - 22);
      return { ...it, x, h };
    });
  }, [items, days, max]);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H + 26}`} className="h-[150px] w-full overflow-visible" preserveAspectRatio="none" role="img" aria-label="Sales this cycle">
        {/* day grid */}
        {Array.from({ length: days }).map((_, d) => (
          <line key={d} x1={(d * W) / days} x2={(d * W) / days} y1={H + 4} y2={H + (d % 5 === 0 ? 12 : 8)} stroke="var(--tile-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {/* future days fade */}
        <rect x={((today + 1) * W) / days} y={0} width={Math.max(0, W - ((today + 1) * W) / days)} height={H} fill="url(#future)" />
        <defs>
          <pattern id="future" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--tile-line)" strokeWidth="1" />
          </pattern>
        </defs>
        {placed.map((p) => (
          <g key={p.id} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}>
            <rect x={p.x - 5} y={0} width={10} height={H} fill="transparent" />
            <line x1={p.x} x2={p.x} y1={H} y2={H - p.h} stroke={marginColor(p.margin, target)} strokeWidth={hover?.id === p.id ? 4 : 2.2}
              strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={hover && hover.id !== p.id ? 0.35 : 0.95} style={{ transition: "opacity .15s" }} />
          </g>
        ))}
        {/* today marker */}
        <line x1={((today + 0.5) * W) / days} x2={((today + 0.5) * W) / days} y1={-4} y2={H + 14} stroke="var(--tile-ink)" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" opacity={0.5} />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-tile-ink-3 num" dir="ltr">
        {dayLabels.map((l, i) => <span key={i}>{l}</span>)}
      </div>
      {items.length === 0 && <div className="absolute inset-0 grid place-items-center text-[13px] text-tile-ink-3">{emptyText}</div>}
      {hover && (
        <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-2xl bg-[#f2f0e9] px-3 py-2 text-[12px] text-[#0d0f0e] shadow-float"
          style={{ left: `${(placed.find((p) => p.id === hover.id)!.x / W) * 100}%` }}>
          <div className="font-medium">{hover.ref} · {hover.label}</div>
          <div className="num opacity-70" dir="ltr">{fmt(hover.sell)} SAR · {(hover.margin / 100).toFixed(1)}%</div>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-4 text-[11.5px] text-tile-ink-3">
        <span className="flex items-center gap-1.5"><i className="h-3 w-[3px] rounded-full bg-glow-ember" />{legend.loss}</span>
        <span className="flex items-center gap-1.5"><i className="h-3 w-[3px] rounded-full bg-glow-neutral" />{legend.thin}</span>
        <span className="flex items-center gap-1.5"><i className="h-3 w-[3px] rounded-full bg-glow-green" /><i className="-ms-1 h-3 w-[3px] rounded-full bg-glow-mint" />{legend.healthy}</span>
      </div>
    </div>
  );
}

/** Half-ring gauge with a highlighted run and a marker, e.g. how far through the Day-25 cycle we are. */
export function ArcGauge({ value, max, children, highlightFrom, tone = "gold", ink }: {
  value: number; max: number; children?: ReactNode; highlightFrom?: number; tone?: "gold" | "green"; ink?: boolean;
}) {
  const r = 90, cx0 = 110, cy0 = 104, sw = 14;
  const f = Math.max(0, Math.min(1, value / max));
  const from = Math.max(0, Math.min(1, (highlightFrom ?? 0) / max));
  const pt = (t: number) => [cx0 - r * Math.cos(Math.PI * t), cy0 - r * Math.sin(Math.PI * t)] as const;
  const arc = (a: number, b: number) => { const [x1, y1] = pt(a), [x2, y2] = pt(b); return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`; };
  const color = tone === "gold" ? (ink ? "var(--glow-gold)" : "var(--gold)") : (ink ? "var(--glow-green)" : "var(--ok)");
  const [mx, my] = pt(f);
  return (
    <div className="relative">
      <svg viewBox="0 0 220 118" className="w-full" aria-hidden>
        <path d={arc(0, 1)} fill="none" stroke={ink ? "var(--tile-line)" : "var(--sunken)"} strokeWidth={sw} strokeLinecap="round" />
        <path d={arc(0, 1)} fill="none" stroke={ink ? "rgb(242 240 233 / .12)" : "var(--line-strong)"} strokeWidth={1} strokeDasharray="1 5" transform={`translate(0 ${-sw})`} opacity={0} />
        {f > 0 && <path d={arc(from, Math.max(from + 0.001, f))} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" style={{ transition: "all .8s cubic-bezier(.2,.7,.2,1)" }} />}
        <circle cx={mx} cy={my} r={5} fill={ink ? "var(--tile)" : "var(--surface)"} stroke={color} strokeWidth={3} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">{children}</div>
    </div>
  );
}

/** The Mada sun: radial rays over a half circle. Lit rays = share covered (e.g. IATA reserve vs next BSP debits). */
export function SunGauge({ value, max, rays = 44, children, ink }: { value: number; max: number; rays?: number; children?: ReactNode; ink?: boolean }) {
  const f = max > 0 ? Math.max(0, Math.min(1, value / max)) : 1;
  const lit = Math.round(f * rays);
  const cx0 = 150, cy0 = 150;
  const id = useId();
  return (
    <div className="relative">
      <svg viewBox="0 0 300 160" className="w-full" aria-hidden>
        <defs>
          <radialGradient id={id} cx="50%" cy="100%" r="60%">
            <stop offset="0%" stopColor={ink ? "var(--glow-gold)" : "var(--gold)"} stopOpacity={0.22 * f + 0.05} />
            <stop offset="100%" stopColor={ink ? "var(--glow-gold)" : "var(--gold)"} stopOpacity={0} />
          </radialGradient>
        </defs>
        <circle cx={cx0} cy={cy0} r={120} fill={`url(#${id})`} />
        {Array.from({ length: rays }).map((_, i) => {
          const a = Math.PI * (i / (rays - 1));
          const long = i % 4 === 0;
          const r1 = 70, r2 = long ? 134 : 118;
          const on = i < lit;
          return (
            <line key={i} x1={cx0 - r1 * Math.cos(a)} y1={cy0 - r1 * Math.sin(a)} x2={cx0 - r2 * Math.cos(a)} y2={cy0 - r2 * Math.sin(a)}
              stroke={on ? (ink ? "var(--glow-gold)" : "var(--gold)") : ink ? "var(--tile-line)" : "var(--line-strong)"}
              strokeWidth={on ? 2 : 1.2} strokeLinecap="round" style={{ transition: `stroke .4s ${i * 12}ms` }} />
          );
        })}
        <circle cx={cx0} cy={cy0} r={58} fill="none" stroke={ink ? "var(--tile-line)" : "var(--line)"} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">{children}</div>
    </div>
  );
}

/** Dot-matrix columns: each column is a day, each dot a unit. Hover to read the day. */
export function DotColumns({ data, unit, color = "var(--chart-1)", rows = 10, ink }: {
  data: { label: string; value: number; display: string }[]; unit: number; color?: string; rows?: number; ink?: boolean;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const max = Math.max(unit, ...data.map((d) => d.value));
  const per = max / rows;
  return (
    <div className="relative">
      <div className="flex items-end justify-between gap-[3px]" onMouseLeave={() => setHi(null)}>
        {data.map((d, i) => {
          const n = d.value > 0 ? Math.max(1, Math.round(d.value / per)) : 0;
          return (
            <button key={i} type="button" onMouseEnter={() => setHi(i)} onFocus={() => setHi(i)} className="group flex flex-1 flex-col-reverse items-center gap-[3px] py-1 outline-none" aria-label={`${d.label}: ${d.display}`}>
              {Array.from({ length: rows }).map((_, k) => (
                <span key={k} className="aspect-square w-full max-w-[7px] rounded-full transition-opacity"
                  style={{ background: k < n ? color : ink ? "var(--tile-line)" : "var(--sunken)", opacity: hi !== null && hi !== i && k < n ? 0.35 : 1 }} />
              ))}
            </button>
          );
        })}
      </div>
      <div className={cx("mt-2 flex justify-between text-[10.5px] num", ink ? "text-tile-ink-3" : "text-ink-4")} dir="ltr">
        <span>{data[0]?.label}</span><span>{data[data.length - 1]?.label}</span>
      </div>
      {hi !== null && (
        <div className="pointer-events-none absolute -top-3 z-10 -translate-x-1/2 -translate-y-full rounded-xl bg-ink px-2.5 py-1.5 text-[12px] text-bg shadow-float"
          style={{ left: `${((hi + 0.5) / data.length) * 100}%` }}>
          <span className="opacity-60">{data[hi].label}</span> <span className="num" dir="ltr">{data[hi].display}</span>
        </div>
      )}
    </div>
  );
}

/** Two-part split bar with direct labels (retail vs corporate etc). */
export function SplitBar({ parts }: { parts: { label: string; value: number; color: string; display: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
        {parts.map((p) => <div key={p.label} className="h-full first:rounded-s-full last:rounded-e-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color, minWidth: p.value ? 4 : 0 }} />)}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {parts.map((p) => (
          <div key={p.label}>
            <div className="flex items-center gap-1.5 text-[12px] text-ink-3"><i className="size-2 rounded-full" style={{ background: p.color }} />{p.label}</div>
            <div className="num mt-0.5 text-[15px] text-ink" dir="ltr">{p.display}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
