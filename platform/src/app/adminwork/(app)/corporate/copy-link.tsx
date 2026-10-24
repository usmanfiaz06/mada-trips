"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { btn } from "@/components/ui";

/** The client's sign-in link with a one-click copy. */
export function CopyLink({ url }: { url: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-sunken p-1.5 ps-4">
      <a href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink hover:underline" dir="ltr">{url.replace(/^https?:\/\//, "")}</a>
      <button type="button" className={btn(done ? "soft" : "primary", "sm")}
        onClick={async () => { try { await navigator.clipboard.writeText(url); } catch { window.prompt(t("Copy the link"), url); } setDone(true); setTimeout(() => setDone(false), 2000); }}>
        {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{done ? t("Copied") : t("Copy link")}
      </button>
    </div>
  );
}
