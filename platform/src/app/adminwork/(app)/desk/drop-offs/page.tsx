import Link from "next/link";
import { LayoutList, MessageCircle, Phone, TicketPlus, TrendingDown } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { sar } from "@/lib/money";
import { DROPOFF_KIND, DROPOFF_MARK, DROPOFF_STEP } from "@/lib/labels";
import { PAGE_SIZE } from "@/lib/app/desk/adapters";
import { customerHref } from "@/lib/app/desk/board";
import { DROPOFF_TABS, NUDGE_HOURS, canNudge, getDropoff, pageDropoffs, savedReplies } from "@/lib/app/desk/dropoffs";
import { Card, CardHead, Empty, KV, LinkButton, Money, PageHeader, Table, Tabs, Td, Textarea, Th, btn, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { StatusBadge } from "@/components/desk/parts";
import { AutoRefresh } from "@/components/desk/live";
import { ListFilter, Pager, SummaryStrip, listHref, pageParam } from "@/components/desk/list";
import { markDropoffAction, nudgeDropoffAction } from "../dropoff-actions";

export const metadata = { title: "Drop-offs · Desk" };
const TAB_LABEL: Record<string, string> = { open: "All open", search: "Searched", sheet: "Pay sheet", payment: "Payment failed", held: "Held, not paid", closed: "Recovered or ignored" };
const wa = (phone: string) => `https://wa.me/${phone.replace(/[^0-9]/g, "")}`;

export default async function DropoffsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const { page, offset } = pageParam(sp, PAGE_SIZE);
  const [data, canned] = await Promise.all([pageDropoffs({ tab: sp.s, q: sp.q, offset }), savedReplies()]);
  const href = listHref("/adminwork/desk/drop-offs", { s: sp.s, q: sp.q, page: sp.page });
  // The rail shows the drop-off picked in the table, else the newest one on this page.
  const f = (sp.focus ? data.rows.find((r) => r.key === sp.focus) ?? await getDropoff(sp.focus) : null) ?? data.rows[0] ?? null;
  const act = can(u, "desk.act");
  const nudgeOk = f ? canNudge(f) : false;
  return (
    <>
      <AutoRefresh every={30} />
      <PageHeader eyebrow={t("App bookings")} title={t("Drop-offs")}
        subtitle={t("People who left halfway: a search, a pay sheet, a card that didn't go through, a price held and not paid. Nudge them in the app within 48 hours; call or WhatsApp only if they gave a number on a request.")}
        actions={<LinkButton href="/adminwork/desk/bookings" variant="outline"><LayoutList className="size-4" />{t("Live board")}</LinkButton>} />
      <Tabs active={data.tab} items={DROPOFF_TABS.map((s) => ({ key: s, label: t(TAB_LABEL[s]!), href: listHref("/adminwork/desk/drop-offs", { q: sp.q })({ s: s === "open" ? undefined : s }), count: data.counts[s] }))} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card pad={false} className="min-w-0 self-start">
          <ListFilter action="/adminwork/desk/drop-offs" q={sp.q} keep={{ s: sp.s }} placeholder={t("Traveller, phone, what they looked at…")} clear={sp.q ? listHref("/adminwork/desk/drop-offs", { s: sp.s })() : null} />
          <SummaryStrip>
            <span>{t("{n} drop-offs", { n: data.total })}</span>
            <span>{t("Value")} <span className="num text-ink" dir="ltr">{sar(data.value)}</span></span>
            {data.tab !== "closed" && <span>{t("Recovered or ignored")} <span className="num text-ink">{data.counts.closed}</span></span>}
          </SummaryStrip>
          {data.rows.length === 0 ? <Empty icon={<TrendingDown className="size-5" />} title={sp.q ? t("No drop-offs match") : t("Nobody left halfway")} hint={sp.q ? t("Try a different filter or search.") : t("Someone who searches, opens the pay sheet or has a card declined and doesn't book shows up here.")} /> : (
            <Table>
              <thead><tr><Th>{t("Traveller")}</Th><Th>{t("What")}</Th><Th>{t("Where they stopped")}</Th><Th>{t("When")}</Th><Th align="end">{t("Value")}</Th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key} className={cx("group transition hover:bg-surface-2", f?.key === r.key && "bg-gold-soft/40")}>
                    <Td className="whitespace-nowrap"><Link href={href({ focus: r.key })} scroll={false} className="block" aria-current={f?.key === r.key ? "true" : undefined}>
                      <bdi className="block text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{r.userName}</bdi>
                      {r.phone && <span className="num block text-[12px] text-ink-3" dir="ltr">{r.phone}</span>}</Link></Td>
                    <Td><span className="block max-w-[240px] truncate text-ink">{r.what}</span><span className="block pt-0.5"><StatusBadge map={DROPOFF_KIND} value={r.kind} /></span></Td>
                    <Td className="whitespace-nowrap">{t(DROPOFF_STEP[r.step] ?? r.step)}{r.mark ? <span className="block pt-1"><StatusBadge map={DROPOFF_MARK} value={r.mark} /></span> : r.nudgedAt ? <span className="block pt-1 text-[12px] text-ink-3">{t("Nudged {when}", { when: timeAgo(r.nudgedAt, L) })}</span> : null}</Td>
                    <Td className="whitespace-nowrap text-[12.5px] text-ink-3">{timeAgo(r.at, L)}{r.attempts > 1 && <span className="block">{t("{n} tries", { n: r.attempts })}</span>}</Td>
                    <Td align="end">{r.value ? <Money v={r.value} /> : <span className="text-ink-4">—</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pager page={page} total={data.total} size={PAGE_SIZE} href={href} />
        </Card>

        <aside className="space-y-4">
          {!f ? null : (
            <>
              <Card className={cx(!f.mark && "ring-2 ring-gold/40")}>
                <CardHead title={f.what} hint={<><bdi>{f.userName}</bdi> · {timeAgo(f.at, L)}</>} action={f.mark ? <StatusBadge map={DROPOFF_MARK} value={f.mark} /> : <StatusBadge map={DROPOFF_KIND} value={f.kind} />} />
                <div className="mb-4 flex items-baseline justify-between border-b border-line pb-4"><span className="text-[13px] text-ink-3">{t("Value")}</span><Money v={f.value} className="text-[26px] font-[350] tracking-[-0.03em]" /></div>
                <KV items={[
                  [t("Where they stopped"), t(DROPOFF_STEP[f.step] ?? f.step)],
                  [t("When"), fmtDate(f.at, L, true)],
                  [t("Tries in 14 days"), <span key="a" className="num">{f.attempts}</span>],
                  [t("Customer"), <Link key="c" href={customerHref(f.userId)} className="underline decoration-gold decoration-2 underline-offset-2"><bdi>{f.userName}</bdi></Link>],
                ]} />
                {f.mark && <p className="mt-4 text-[12.5px] text-ink-3">{t("Marked {mark} by {name}", { mark: t(DROPOFF_MARK[f.mark]!.label).toLowerCase(), name: f.markBy ?? "—" })}{f.markAt ? ` · ${timeAgo(f.markAt, L)}` : ""}{f.markNote ? ` · ${f.markNote}` : ""}</p>}
                {!f.mark && (act ? (
                  <div className="mt-5 border-t border-line pt-4">
                    {nudgeOk ? (
                      <ActionForm action={nudgeDropoffAction} className="space-y-2">
                        <input type="hidden" name="key" value={f.key} />
                        <label className="block text-[12.5px] text-ink-3" htmlFor="cannedId">{t("Nudge in the app with a saved reply")}</label>
                        <select id="cannedId" name="cannedId" required className="field" defaultValue="">
                          <option value="" disabled>{t("Choose a saved reply")}</option>
                          {canned.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                        </select>
                        <p className="text-[12px] text-ink-3">{t("Goes to their Mada conversation and as a push, in their language ({lang}).", { lang: f.locale === "ar" ? t("Arabic") : t("English") })}</p>
                        <SubmitButton variant="gold" className="w-full">{t("Send nudge")}</SubmitButton>
                      </ActionForm>
                    ) : (
                      <p className="rounded-2xl bg-sunken px-3.5 py-2.5 text-[12.5px] text-ink-3">{f.nudgedAt ? t("Nudged {when}. One nudge per drop-off.", { when: timeAgo(f.nudgedAt, L) }) : t("More than {n} hours ago: too late for a nudge.", { n: NUDGE_HOURS })}</p>
                    )}
                  </div>
                ) : <p className="mt-4 text-[12.5px] text-ink-3">{t("Following up needs the desk act right.")}</p>)}
              </Card>
              {!f.mark && act && (
                <Card>
                  <CardHead title={t("More actions")} />
                  <div className="space-y-2">
                    {f.contactPhone ? (
                      <div className="grid grid-cols-2 gap-2">
                        <a href={`tel:${f.contactPhone}`} className={btn("outline", "md", "w-full")}><Phone className="size-4" />{t("Call")}</a>
                        <a href={wa(f.contactPhone)} target="_blank" rel="noreferrer" className={btn("outline", "md", "w-full")}><MessageCircle className="size-4" />{t("WhatsApp")}</a>
                      </div>
                    ) : <p className="text-[12.5px] text-ink-3">{t("No call or WhatsApp: they haven't given a number on a request.")}</p>}
                    <LinkButton href={`/adminwork/desk/tickets/new?from=dropoff&key=${encodeURIComponent(f.key)}&customer=${f.userId}`} variant="outline" className="w-full"><TicketPlus className="size-4" />{t("Create ticket")}</LinkButton>
                  </div>
                  <ActionForm action={markDropoffAction} className="mt-4 space-y-2 border-t border-line pt-4">
                    <input type="hidden" name="key" value={f.key} />
                    <Textarea name="note" rows={2} maxLength={300} placeholder={t("A note for the team (optional)")} />
                    <div className="grid grid-cols-2 gap-2">
                      <SubmitButton name="status" value="recovered" variant="primary" className="w-full">{t("Mark recovered")}</SubmitButton>
                      <SubmitButton name="status" value="ignored" variant="outline" className="w-full">{t("Ignore")}</SubmitButton>
                    </div>
                  </ActionForm>
                </Card>
              )}
            </>
          )}
        </aside>
      </div>
    </>
  );
}
