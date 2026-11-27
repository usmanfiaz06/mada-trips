"use client";
import { useT } from "@/lib/i18n/client";

/**
 * Opt-in "send for approval" checkbox for directors. A director's actions apply on their own authority by
 * default; ticking this routes the action to the other directors instead. Render it only for directors — the
 * server action reads the `sendForApproval` field and treats it as `forceApproval`.
 */
export function ApprovalToggle({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <label className={`flex items-center gap-2 text-[12px] text-ink-3 ${className}`}>
      <input type="checkbox" name="sendForApproval" className="size-4 accent-[var(--gold)]" />
      {t("Send for approval instead of applying it now")}
    </label>
  );
}
