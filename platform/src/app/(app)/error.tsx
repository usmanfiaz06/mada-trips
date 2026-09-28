"use client";
import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import { btn } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <div className="figure text-[64px] text-ink-4">!</div>
      <h1 className="mt-4 text-[24px] font-[400] tracking-[-0.02em]">{t("Something went wrong on this page")}</h1>
      <p className="mt-2 text-[14px] text-ink-3">{t("Nothing was saved. Try again, or go back to the dashboard.")}</p>
      {error.digest && <p className="mt-2 font-mono text-[11px] text-ink-4">{error.digest}</p>}
      <div className="mt-6 flex justify-center gap-2">
        <button onClick={reset} className={btn("primary")}>{t("Try again")}</button>
        <Link href="/" className={btn("outline")}>{t("Dashboard")}</Link>
      </div>
    </div>
  );
}
