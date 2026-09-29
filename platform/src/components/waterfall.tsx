import { sar } from "@/lib/money";

/** Classic waterfall: gross profit, then each priority takes its slice, ending in what partners receive. */
export function Waterfall({ gross, steps, labels }: { gross: number; steps: { key: string; amount: number }[]; labels: Record<string, string> }) {
  const W = 760, H = 260, pad = 28, barW = 92;
  const max = Math.max(gross, 1);
  const y = (v: number) => H - pad - (Math.max(0, v) / max) * (H - pad * 2);
  const cols = [{ key: "gross", from: 0, to: gross, tone: "var(--ink)" }];
  let level = gross;
  for (const s of steps) {
    if (s.key === "dividend") { cols.push({ key: s.key, from: 0, to: s.amount, tone: "var(--chart-1)" }); continue; }
    cols.push({ key: s.key, from: level - s.amount, to: level, tone: "var(--line-strong)" });
    level -= s.amount;
  }
  const gap = (W - cols.length * barW) / (cols.length - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H + 40}`} className="w-full" role="img" aria-label="Day-25 waterfall">
      <line x1={0} x2={W} y1={H - pad} y2={H - pad} stroke="var(--line-strong)" />
      {cols.map((c, i) => {
        const x = i * (barW + gap);
        const top = y(c.to), bottom = y(c.from);
        const h = Math.max(2, bottom - top);
        const next = cols[i + 1];
        return (
          <g key={c.key}>
            <rect x={x} y={top} width={barW} height={h} rx={10} fill={c.tone} style={{ transition: "all .6s" }} />
            {next && next.key !== "dividend" && <line x1={x + barW} x2={x + barW + gap} y1={c.key === "gross" ? top : top} y2={c.key === "gross" ? top : top} stroke="var(--ink-4)" strokeDasharray="3 3" />}
            <text x={x + barW / 2} y={top - 10} textAnchor="middle" className="num" fontSize="13" fill="var(--ink)">{c.key === "gross" || c.key === "dividend" ? "" : "−"}{sar(c.to - c.from, { compact: true })}</text>
            <text x={x + barW / 2} y={H + 2} textAnchor="middle" fontSize="12" fill="var(--ink-3)">{labels[c.key]}</text>
          </g>
        );
      })}
    </svg>
  );
}
