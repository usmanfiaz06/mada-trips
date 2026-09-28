import { Check, X } from "lucide-react";
import { cx } from "./ui";

/** Compact vote tracker: one dot per approver, filled as they vote. */
export function VoteDots({ approvers, required }: { approvers: { name: string; decision: string | null }[]; required: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {approvers.map((a, i) => (
        <span key={i} title={`${a.name}: ${a.decision ?? "waiting"}`}
          className={cx("grid size-7 place-items-center rounded-full text-[10.5px] font-medium ring-2 ring-surface",
            a.decision === "approve" ? "bg-ok text-white" : a.decision === "reject" ? "bg-bad text-white" : "bg-sunken text-ink-3")}>
          {a.decision === "approve" ? <Check className="size-3.5" strokeWidth={3} /> : a.decision === "reject" ? <X className="size-3.5" strokeWidth={3} /> : a.name.slice(0, 2).toUpperCase()}
        </span>
      ))}
      <span className="ms-1.5 text-[12px] text-ink-3 num">{approvers.filter((a) => a.decision === "approve").length}/{required}</span>
    </div>
  );
}
