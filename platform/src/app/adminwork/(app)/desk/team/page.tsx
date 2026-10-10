import { desc } from "drizzle-orm";
import { CalendarClock, MessageSquareText, Search, Trash2, UserPlus, Users } from "lucide-react";
import { db } from "@/db";
import { appDeskCanned } from "@/db/app-schema-desk";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, riyadhTime, timeAgo } from "@/lib/dates";
import { teamBoard, travellersWithAgents } from "@/lib/app/desk/agents";
import { onShift } from "@/lib/app/desk/routing";
import { Avatar, Badge, Card, CardHead, Empty, Field, Input, PageHeader, Select, Textarea, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { addCannedAction, addShiftAction, assignPrimaryAction, removeShiftAction, saveAgentAction } from "../actions";

export const metadata = { title: "Team & rota · Desk" };
const LANGS = [["ar", "العربية"], ["en", "English"], ["ur", "اردو"], ["hi", "हिन्दी"], ["tr", "Türkçe"], ["fr", "Français"]] as const;
const local = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 16);

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const admin = can(u, "desk.admin");
  const q = sp.q?.trim().slice(0, 60) ?? "";
  const [b, travellers, canned] = await Promise.all([teamBoard(), travellersWithAgents(q, 40), db.select().from(appDeskCanned).orderBy(appDeskCanned.sort, desc(appDeskCanned.createdAt))]);
  const name = (id: string | null) => b.agents.find((a) => a.id === id)?.displayName ?? "—";
  const opsName = (id: string) => b.users.find((x) => x.id === id)?.name ?? "—";
  const free = b.users.filter((x) => x.active && !b.agents.some((a) => a.opsUserId === x.id));
  const agentOptions = b.agents.filter((a) => a.active).map((a) => ({ value: a.id, label: a.displayName }));
  const now = b.now;
  const days = new Map<string, typeof b.upcoming>();
  for (const s of b.upcoming) { const k = local(s.startsAt).slice(0, 10); days.set(k, [...(days.get(k) ?? []), s]); }
  const nextHour = new Date(Math.ceil(now.getTime() / 3600_000) * 3600_000);

  return (
    <>
      <PageHeader eyebrow={t("App desk")} title={admin ? t("Team and rota") : t("Team")} subtitle={t("The people travellers talk to. Each traveller has their own agent; when that agent is off, whoever covers for them answers, then the shared queue.")} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <Card pad={false}>
            <div className="px-6 pt-6"><CardHead title={t("Agents")} hint={t("Travellers see the first name and photo, never the Ops account.")} action={<Users className="size-4 text-ink-3" />} /></div>
            {b.agents.length === 0 ? <Empty title={t("No agents yet")} hint={t("Add someone from the team below.")} /> : (
              <ul className="divide-y divide-line">
                {b.agents.map((a) => {
                  const shift = onShift(a.id, b.shifts, now);
                  const cover = b.shifts.find((s) => s.agentId === a.id && s.coveringForId && s.startsAt <= now && now < s.endsAt);
                  return (
                    <li key={a.id} className="px-6 py-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="relative"><Avatar name={a.displayName} size={40} /><span className={cx("absolute -bottom-0.5 -end-0.5 size-3.5 rounded-full ring-2 ring-surface", !shift ? "bg-ink-4" : a.status === "online" ? "bg-ok" : a.status === "away" ? "bg-warn" : "bg-ink-4")} /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2"><span className="text-[15px] text-ink">{a.displayName}</span>{a.displayNameAr && <span className="text-[13px] text-ink-3">{a.displayNameAr}</span>}{!a.active && <Badge>{t("Inactive")}</Badge>}</div>
                          <div className="text-[12.5px] text-ink-3">{opsName(a.opsUserId)} · {a.languages.map((l) => l.toUpperCase()).join(" · ")} · {t("{n} travellers", { n: b.travellers.get(a.id) ?? 0 })}</div>
                        </div>
                        <div className="text-end text-[12.5px]">
                          <div className={shift ? "text-ok" : "text-ink-3"}>{shift ? (cover ? t("Covering for {name}", { name: name(cover.coveringForId) }) : t("On shift")) : t("Off shift")}</div>
                          <div className="text-ink-3">{t(a.status === "online" ? "Online" : a.status === "away" ? "Away" : "Signed off")} · {timeAgo(a.statusAt, L)}</div>
                        </div>
                      </div>
                      {admin && (
                        <details className="mt-3 rounded-2xl bg-surface-2 px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
                          <summary className="cursor-pointer text-[13px] text-ink-2">{t("Edit profile")}</summary>
                          <AgentForm t={t} opsUserId={a.opsUserId} a={a} />
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {admin && free.length > 0 && (
              <details className="border-t border-line px-6 py-4 [&_summary::-webkit-details-marker]:hidden">
                <summary className="inline-flex cursor-pointer items-center gap-2 text-[13.5px] text-ink"><UserPlus className="size-4 text-ink-3" />{t("Add someone to the desk")}</summary>
                <AgentForm t={t} free={free.map((x) => ({ value: x.id, label: x.name }))} />
              </details>
            )}
          </Card>

          <Card>
            <CardHead title={t("Rota")} hint={t("Times are Riyadh time. A shift can cover for someone: their travellers come to you while they're off.")} action={<CalendarClock className="size-4 text-ink-3" />} />
            {days.size === 0 ? <p className="text-[13.5px] text-warn">{t("Nothing on the rota for the next 7 days.")}</p> : (
              <div className="space-y-4">
                {[...days.entries()].map(([day, list]) => (
                  <div key={day}>
                    <div className="mb-2 text-[12px] font-medium text-ink-3">{fmtDate(day, L)}</div>
                    <ul className="space-y-1.5">
                      {list.map((s) => {
                        const live = s.startsAt <= now && now < s.endsAt;
                        return (
                          <li key={s.id} className={cx("flex items-center gap-3 rounded-2xl px-3 py-2", live ? "bg-ok-soft/60" : "bg-surface-2")}>
                            <Avatar name={name(s.agentId)} size={28} />
                            <span className="num w-[104px] shrink-0 text-[13px] text-ink" dir="ltr">{riyadhTime(s.startsAt)}–{riyadhTime(s.endsAt)}</span>
                            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{name(s.agentId)}{s.coveringForId ? ` · ${t("covering for {name}", { name: name(s.coveringForId) })}` : ""}{s.note ? ` · ${s.note}` : ""}</span>
                            {live && <Badge tone="ok" dot>{t("Now")}</Badge>}
                            {admin && <form action={removeShiftAction}><input type="hidden" name="id" value={s.id} /><SubmitButton variant="ghost" size="sm" confirm={t("Take this shift off the rota?")}><Trash2 className="size-3.5" /><span className="sr-only">{t("Remove")}</span></SubmitButton></form>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {admin && b.agents.length > 0 && (
              <ActionForm action={addShiftAction} resetOnOk className="mt-5 grid gap-2 border-t border-line pt-5 sm:grid-cols-2">
                <Field label={t("Who")}><Select name="agentId" options={agentOptions} /></Field>
                <Field label={t("Covering for")}><Select name="coveringForId" placeholder={t("Nobody")} options={agentOptions} /></Field>
                <Field label={t("Starts")}><Input type="datetime-local" name="startsAt" required defaultValue={local(nextHour)} /></Field>
                <Field label={t("Ends")}><Input type="datetime-local" name="endsAt" required defaultValue={local(new Date(nextHour.getTime() + 8 * 3600_000))} /></Field>
                <Input name="note" maxLength={80} placeholder={t("Note (optional): night desk, Pakistan")} className="sm:col-span-2" />
                <SubmitButton className="sm:col-span-2">{t("Add to the rota")}</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHead title={t("Travellers and their agent")} hint={t("“Faisal, your Mada agent”. Changing it changes who they see.")} />
            <form className="relative mb-3" action="/adminwork/desk/team">
              <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <input name="q" defaultValue={q} placeholder={t("Search name or phone…")} className="field ps-10" />
            </form>
            {travellers.length === 0 ? <p className="text-[13px] text-ink-3">{t("No travellers found")}</p> : (
              <ul className="space-y-1.5">
                {travellers.map((x) => (
                  <li key={x.id} className="rounded-2xl bg-surface-2 p-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={x.name || "?"} size={30} />
                      <div className="min-w-0 flex-1 leading-tight"><div className="truncate text-[13.5px] text-ink">{x.name || t("No name yet")}</div><div className="num truncate text-[11.5px] text-ink-3" dir="ltr">{x.phone ?? "—"}</div></div>
                      {!admin && <span className="text-[12.5px] text-ink-2">{x.agentId ? name(x.agentId) : t("No agent")}</span>}
                    </div>
                    {admin && b.agents.length > 0 && (
                      <ActionForm action={assignPrimaryAction} className="mt-2 flex gap-2">
                        <input type="hidden" name="userId" value={x.id} />
                        <Select name="agentId" defaultValue={x.agentId ?? ""} placeholder={x.agentId ? undefined : t("Choose an agent")} options={agentOptions} className="h-9 min-w-0 flex-1 py-0 text-[13px]" />
                        <SubmitButton variant="outline" size="sm">{t("Save")}</SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHead title={t("Saved replies")} hint={t("In both languages; the reply box picks the one for your screen.")} action={<MessageSquareText className="size-4 text-ink-3" />} />
            <ul className="space-y-2">
              {canned.map((c) => (
                <li key={c.id} className="rounded-2xl bg-surface-2 px-3.5 py-2.5"><div className="text-[13px] font-medium text-ink">{c.title}</div><div className="line-clamp-2 text-[12.5px] text-ink-3">{L === "ar" ? c.bodyAr : c.bodyEn}</div></li>
              ))}
              {canned.length === 0 && <li className="text-[13px] text-ink-3">{t("None yet")}</li>}
            </ul>
            {admin && (
              <ActionForm action={addCannedAction} resetOnOk className="mt-4 space-y-2 border-t border-line pt-4">
                <Input name="title" required maxLength={60} placeholder={t("Title, e.g. Bag tag photo")} />
                <Textarea name="bodyEn" required rows={2} maxLength={1000} placeholder={t("English")} />
                <Textarea name="bodyAr" required rows={2} maxLength={1000} placeholder={t("Arabic")} dir="rtl" />
                <SubmitButton variant="outline" className="w-full">{t("Add saved reply")}</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}

function AgentForm({ t, opsUserId, a, free }: { t: Awaited<ReturnType<typeof getT>>; opsUserId?: string; a?: { displayName: string; displayNameAr: string | null; languages: string[]; pronoun: string; replyMinutes: number; active: boolean }; free?: { value: string; label: string }[] }) {
  return (
    <ActionForm action={saveAgentAction} className="mt-3 grid gap-2 sm:grid-cols-2">
      {opsUserId ? <input type="hidden" name="opsUserId" value={opsUserId} /> : <Field label={t("Team member")} className="sm:col-span-2"><Select name="opsUserId" options={free ?? []} /></Field>}
      <Field label={t("First name travellers see")}><Input name="displayName" required maxLength={30} defaultValue={a?.displayName ?? ""} placeholder="Faisal" /></Field>
      <Field label={t("In Arabic")}><Input name="displayNameAr" maxLength={30} defaultValue={a?.displayNameAr ?? ""} placeholder="فيصل" dir="rtl" /></Field>
      <Field label={t("Languages")} className="sm:col-span-2">
        <div className="flex flex-wrap gap-1.5">
          {LANGS.map(([v, l]) => (
            <label key={v}><input type="checkbox" name="languages" value={v} defaultChecked={a ? a.languages.includes(v) : v === "ar" || v === "en"} className="peer sr-only" />
              <span className="inline-flex h-8 cursor-pointer items-center rounded-full px-3 text-[12.5px] text-ink-3 ring-1 ring-line-strong transition peer-checked:bg-ink peer-checked:text-bg peer-checked:ring-ink">{l}</span></label>
          ))}
        </div>
      </Field>
      <Field label={t("Says")}><Select name="pronoun" defaultValue={a?.pronoun ?? "he"} options={[{ value: "he", label: t("He has your whole trip") }, { value: "she", label: t("She has your whole trip") }]} /></Field>
      <Field label={t("Usual reply time (min)")}><Input name="replyMinutes" type="number" min={1} max={30} defaultValue={a?.replyMinutes ?? 2} /></Field>
      {a && <Field label={t("On the desk")}><Select name="active" defaultValue={a.active ? "yes" : "no"} options={[{ value: "yes", label: t("Active") }, { value: "no", label: t("Inactive") }]} /></Field>}
      <SubmitButton className="sm:col-span-2">{t("Save")}</SubmitButton>
    </ActionForm>
  );
}
