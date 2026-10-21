import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, Hand, Lock, Send, Undo2, UserRound } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { DeskError, travellerName } from "@/lib/app/desk/core";
import { ASK_REF, readAsk, type AskFull, type DeskAskLine } from "@/lib/app/desk/ask";
import { Badge, Card, CardHead, KV, PageHeader, Textarea, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { AutoRefresh } from "@/components/desk/live";
import { CustomerLink } from "@/components/desk/customer-link";
import { TicketsCard } from "@/components/desk/tickets";
import { handBackAskAction, replyAskAction, takeOverAskAction } from "../../ask-actions";

export const metadata = { title: "Ask thread · Desk" };

const CARD: Record<string, string> = { flights: "Flights", stays: "Stays", esim: "eSIM plans", entry: "Entry rules", trips: "Trips", car: "Car", request: "Request" };
const WHY: Record<string, string> = { lead: "You can read every Ask conversation as a support lead.", handoff: "Handed to the desk.", open_item: "Open because this customer has something open with us." };
const LANG: Record<string, string> = { en: "English", ar: "Arabic" };

export default async function AskThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const { id } = await params;
  let x: AskFull;
  try {
    x = await readAsk(u, id);
  } catch (e) {
    if (e instanceof DeskError && e.kind === "NOT_FOUND") notFound();
    if (!(e instanceof DeskError)) throw e;
    return (<>
      <PageHeader eyebrow={<><span className="num" dir="ltr">{ASK_REF(id)}</span> · {t("Ask thread")}</>} title={t("Ask Mada conversation")} />
      <Card data-testid="ask-refused">
        <p className="flex items-start gap-2 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13.5px] text-warn"><Lock className="mt-0.5 size-4 shrink-0" />{t(e.message)}</p>
        <Link href="/adminwork/desk/ask" className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-3.5 rtl:-scale-x-100" />{t("Ask threads")}</Link>
      </Card>
    </>);
  }
  const act = can(u, "desk.act");
  const lead = can(u, "desk.admin") || can(u, "desk.tickets.manage");
  const name = x.user ? travellerName(x.user.name) : t("Traveller");
  const agent = x.mode === "agent";
  const holder = x.takenByName?.split(" ")[0] ?? null;

  return (
    <>
      <AutoRefresh every={agent ? 10 : 30} />
      <PageHeader eyebrow={<><span className="num" dir="ltr">{x.ref}</span> · {t("Ask thread")}</>} title={<CustomerLink id={x.ownerId}>{name}</CustomerLink>}
        subtitle={`${t(WHY[x.why]!)} ${t("Read-only. This read is in the audit log.")}`}
        actions={<>
          {agent ? <Badge tone="gold" dot>{holder ? t("{name} has it", { name: holder }) : t("Taken over")}</Badge> : x.handed ? <Badge tone="info">{t("Handed off")}</Badge> : <Badge>{t("Mada answering")}</Badge>}
        </>} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Card data-testid="ask-transcript">
            <CardHead title={<span className="inline-flex items-center gap-2"><Bot className="size-4 text-gold" />{t("Conversation")}</span>}
              hint={t("What the traveller and Mada said, as the app showed it. Card details, payment and passport numbers are never kept here.")} />
            {x.summary && <p className="mb-4 rounded-2xl bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-ink-3"><span className="font-medium text-ink-2">{t("Earlier, in short:")}</span> <span dir="auto">{x.summary}</span></p>}
            {x.lines.length === 0 ? <p className="text-[13px] text-ink-3">{t("Nothing in this thread yet")}</p> : (
              <ol className="space-y-3">
                {x.lines.map((l, i) => <Line key={i} l={l} traveller={name} t={t} />)}
              </ol>
            )}
            {x.mine && act && (
              <div className="mt-5 border-t border-line pt-4">
                <ActionForm action={replyAskAction} resetOnOk className="grid gap-2">
                  <input type="hidden" name="id" value={x.id} />
                  <Textarea name="body" rows={3} required maxLength={2000} dir="auto" placeholder={t("Reply as {name}…", { name: x.me?.displayName ?? "" })} aria-label={t("Reply")} data-testid="ask-reply" />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] text-ink-3">{t("The traveller sees this in Ask, from {name}.", { name: x.me?.displayName ?? "" })}</span>
                    <SubmitButton><Send className="size-4 rtl:-scale-x-100" />{t("Send")}</SubmitButton>
                  </div>
                </ActionForm>
              </div>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="ring-2 ring-gold/40" data-testid="next-action">
            <CardHead title={t("Next")} hint={agent
              ? (x.mine ? t("You have it: Mada isn't answering. Reply here, then hand it back.") : t("{name} has it: Mada isn't answering.", { name: holder ?? t("Someone on the desk") }))
              : t("Mada is answering. Take it over to reply yourself: the traveller sees you join, by your first name.")} />
            {act && (
              <div className="grid gap-2">
                {!agent && (x.me
                  ? <ActionForm action={takeOverAskAction}><input type="hidden" name="id" value={x.id} /><SubmitButton className="w-full"><Hand className="size-4" />{t("Take over")}</SubmitButton></ActionForm>
                  : <p className="text-[12.5px] text-ink-3">{t("Set up your agent profile (the first name travellers see) in Team before taking a conversation over")}</p>)}
                {agent && (x.mine || lead) && (
                  <ActionForm action={handBackAskAction}><input type="hidden" name="id" value={x.id} />
                    <SubmitButton variant={x.mine ? "outline" : "primary"} className="w-full" confirm={x.mine ? undefined : t("Hand it back to Mada while {name} has it?", { name: holder ?? "" })}><Undo2 className="size-4 rtl:-scale-x-100" />{t("Hand back to Mada")}</SubmitButton>
                  </ActionForm>
                )}
              </div>
            )}
          </Card>

          <Card>
            <CardHead title={t("Properties")} />
            <KV cols={2} items={[
              [t("Traveller"), <CustomerLink key="c" id={x.ownerId}>{name}</CustomerLink>],
              [t("Language"), t(LANG[x.lang] ?? x.lang)],
              [t("Started"), <span key="s" title={fmtDate(x.createdAt, L, true)}>{timeAgo(x.createdAt, L)}</span>],
              [t("Last activity"), <span key="l" title={fmtDate(x.updatedAt, L, true)}>{timeAgo(x.updatedAt, L)}</span>],
              [t("Mada's turns"), <span key="n" className="num">{x.turns}</span>],
              [t("Handed off"), x.handedOffAt ? timeAgo(x.handedOffAt, L) : x.handed ? t("Yes") : "—"],
              ...(agent ? [[t("Taken over"), `${holder ?? "—"} · ${x.takenAt ? timeAgo(x.takenAt, L) : ""}`] as [string, React.ReactNode]] : []),
            ]} />
          </Card>

          <TicketsCard about={{ kind: "ask_thread", id: x.id }} customerId={x.ownerId} subject={t("Ask Mada conversation")} canAct={act} />
        </aside>
      </div>
    </>
  );
}

function Line({ l, traveller, t }: { l: DeskAskLine; traveller: string; t: Awaited<ReturnType<typeof getT>> }) {
  if (l.who === "system") {
    return (
      <li className="flex justify-center" data-testid="ask-line-system">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[12px] text-ink-3 ring-1 ring-line">
          <UserRound className="size-3.5 text-gold" />
          {l.event === "joined" ? t("{name} from Mada joined", { name: l.by ?? "" }) : t("{name} handed it back to Mada", { name: l.by ?? "" })}
          {l.at && <span className="text-ink-4">· {fmtDate(new Date(l.at), t.locale, true)}</span>}
        </span>
      </li>
    );
  }
  const me = l.who === "me";
  return (
    <li className={cx("flex", me ? "justify-start" : "justify-end")} data-testid={`ask-line-${l.who}`}>
      <div className={cx("max-w-[80%]", !me && "text-end")}>
        <div className="mb-1 text-[11.5px] text-ink-3"><bdi>{me ? traveller : l.who === "agent" ? l.by ?? t("Agent") : "Mada"}</bdi>{l.at && <span className="text-ink-4"> · {fmtDate(new Date(l.at), t.locale, true)}</span>}</div>
        <div dir="auto" className={cx("inline-block whitespace-pre-wrap break-words rounded-[18px] px-3.5 py-2 text-start text-[14px] leading-relaxed",
          me ? "rounded-es-md bg-surface-2 text-ink ring-1 ring-line" : l.who === "agent" ? "rounded-ee-md bg-gold-soft text-ink ring-1 ring-gold/40" : "rounded-ee-md bg-brand text-brand-ink")}>{l.text || "—"}</div>
        {(l.cards.length > 0 || l.held) && (
          <div className={cx("mt-1 flex flex-wrap gap-1", !me && "justify-end")}>
            {l.cards.map((c, j) => <Badge key={j} tone="neutral">{t(CARD[c] ?? c)}</Badge>)}
            {l.held && <Badge tone="warn">{t("Held: {why}", { why: l.held })}</Badge>}
          </div>
        )}
      </div>
    </li>
  );
}
