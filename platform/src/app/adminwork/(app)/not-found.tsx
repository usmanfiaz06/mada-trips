import Link from "next/link";
import { getT } from "@/lib/i18n";
import { btn } from "@/components/ui";

export default async function NotFound() {
  const t = await getT();
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <div className="figure text-[120px] text-ink-4">404</div>
        <h1 className="mt-2 text-[24px] font-[400] tracking-[-0.02em]">{t("This page doesn't exist, or you don't have access to it")}</h1>
        <Link href="/adminwork" className={btn("primary", "md", "mt-6")}>{t("Back to dashboard")}</Link>
      </div>
    </main>
  );
}
