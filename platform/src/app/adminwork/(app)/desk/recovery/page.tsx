import { ArrowRight, BookUser, KeyRound, Plane, ShieldQuestion } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { listRecovery } from "@/lib/app/desk/recovery";
import { slaFor } from "@/lib/app/desk/sla";
import { Badge, Card, Empty, Input, PageHeader, Tabs, cx, type Tone } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { SlaClock } from "@/components/desk/live";
import { recoveryAction } from "../actions";

export const metadata = { title: "Account recovery · Desk" };
const DECISION: Record<string, { label: string; tone: Tone }> = { approved: { label: "Moved", tone: "ok" }, declined: { label: "Declined", tone: "neutral" } };

/*
 * Requests from people who can't use their old number or email any more. Check it's them against what's on file
 * (passport details, the last booking: ask, don't tell), then move the account or decline. Both tell them on the new
 * contact; approving also ends every session on the account.
 */
export default async function RecoveryPage({ searchParams }: { searchParams: Promise<{ s?: string; focus?: string }> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const tab = sp.s === "decided" ? "decided" : "open";
  const act = can(u, "desk.act");
  const [open, decided] = await Promise.all([listRecovery("open"), tab === "decided" ? listRecovery("closed") : Promise.resolve([])]);
  const rows = tab === "open" ? open : decided;
  return (
    <>
      <PageHeader eyebrow={t("App desk")} title={t("Account recovery")}
        subtitle={t("People who can't use their old number or email. Check it's them: ask for their passport details and their last booking, and compare with what's on file. Never read the details out to them.")} />
      <Tabs active={tab} items={[
        { key: "open", label: t("To check"), count: open.length, href: "/adminwork/desk/recovery" },
        { key: "decided", label: t("Decided"), href: "/adminwork/desk/recovery?s=decided" },
      ]} />
      {rows.length === 0 ? <Card><Empty icon={<KeyRound className="size-5" />} title={tab === "open" ? t("Nothing to check") : t("Nothing decided yet")} hint={t("Requests from the app's \"Didn't get the code?\" sheet land here.")} /></Card> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((r) => {
            const sla = r.status === "open" ? slaFor("recovery", r.createdAt) : null;
            const a = r.account;
            return (
              <Card key={r.id} className={cx(sp.focus === r.id && "ring-2 ring-gold")}>
                <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                  <Badge tone="info"><KeyRound className="size-3" />{t("Account recovery")}</Badge>
                  {sla && <SlaClock due={sla.dueAt.toISOString()} opened={sla.openedAt.toISOString()} />}
                  {r.status !== "open" && <Badge tone={DECISION[r.status]?.tone ?? "neutral"} dot>{t(DECISION[r.status]?.label ?? r.status)}</Badge>}
                  <span>· {timeAgo(r.createdAt, L)}</span>
                </div>
                <div className="mt-3 rounded-2xl bg-surface-2 p-4 text-[13.5px] text-ink-2">
                  <div className="text-[15px] font-medium text-ink">{r.name}</div>
                  <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                    <dt className="text-ink-3">{t("Old")}</dt><dd className="break-all" dir="ltr">{r.oldValue} <span className="text-ink-3">· {t(r.oldKind === "email" ? "Email" : "Phone")}</span></dd>
                    <dt className="text-ink-3">{t("New")}</dt><dd className="break-all" dir="ltr">{r.newValue} <span className="text-ink-3">· {t(r.newKind === "email" ? "Email" : "Phone")}</span></dd>
                  </dl>
                  {r.note && <p className="mt-3 whitespace-pre-wrap break-words italic text-ink-3">“{r.note}”</p>}
                </div>
                <div className="mt-3 rounded-2xl border border-line p-4 text-[13px]">
                  {a ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-ink"><BookUser className="size-4 text-gold-2" />{t("On file")}: {a.name || t("No name yet")}{a.deletedAt && <Badge tone="bad">{t("Deleted")}</Badge>}</div>
                      <div className="text-ink-3" dir="ltr">{[a.phone, a.email].filter(Boolean).join(" · ") || "—"} · {t("since {date}", { date: fmtDate(a.createdAt, L) })}</div>
                      <div className="flex items-start gap-2 text-ink-2"><ShieldQuestion className="mt-0.5 size-4 shrink-0 text-ink-3" />
                        {a.passport?.number
                          ? <span>{t("Passport")}: {[a.passport.givenNames, a.passport.surname].filter(Boolean).join(" ")} · <span dir="ltr">{a.passport.number}</span>{a.passport.dateOfBirth ? ` · ${t("born {date}", { date: fmtDate(a.passport.dateOfBirth, L) })}` : ""}{a.passport.expiry ? ` · ${t("expires {date}", { date: fmtDate(a.passport.expiry, L) })}` : ""}</span>
                          : <span className="text-warn">{t("No passport on file. Check with the last booking and anything else you can verify.")}</span>}
                      </div>
                      <div className="flex items-start gap-2 text-ink-2"><Plane className="mt-0.5 size-4 shrink-0 text-ink-3" />
                        {a.lastBooking ? <span>{t("Last booking")}: {a.lastBooking.summary} · {fmtDate(a.lastBooking.createdAt, L)}</span> : <span className="text-ink-3">{t("No bookings yet")}</span>}
                      </div>
                    </div>
                  ) : <p className="text-warn">{t("No account uses the old number or email. Decline it; they hear it on the new contact.")}</p>}
                </div>
                {r.decisionNote && <p className="mt-3 text-[12.5px] text-ink-3">{t("Note")}: {r.decisionNote}{r.decidedAt ? ` · ${fmtDate(r.decidedAt, L, true)}` : ""}</p>}
                {r.status === "open" && (act ? (
                  <ActionForm action={recoveryAction} className="mt-4 space-y-2">
                    <input type="hidden" name="id" value={r.id} />
                    <Input name="note" maxLength={300} required minLength={5} placeholder={t("How you checked it's them, or why you're declining")} />
                    <div className="flex flex-wrap items-center gap-2">
                      {a && !a.deletedAt && (
                        <SubmitButton name="decision" value="approve" variant="gold" size="sm" confirm={t("Move this account to {contact}? Every session on it ends.", { contact: r.newMasked })}>
                          {t("Approve: move account to new contact")}<ArrowRight className="size-3.5" />
                        </SubmitButton>
                      )}
                      <SubmitButton name="decision" value="decline" variant="outline" size="sm">{t("Decline")}</SubmitButton>
                    </div>
                  </ActionForm>
                ) : <p className="mt-4 text-[12.5px] text-ink-3">{t("Deciding needs the desk action right.")}</p>)}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
