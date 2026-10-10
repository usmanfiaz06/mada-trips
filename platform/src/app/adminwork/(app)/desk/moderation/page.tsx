import { desc, eq, isNull } from "drizzle-orm";
import { Ban, MapPin, ShieldAlert, ShieldCheck } from "lucide-react";
import { db, schema } from "@/db";
import { appUsers } from "@/db/app-schema";
import { appDeskBlocks } from "@/db/app-schema-desk";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { listModeration } from "@/lib/app/desk/adapters";
import { travellerName } from "@/lib/app/desk/core";
import { slaFor } from "@/lib/app/desk/sla";
import { Avatar, Badge, Card, Empty, Input, PageHeader, Tabs, cx, type Tone } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { SlaClock } from "@/components/desk/live";
import { moderateAction, unblockAction } from "../actions";

export const metadata = { title: "Moderation · Desk" };
const REASON: Record<string, string> = { unwanted: "Unwanted contact", impostor: "Pretending to be someone", unsafe: "Unsafe", other: "Something else" };
const DECISION: Record<string, { label: string; tone: Tone }> = { approved: { label: "Approved", tone: "ok" }, rejected: { label: "Rejected", tone: "bad" }, removed: { label: "Removed", tone: "bad" }, dismissed: { label: "Dismissed", tone: "neutral" } };

export default async function ModerationPage({ searchParams }: { searchParams: Promise<{ s?: string; focus?: string }> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const tab = sp.s === "decided" || sp.s === "blocked" ? sp.s : "open";
  const mod = can(u, "desk.moderate");
  const [open, decided, blocked] = await Promise.all([
    listModeration("open"), tab === "decided" ? listModeration("closed") : Promise.resolve([]),
    db.select({ b: appDeskBlocks, name: appUsers.name, by: schema.users.name }).from(appDeskBlocks).innerJoin(appUsers, eq(appUsers.id, appDeskBlocks.userId))
      .leftJoin(schema.users, eq(schema.users.id, appDeskBlocks.blockedBy)).where(isNull(appDeskBlocks.liftedAt)).orderBy(desc(appDeskBlocks.createdAt)),
  ]);
  const rows = tab === "open" ? open : decided;
  return (
    <>
      <PageHeader eyebrow={t("App desk")} title={t("Moderation")} subtitle={t("Tips travellers share in Circles, and what people report. Decide with a reason; the author reads it.")} />
      <Tabs active={tab} items={[
        { key: "open", label: t("To review"), count: open.length, href: "/adminwork/desk/moderation" },
        { key: "decided", label: t("Decided"), href: "/adminwork/desk/moderation?s=decided" },
        { key: "blocked", label: t("Blocked accounts"), count: blocked.length, href: "/adminwork/desk/moderation?s=blocked" },
      ]} />
      {tab === "blocked" ? (
        <Card pad={false}>
          {blocked.length === 0 ? <Empty icon={<ShieldCheck className="size-5" />} title={t("No blocked accounts")} /> : (
            <ul className="divide-y divide-line">
              {blocked.map(({ b, name, by }) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <Avatar name={name || "?"} size={36} />
                  <div className="min-w-0 flex-1"><div className="text-[14px] text-ink">{travellerName(name)}</div><div className="text-[12.5px] text-ink-3">{b.reason} · {t("by {name}", { name: by ?? "—" })} · {fmtDate(b.createdAt, L)}</div></div>
                  {mod && <form action={unblockAction}><input type="hidden" name="userId" value={b.userId} /><SubmitButton variant="outline" size="sm" confirm={t("Lift this block?")}>{t("Lift block")}</SubmitButton></form>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : rows.length === 0 ? <Card><Empty icon={<ShieldCheck className="size-5" />} title={tab === "open" ? t("Nothing to review") : t("Nothing decided yet")} hint={t("New tips and reports from the app land here.")} /></Card> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((m) => {
            const unsafe = m.kind === "report" && m.reason === "unsafe";
            const sla = m.status === "open" ? slaFor("moderation", m.createdAt, new Date(), { targetMinutes: unsafe ? 30 : undefined }) : null;
            return (
              <Card key={m.id} className={cx(sp.focus === m.id && "ring-2 ring-gold")}>
                <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                  {m.kind === "tip" ? <Badge tone="info">{t("Tip")}</Badge> : <Badge tone={unsafe ? "bad" : "warn"}><ShieldAlert className="size-3" />{t("Report")} · {t(REASON[m.reason ?? "other"] ?? "Something else")}</Badge>}
                  {sla && <SlaClock due={sla.dueAt.toISOString()} opened={sla.openedAt.toISOString()} />}
                  {m.status !== "open" && <Badge tone={DECISION[m.status]?.tone ?? "neutral"} dot>{t(DECISION[m.status]?.label ?? m.status)}</Badge>}
                  <span>· {timeAgo(m.createdAt, L)}</span>
                </div>
                <div className="mt-3 rounded-2xl bg-surface-2 p-4">
                  {(m.snapshot.place || m.snapshot.city) && <div className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-ink"><MapPin className="size-3.5 text-gold-2" />{m.snapshot.place}{m.snapshot.city ? ` · ${m.snapshot.city}` : ""}</div>}
                  <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink-2">{m.snapshot.text ?? t("No text")}</p>
                  <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-3"><Avatar name={m.authorName} size={22} />{m.authorName}{m.authorBlocked && <Badge tone="bad"><Ban className="size-3" />{t("Blocked")}</Badge>}{m.kind === "report" && <span>· {t("reported by {name}", { name: m.reporterName })}</span>}</div>
                  {m.note && <p className="mt-2 text-[12.5px] italic text-ink-3">“{m.note}”</p>}
                </div>
                {m.decisionReason && <p className="mt-3 text-[12.5px] text-ink-3">{t("Reason")}: {m.decisionReason}</p>}
                {m.status === "open" && (mod ? (
                  <ActionForm action={moderateAction} className="mt-4 space-y-2">
                    <input type="hidden" name="id" value={m.id} /><input type="hidden" name="source" value={m.source} /><input type="hidden" name="blockAuthor" value={m.authorUserId ?? ""} />
                    <Input name="reason" maxLength={200} placeholder={m.kind === "tip" ? t("Reason, if you reject it") : t("Reason, if you remove it")} />
                    <div className="flex flex-wrap items-center gap-2">
                      {m.kind === "tip" ? (
                        <><SubmitButton name="decision" value="approved" variant="gold" size="sm">{t("Approve")}</SubmitButton><SubmitButton name="decision" value="rejected" variant="outline" size="sm">{t("Reject")}</SubmitButton></>
                      ) : (
                        <><SubmitButton name="decision" value="removed" variant="danger" size="sm">{t("Remove it")}</SubmitButton><SubmitButton name="decision" value="dismissed" variant="outline" size="sm">{t("Dismiss report")}</SubmitButton></>
                      )}
                      {m.authorUserId && !m.authorBlocked && <label className="ms-auto inline-flex items-center gap-2 text-[12.5px] text-ink-3"><input type="checkbox" name="block" value="yes" className="size-4 accent-[var(--bad)]" />{t("Also block {name}", { name: m.authorName })}</label>}
                    </div>
                  </ActionForm>
                ) : <p className="mt-4 text-[12.5px] text-ink-3">{t("Moderation needs the desk moderation right.")}</p>)}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
