import Link from "next/link";
import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { getT } from "@/lib/i18n";
import { LinkButton } from "../ui";

/*
 * The Ops list pattern for desk lists (as on Sales & bookings): a search and filter form whose values live in the URL,
 * a summary strip, then the table, then pages of 50.
 */

type Params = Record<string, string | undefined>;

/** Builds a list URL from the current params with some changed (undefined drops a key). */
export function listHref(path: string, sp: Params) {
  return (o: Params = {}) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]);
    const s = p.toString();
    return s ? `${path}?${s}` : path;
  };
}

/** The page number from ?page=, and the offset it reads from. */
export function pageParam(sp: Params, size = 50) {
  const page = Math.max(1, Math.floor(Number(sp.page ?? 1)) || 1);
  return { page, offset: (page - 1) * size, size };
}

export async function ListFilter({ action, q, placeholder, keep = {}, clear, children }: {
  action: string; q?: string; placeholder: string; keep?: Params; clear?: string | null; children?: ReactNode;
}) {
  const t = await getT();
  return (
    <form className="flex flex-wrap items-center gap-2 p-4" action={action} role="search">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <input name="q" type="search" defaultValue={q} placeholder={placeholder} className="field ps-10" aria-label={t("Search")} />
      </div>
      {children}
      <button className="h-[42px] rounded-full bg-ink px-5 text-[13.5px] text-bg">{t("Filter")}</button>
      {clear && <Link href={clear} className="px-2 text-[13px] text-ink-3 hover:text-ink">{t("Clear")}</Link>}
    </form>
  );
}

export function SummaryStrip({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-x-8 gap-y-1 border-y border-line bg-surface-2 px-6 py-3 text-[13px] text-ink-3">{children}</div>;
}

export async function Pager({ page, total, size = 50, href }: { page: number; total: number; size?: number; href: (o: Params) => string }) {
  const t = await getT();
  const pages = Math.ceil(total / size);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-line px-6 py-3 text-[13px] text-ink-3">
      <span>{t("Page {p} of {n}", { p: page, n: pages })}</span>
      <div className="flex gap-2">
        {page > 1 && <LinkButton href={href({ page: page - 1 > 1 ? String(page - 1) : undefined })} variant="outline" size="sm">{t("Previous")}</LinkButton>}
        {page < pages && <LinkButton href={href({ page: String(page + 1) })} variant="outline" size="sm">{t("Next")}</LinkButton>}
      </div>
    </div>
  );
}
