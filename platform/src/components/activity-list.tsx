import Link from "next/link";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { Avatar } from "./ui";

export type ActivityItem = { id: number; at: Date; actorName: string | null; action: string; entityType: string; entityId: string | null; entityRef: string | null; summary: string; changes: unknown; ip: string | null };

const HREF: Record<string, (id: string) => string> = {
  booking: (id) => `/adminwork/sales/${id}`, expense: (id) => `/adminwork/expenses/${id}`, client: (id) => `/adminwork/clients/${id}`, approval: (id) => `/adminwork/approvals/${id}`,
  settlement: (id) => `/adminwork/settlement/${id}`, user: (id) => `/adminwork/team/${id}`, role: (id) => `/adminwork/team/roles/${id}`,
  task: (id) => `/adminwork/tasks/${id}`, lead: (id) => `/adminwork/leads/${id}`,
};
const DOT: Record<string, string> = { approval: "bg-gold", booking: "bg-[var(--chart-1)]", expense: "bg-[var(--chart-2)]", user: "bg-info", role: "bg-info", close: "bg-ink-3", settlement: "bg-gold", auth: "bg-ink-4", task: "bg-ok", lead: "bg-gold" };

/** Activity grouped by day: who did what, when, with a link to the record. */
export async function ActivityList({ items, showIp }: { items: ActivityItem[]; showIp?: boolean }) {
  const t = await getT();
  const L = t.locale;
  const groups = new Map<string, ActivityItem[]>();
  for (const it of items) {
    const d = fmtDate(it.at, L);
    groups.set(d, [...(groups.get(d) ?? []), it]);
  }
  return (
    <div className="space-y-8">
      {[...groups.entries()].map(([day, list]) => (
        <section key={day}>
          <h3 className="sticky top-24 z-10 mb-2 inline-block rounded-full bg-bg/90 px-3 py-1 text-[12px] text-ink-3 backdrop-blur">{day}</h3>
          <ol className="rounded-card bg-surface shadow-card">
            {list.map((e) => {
              const href = e.entityId && HREF[e.entityType]?.(e.entityId);
              const ch = e.changes && typeof e.changes === "object" && !Array.isArray(e.changes) ? Object.entries(e.changes as Record<string, { from?: unknown; to?: unknown }>).filter(([, v]) => v && typeof v === "object" && "from" in v) : [];
              return (
                <li key={e.id} className="flex gap-4 border-b border-line px-6 py-4 last:border-0">
                  <span className="num w-12 shrink-0 pt-1 text-[12px] text-ink-3" dir="ltr">{new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(e.at)}</span>
                  <Avatar name={e.actorName ?? "System"} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] leading-snug"><span className="font-medium text-ink">{e.actorName ?? t("System")}</span> <span className="text-ink-2">{e.summary}</span></div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
                      <span className="flex items-center gap-1.5"><span className={`size-1.5 rounded-full ${DOT[e.entityType] ?? DOT[e.action.split(".")[0]] ?? "bg-ink-4"}`} /><span className="font-mono text-[11.5px]">{e.action}</span></span>
                      {href && <Link href={href} className="underline decoration-gold decoration-2 underline-offset-4 hover:text-ink">{e.entityRef ?? t("Open")}</Link>}
                      {showIp && e.ip && <span className="font-mono text-[11px]" dir="ltr">{e.ip}</span>}
                    </div>
                    {ch.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {ch.map(([k, v]) => <span key={k} className="max-w-full truncate rounded-lg bg-sunken px-2 py-0.5 text-[12px] text-ink-2">{k}: <s className="text-ink-4">{String(v.from ?? "—")}</s> → {String(v.to ?? "—")}</span>)}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
