import { Check } from "lucide-react";
import { cx } from "./ui";

export type JourneyStep = { label: string; state: "done" | "current" | "todo" | "skipped" | "failed"; meta?: string };

/** The lifecycle of a record, so people always know where it is and what comes next. */
export function Journey({ steps }: { steps: JourneyStep[] }) {
  return (
    <ol className="grid gap-y-4" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => (
        <li key={i} className="relative">
          {i < steps.length - 1 && (
            <span className={cx("absolute top-[13px] h-[2px] start-[30px] end-[-2px] rounded-full", s.state === "done" ? "bg-ok" : "bg-line")} />
          )}
          <span className={cx("relative z-[1] grid size-7 place-items-center rounded-full text-[12px] transition",
            s.state === "done" && "bg-ok text-white",
            s.state === "current" && "bg-gold text-[#1a140a] ring-4 ring-gold/25",
            s.state === "failed" && "bg-bad text-white",
            s.state === "todo" && "bg-sunken text-ink-3",
            s.state === "skipped" && "bg-sunken text-ink-4")}>
            {s.state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : s.state === "failed" ? "×" : i + 1}
          </span>
          <div className={cx("mt-2.5 pe-3 text-[13px]", s.state === "todo" || s.state === "skipped" ? "text-ink-3" : "text-ink")}>{s.label}</div>
          {s.meta && <div className="mt-0.5 pe-3 text-[11.5px] leading-snug text-ink-3">{s.meta}</div>}
        </li>
      ))}
    </ol>
  );
}
