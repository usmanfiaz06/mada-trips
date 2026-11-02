"use client";
import { Printer } from "lucide-react";
import { useT } from "@/lib/i18n/client";

export function PrintButton() {
  const t = useT();
  return (
    <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-bg hover:opacity-85">
      <Printer className="size-4" />{t("Print / PDF")}
    </button>
  );
}
