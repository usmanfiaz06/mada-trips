import Link from "next/link";
import { CalendarClock, ChevronLeft, ChevronRight, Clock, Trash2 } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { riyadhTime } from "@/lib/dates";
import { riyadhMidnight } from "@/lib/app/desk/agent-admin";
import { LATE_AFTER_MINUTES, riyadhDay, timeLogs, weekGrid } from "@/lib/app/desk/timelog";
import { Avatar, Badge, Card, CardHead, Empty, Field, Input, PageHeader, Select, Table, Td, Th, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { addShiftsAction, removeShiftsAction } from "../agent-actions";

export const metadata = { title: "Rota & time · Desk" };
const DAY = 86400_000;
const local = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 16);
/** "7h 40m", "45m", "—". */
const hm = (m: number) => (m <= 0 ? "—" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`);

/** The Sunday (Riyadh) that starts the week of `d`. */
function weekStart(d: Date) {
  const mid = riyadhMidnight(d);
  return new Date(mid.getTime() - new Date(mid.getTime() + 3 * 3600_000).getUTCDay() * DAY);
}

export default async function RotaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const admin = can(u, "desk.admin");
  const now = new Date();
  const asked = /^\d{4}-\d{2}-\d{2}$/.test(sp.w ?? "") ? new Date(`${sp.w}T12:00:00+03:00`) : now;
  const from = weekStart(asked);
  const weekEnd = new Date(from.getTime() + 7 * DAY);
  const until = weekEnd > now ? now : new Date(weekEnd.getTime() - 1);
  const [g, logs] = await Promise.all([weekGrid(from), timeLogs({ days: Math.max(1, Math.round((riyadhMidnight(until).getTime() - from.getTime()) / DAY) + 1), until, now })]);
  const today = riyadhDay(now);
  const name = (id: string | null) => g.agents.find((a) => a.id === id)?.displayName ?? "—";
  const agentOptions = g.agents.filter((a) => a.active).map((a) => ({ value: a.id, label: a.displayName }));
  const dayName = (d: Date) => new Intl.DateTimeFormat(L === "ar" ? "ar-SA-u-nu-latn" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Riyadh" }).format(d);
  const wk = (d: Date) => riyadhDay(d);
  const nextHour = new Date(Math.ceil(now.getTime() / 3600_000) * 3600_000);
  const rostered = g.agents.filter((a) => a.active || g.shifts.some((s) => s.agentId === a.id));
  const nowOn = g.shifts.filter((s) => s.startsAt <= now && now < s.endsAt);

  return (
    <>
      <PageHeader eyebrow={t("Support admin")} title={t("Rota & time")}
        subtitle={t("Who is on, week by week, and how the time went: rostered against online, away and late starts. Times are Riyadh time. The rota decides who is on duty; with nobody on, urgent breaches page the on-call lead.")}
        actions={<div className="flex items-center gap-1.5">
          <Link aria-label={t("Previous week")} href={`/adminwork/desk/rota?w=${wk(new Date(from.getTime() - 7 * DAY))}`} className="grid size-10 place-items-center rounded-full bg-surface text-ink-2 shadow-card hover:text-ink"><ChevronLeft className="size-4 rtl:rotate-180" /></Link>
          <Link href="/adminwork/desk/rota" className="inline-flex h-10 items-center rounded-full bg-surface px-4 text-[13px] text-ink-2 shadow-card hover:text-ink">{t("This week")}</Link>
          <Link aria-label={t("Next week")} href={`/adminwork/desk/rota?w=${wk(weekEnd)}`} className="grid size-10 place-items-center rounded-full bg-surface text-ink-2 shadow-card hover:text-ink"><ChevronRight className="size-4 rtl:rotate-180" /></Link>
        </div>} />

      <Card pad={false} className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-6">
          <CardHead title={t("Week of {date}", { date: dayName(from) })} hint={nowOn.length ? t("{n} on shift now", { n: nowOn.length }) : t("Nobody is on shift now")} action={<CalendarClock className="size-4 text-ink-3" />} />
        </div>
        {rostered.length === 0 ? <Empty title={t("No agents yet")} hint={t("Add someone from Agents & roles.")} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] table-fixed border-t border-line text-[13px]" data-testid="rota-grid">
              <thead>
                <tr>
                  <th className="w-[150px] px-4 py-2.5 text-start text-[12px] font-normal text-ink-3">{t("Agent")}</th>
                  {g.days.map((d) => <th key={d.toISOString()} className={cx("px-2 py-2.5 text-start text-[12px] font-normal", riyadhDay(d) === today ? "text-ink" : "text-ink-3")}>{dayName(d)}{riyadhDay(d) === today && <span className="ms-1.5 inline-block size-1.5 rounded-full bg-gold align-middle" />}</th>)}
                </tr>
              </thead>
              <tbody>
                {rostered.map((a) => (
                  <tr key={a.id} className="border-t border-line align-top">
                    <td className="px-4 py-3"><Link href={`/adminwork/desk/agents/${a.id}`} className="flex items-center gap-2 hover:underline"><Avatar name={a.displayName} size={26} /><bdi className="truncate text-ink">{a.displayName}</bdi></Link>{!a.active && <Badge className="mt-1">{t("Deactivated")}</Badge>}</td>
                    {g.days.map((d) => {
                      const list = g.shifts.filter((s) => s.agentId === a.id && s.startsAt >= d && s.startsAt < new Date(d.getTime() + DAY));
                      return (
                        <td key={d.toISOString()} className={cx("px-1.5 py-2", riyadhDay(d) === today && "bg-gold-soft/30")}>
                          <div className="space-y-1">
                            {list.map((s) => {
                              const live = s.startsAt <= now && now < s.endsAt;
                              return (
                                <div key={s.id} className={cx("rounded-xl px-2 py-1.5", live ? "bg-ok-soft text-ok" : "bg-surface-2 text-ink-2")}>
                                  <div className="num whitespace-nowrap text-[12.5px]" dir="ltr">{riyadhTime(s.startsAt)}–{riyadhTime(s.endsAt)}</div>
                                  <div className="flex items-center gap-1">
                                    <span className="min-w-0 flex-1 truncate text-[11px] opacity-80" title={s.note ?? undefined}>{s.repeat === "weekly" ? `↻ ${t("Weekly")}` : ""}{s.coveringForId ? ` · ${t("covering for {name}", { name: name(s.coveringForId) })}` : ""}{s.note ? ` · ${s.note}` : ""}</span>
                                    {admin && s.endsAt > now && (
                                      <form action={removeShiftsAction} className="flex shrink-0">
                                        <input type="hidden" name="id" value={s.id} />
                                        <SubmitButton variant="ghost" size="sm" className="!h-6 !px-1" confirm={t("Take this shift off the rota?")}><Trash2 className="size-3" /><span className="sr-only">{t("Remove")}</span></SubmitButton>
                                        {s.seriesId && <SubmitButton name="series" value="yes" variant="ghost" size="sm" className="!h-6 !px-1 text-[11px]" confirm={t("Take this and every later week of this shift off the rota?")}>{t("All")}</SubmitButton>}
                                      </form>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {admin && agentOptions.length > 0 && (
          <ActionForm action={addShiftsAction} className="grid gap-2 border-t border-line p-6 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("Who")}><Select name="agentId" options={agentOptions} /></Field>
            <Field label={t("Covering for")}><Select name="coveringForId" placeholder={t("Nobody")} options={agentOptions} /></Field>
            <Field label={t("Starts")}><Input type="datetime-local" name="startsAt" required defaultValue={local(nextHour)} /></Field>
            <Field label={t("Ends")}><Input type="datetime-local" name="endsAt" required defaultValue={local(new Date(nextHour.getTime() + 8 * 3600_000))} /></Field>
            <Field label={t("Repeat")}><Select name="repeat" defaultValue="" options={[{ value: "", label: t("Just this once") }, { value: "weekly", label: t("Every week") }]} /></Field>
            <Field label={t("For how many weeks")}><Input name="weeks" type="number" min={1} max={26} defaultValue={8} /></Field>
            <Field label={t("On these days (weekly)")} className="sm:col-span-2">
              <div className="flex flex-wrap gap-1.5">
                {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                  <label key={d}><input type="checkbox" name="days" value={d} className="peer sr-only" />
                    <span className="inline-flex h-8 cursor-pointer items-center rounded-full px-3 text-[12.5px] text-ink-3 ring-1 ring-line-strong transition peer-checked:bg-ink peer-checked:text-bg peer-checked:ring-ink peer-focus-visible:ring-2 peer-focus-visible:ring-gold">
                      {new Intl.DateTimeFormat(L === "ar" ? "ar-SA" : "en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + d)))}</span></label>
                ))}
              </div>
            </Field>
            <Input name="note" maxLength={80} placeholder={t("Note (optional): night desk, Pakistan")} className="sm:col-span-2 lg:col-span-3" aria-label={t("Note")} />
            <SubmitButton>{t("Add to the rota")}</SubmitButton>
          </ActionForm>
        )}
      </Card>

      <Card pad={false}>
        <div className="px-6 pt-6"><CardHead title={t("Time logs")} hint={t("From the Online / Away / Off switch in the header. Late: switched on more than {n} minutes after the shift began. Handled: tickets resolved while theirs.", { n: LATE_AFTER_MINUTES })} action={<Clock className="size-4 text-ink-3" />} /></div>
        {logs.rows.length === 0 ? <Empty title={t("Nothing logged yet")} /> : (
          <Table>
            <thead><tr>
              <Th>{t("Agent")}</Th>
              {logs.rows[0]!.logs.map((d) => <Th key={d.day} align="end" className="whitespace-nowrap">{dayName(new Date(`${d.day}T12:00:00+03:00`))}</Th>)}
              <Th align="end">{t("Rostered")}</Th><Th align="end">{t("Online")}</Th><Th align="end">{t("Away")}</Th><Th align="end">{t("Late")}</Th><Th align="end">{t("Handled")}</Th>
            </tr></thead>
            <tbody>
              {logs.rows.map((r) => (
                <tr key={r.agent.id}>
                  <Td><Link href={`/adminwork/desk/agents/${r.agent.id}`} className="hover:underline"><bdi>{r.agent.name}</bdi></Link></Td>
                  {r.logs.map((d) => (
                    <Td key={d.day} align="end" className="num whitespace-nowrap">
                      <span className={cx("block", d.rosteredMin && d.onlineMin < d.rosteredMin * 0.8 ? "text-warn" : "text-ink")}>{hm(d.onlineMin)}</span>
                      <span className="block text-[11.5px] text-ink-3">{d.rosteredMin ? `/ ${hm(d.rosteredMin)}` : ""}{(d.lateMin ?? 0) > LATE_AFTER_MINUTES ? ` · ${t("late {n}m", { n: d.lateMin! })}` : ""}</span>
                    </Td>
                  ))}
                  <Td align="end" className="num">{hm(r.total.rosteredMin)}</Td>
                  <Td align="end" className="num">{hm(r.total.onlineMin)}</Td>
                  <Td align="end" className="num">{hm(r.total.awayMin)}</Td>
                  <Td align="end" className="num">{r.total.lateDays || "—"}</Td>
                  <Td align="end" className="num">{r.total.handled}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
