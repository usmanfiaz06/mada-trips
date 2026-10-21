import Link from "next/link";
import { Bot, Lock } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { timeAgo } from "@/lib/dates";
import { ASK_REF, ASK_TABS, askHref, listAskThreads } from "@/lib/app/desk/ask";
import { Badge, Card, Empty, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { AutoRefresh } from "@/components/desk/live";
import { CustomerLink } from "@/components/desk/customer-link";
import { ListFilter, Pager, SummaryStrip, listHref, pageParam } from "@/components/desk/list";

export const metadata = { title: "Ask threads · Desk" };
const LABEL: Record<string, string> = { all: "All", handed: "Handed off", taken: "Taken over", ticket: "Open ticket" };
const LANG: Record<string, string> = { en: "English", ar: "Arabic" };

export default async function AskThreadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  if (!can(u, "desk.ask.read") && !can(u, "desk.admin")) {
    return (<>
      <PageHeader eyebrow={t("Support")} title={t("Ask threads")} />
      <Card><Empty icon={<Lock className="size-5" />} title={t("You don't have access to Ask conversations")} hint={t("Ask a lead for the “Read Ask Mada chats” permission.")} /></Card>
    </>);
  }
  const sp = await searchParams;
  const { page, offset, size } = pageParam(sp);
  const lang = sp.lang === "en" || sp.lang === "ar" ? sp.lang : undefined;
  const data = await listAskThreads(u, { tab: sp.s, q: sp.q, lang, limit: size, offset });
  const href = listHref("/adminwork/desk/ask", { s: sp.s, q: sp.q, lang });
  const filtered = !!(sp.q || lang);
  const L = t.locale;
  return (
    <>
      <AutoRefresh every={30} />
      <PageHeader eyebrow={t("Support")} title={t("Ask threads")}
        subtitle={t("Conversations travellers had with Ask Mada in the app. Open one to read it, take it over and reply as yourself, then hand it back to Mada. Every read is logged.")} />
      <Tabs active={data.tab} items={ASK_TABS.map((s) => ({ key: s, label: t(LABEL[s]!), href: href({ s: s === "all" ? undefined : s, page: undefined }), count: data.counts[s] ?? 0 }))} />
      <Card pad={false}>
        <ListFilter action="/adminwork/desk/ask" q={sp.q} keep={{ s: sp.s }} placeholder={t("Name, phone, email or A-1B2C3D…")} clear={filtered ? href({ q: undefined, lang: undefined, page: undefined }) : null}>
          <select name="lang" defaultValue={lang ?? ""} className="field w-auto" aria-label={t("Language")}>
            <option value="">{t("Any language")}</option>
            <option value="en">{t("English")}</option>
            <option value="ar">{t("Arabic")}</option>
          </select>
        </ListFilter>
        <SummaryStrip>
          <span>{t("{n} conversations", { n: data.total })}</span>
          <span>{t("Handed off")} <span className="num text-ink">{data.counts.handed}</span></span>
          <span>{t("Taken over")} <span className="num text-ink">{data.counts.taken}</span></span>
        </SummaryStrip>
        {data.rows.length === 0 ? (
          <Empty icon={<Bot className="size-5" />} title={filtered ? t("No conversations match") : t("No Ask conversations here")}
            hint={filtered ? t("Try a different filter or search.") : t("They show here once travellers talk to Ask Mada in the app.")} />
        ) : (
          <Table>
            <thead><tr><Th>{t("Conversation")}</Th><Th>{t("Traveller")}</Th><Th>{t("Status")}</Th><Th>{t("Language")}</Th><Th align="end">{t("Messages")}</Th><Th align="end">{t("Last activity")}</Th></tr></thead>
            <tbody>
              {data.rows.map((x) => (
                <tr key={x.id} className="group transition hover:bg-surface-2" data-testid="ask-row">
                  <Td><Link href={askHref(x.id)} className="block">
                    <span className="inline-flex items-center gap-1.5 text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">
                      {!x.open && <Lock className="size-3.5 text-ink-4" aria-label={t("Locked")} />}<span className="num" dir="ltr">{ASK_REF(x.id)}</span>
                    </span>
                    {x.title && <span className="block max-w-[28ch] truncate text-[13px] text-ink-2" dir="auto" data-testid="ask-row-title">{x.title}</span>}
                    <span className="block text-[12px] text-ink-3">{t("Started {when}", { when: timeAgo(x.createdAt, L) })}</span></Link></Td>
                  <Td className="whitespace-nowrap"><CustomerLink id={x.ownerId} className="text-ink">{x.customer}</CustomerLink></Td>
                  <Td><span className="flex flex-wrap gap-1">
                    {x.mode === "agent" ? <Badge tone="gold" dot>{x.takenByName ? t("{name} has it", { name: x.takenByName.split(" ")[0]! }) : t("Taken over")}</Badge>
                      : x.handed ? <Badge tone="info">{t("Handed off")}</Badge> : <Badge>{t("Mada answering")}</Badge>}
                    {x.openTicket && <Badge tone="warn">{t("Open ticket")}</Badge>}
                  </span></Td>
                  <Td className="whitespace-nowrap">{t(LANG[x.lang] ?? x.lang)}</Td>
                  <Td align="end" className="num">{x.lines}</Td>
                  <Td align="end" className="whitespace-nowrap text-[12.5px] text-ink-3">{timeAgo(x.updatedAt, L)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager page={page} total={data.total} size={size} href={href} />
      </Card>
    </>
  );
}
