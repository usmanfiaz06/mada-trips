import Link from "next/link";
import { desc, eq, ne } from "drizzle-orm";
import { ArrowUpRight, Stamp } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { pendingForUser } from "@/lib/approvals";
import { voteBoard } from "@/lib/approval-view";
import { APPROVAL_KIND, APPROVAL_STATUS } from "@/lib/labels";
import { timeAgo } from "@/lib/dates";
import { sar } from "@/lib/money";
import { Badge, Card, Empty, PageHeader, Tabs, cx } from "@/components/ui";
import { VoteDots } from "@/components/votes";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const u = await requireUser();
  const t = await getT();
  const { tab: rawTab } = await searchParams;
  const mineWaiting = await db.transaction((tx) => pendingForUser(tx, u.id));
  const oversight = u.permissions.has("approvals.decide") || u.permissions.has("expenses.verify");
  const tab = oversight ? rawTab ?? (mineWaiting.length ? "mine" : "requests") : "requests";

  const users = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users);
  const nameOf = (id: string) => users.find((x) => x.id === id)?.name ?? "—";

  let list: (typeof schema.approvalRequests.$inferSelect)[] = [];
  if (tab === "mine") list = mineWaiting;
  else if (tab === "requests") list = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.requestedBy, u.id)).orderBy(desc(schema.approvalRequests.createdAt)).limit(50);
  else if (tab === "pending" && oversight) list = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.status, "pending")).orderBy(desc(schema.approvalRequests.createdAt));
  else if (oversight) list = await db.select().from(schema.approvalRequests).where(ne(schema.approvalRequests.status, "pending")).orderBy(desc(schema.approvalRequests.decidedAt)).limit(60);
  const board = await voteBoard(list);

  return (
    <>
      <PageHeader eyebrow={t("Governance")} title={t("Approvals")}
        subtitle={t("Credit up to SAR 20,000 needs any two directors; above that, all directors. Expenses are verified by someone other than the submitter.")} />
      <Tabs active={tab} items={[
        ...(oversight ? [{ key: "mine", label: t("Waiting for my vote"), count: mineWaiting.length, href: "/adminwork/approvals?tab=mine" }] : []),
        { key: "requests", label: t("My requests"), href: "/adminwork/approvals?tab=requests" },
        ...(oversight ? [{ key: "pending", label: t("All pending"), href: "/adminwork/approvals?tab=pending" }, { key: "history", label: t("Decided"), href: "/adminwork/approvals?tab=history" }] : []),
      ]} />
      {list.length === 0 ? (
        <Card><Empty icon={<Stamp className="size-5" />} title={tab === "mine" ? t("Nothing needs your vote") : t("Nothing here yet")} hint={t("Requests appear here the moment someone submits one.")} /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 stagger">
          {list.map((r) => {
            const v = board.get(r.id)!;
            const st = APPROVAL_STATUS[r.status];
            return (
              <Link key={r.id} href={`/adminwork/approvals/${r.id}`} className="group">
                <Card className={cx("flex h-full flex-col transition group-hover:-translate-y-0.5 group-hover:shadow-float", tab === "mine" && "ring-1 ring-gold/40")}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><Badge tone="gold">{t(APPROVAL_KIND[r.kind])}</Badge><span className="num text-[12px] text-ink-3">{r.ref}</span></div>
                    <Badge tone={st.tone} dot>{t(st.label)}</Badge>
                  </div>
                  <div className="mt-4 line-clamp-2 text-[15.5px] leading-snug">{r.title}</div>
                  <div className="figure mt-4 text-[34px]" dir="ltr">{sar(r.amount)}<span className="figure-unit">SAR</span></div>
                  {r.reason && <p className="mt-2 line-clamp-2 text-[13px] text-ink-3">“{r.reason}”</p>}
                  <div className="mt-auto flex items-center justify-between border-t border-line pt-4 mt-5">
                    <VoteDots approvers={v.approvers} required={r.requiredApprovals} />
                    <span className="flex items-center gap-1 text-[12px] text-ink-3">{nameOf(r.requestedBy).split(" ")[0]} · {timeAgo(r.createdAt, t.locale)}<ArrowUpRight className="size-3.5 rtl:-scale-x-100" /></span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
