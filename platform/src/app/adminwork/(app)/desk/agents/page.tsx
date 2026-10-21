import Link from "next/link";
import { Search, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { timeAgo } from "@/lib/dates";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { agentsBoard, supportRoles } from "@/lib/app/desk/agent-admin";
import { travellersWithAgents } from "@/lib/app/desk/agents";
import { Avatar, Badge, Card, CardHead, Empty, Field, Input, PageHeader, Select, Table, Tabs, Td, Th, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { ListFilter, Pager, SummaryStrip, listHref, pageParam } from "@/components/desk/list";
import { AddAgentForm } from "@/components/desk/agents";
import { ProfileFields, RoleTeamFields } from "@/components/desk/agent-fields";
import { addAgentAction } from "../agent-actions";
import { assignPrimaryAction } from "../actions";

export const metadata = { title: "Agents & roles · Desk" };
const FILTERS = ["active", "on", "inactive", "all"] as const;
const LABEL: Record<(typeof FILTERS)[number], string> = { active: "Active", on: "On shift now", inactive: "Deactivated", all: "All" };

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const admin = can(u, "desk.admin");
  const f = (FILTERS as readonly string[]).includes(sp.f ?? "") ? (sp.f as (typeof FILTERS)[number]) : "active";
  const q = sp.q?.trim().toLowerCase().slice(0, 60) ?? "";
  const tq = sp.tq?.trim().slice(0, 60) ?? "";
  const [all, roles, travellers] = await Promise.all([agentsBoard(), supportRoles(), admin ? travellersWithAgents(tq, 25) : Promise.resolve([])]);
  const counts = { active: all.filter((a) => a.active).length, on: all.filter((a) => a.active && a.onShift).length, inactive: all.filter((a) => !a.active).length, all: all.length };
  const shown = all.filter((a) => (f === "active" ? a.active : f === "on" ? a.active && a.onShift : f === "inactive" ? !a.active : true))
    .filter((a) => !q || [a.displayName, a.displayNameAr ?? "", a.userName, a.email].some((s) => s.toLowerCase().includes(q)));
  const { page, offset } = pageParam(sp);
  const rows = shown.slice(offset, offset + 50);
  const href = listHref("/adminwork/desk/agents", { f: sp.f, q: sp.q, tq: sp.tq });
  const name = (id: string | null) => all.find((a) => a.id === id)?.displayName ?? "—";
  const agentOptions = all.filter((a) => a.active).map((a) => ({ value: a.id, label: a.displayName }));

  return (
    <>
      <PageHeader eyebrow={t("Support admin")} title={t("Agents & roles")}
        subtitle={t("Everyone on the desk: their Ops login and role, the name travellers see, and what they're doing now. Add an agent in one step; deactivating hands their work on.")}
        actions={admin ? <a href="#add-agent" className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-[13.5px] text-bg"><UserPlus className="size-4" />{t("Add agent")}</a> : undefined} />
      <Tabs active={f} items={FILTERS.map((k) => ({ key: k, label: t(LABEL[k]), href: href({ f: k === "active" ? undefined : k, page: undefined }), count: k === "all" ? undefined : counts[k] }))} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Card pad={false}>
            <ListFilter action="/adminwork/desk/agents" q={sp.q} keep={{ f: sp.f }} placeholder={t("Name, Ops login or email…")} clear={q ? href({ q: undefined, page: undefined }) : null} />
            <SummaryStrip>
              <span>{t("{n} agents", { n: shown.length })}</span>
              <span>{t("On shift now")} <span className="num text-ink">{counts.on}</span></span>
              <span>{t("Open tickets")} <span className="num text-ink">{shown.reduce((n, a) => n + a.open, 0)}</span></span>
              <span>{t("Handled today")} <span className="num text-ink">{shown.reduce((n, a) => n + a.handledToday, 0)}</span></span>
            </SummaryStrip>
            {rows.length === 0 ? <Empty icon={<UsersRound className="size-5" />} title={q ? t("No agents match") : t("No agents here")} hint={admin ? t("Add an agent: it creates their Ops login, role and desk profile together.") : undefined} /> : (
              <Table>
                <thead><tr><Th>{t("Agent")}</Th><Th>{t("Role")}</Th><Th>{t("Now")}</Th><Th align="end">{t("Open")}</Th><Th align="end">{t("Today")}</Th><Th align="end">{t("Travellers")}</Th></tr></thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id} className="group transition hover:bg-surface-2">
                      <Td><Link href={`/adminwork/desk/agents/${a.id}`} className="flex items-center gap-3">
                        <span className="relative"><Avatar name={a.displayName} size={34} /><span className={cx("absolute -bottom-0.5 -end-0.5 size-3 rounded-full ring-2 ring-surface", !a.active || !a.onShift ? "bg-ink-4" : a.status === "online" ? "bg-ok" : a.status === "away" ? "bg-warn" : "bg-ink-4")} /></span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-2"><bdi className="text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{a.displayName}</bdi>{a.displayNameAr && <span className="text-[12.5px] text-ink-3">{a.displayNameAr}</span>}</span>
                          <span className="block max-w-[280px] truncate text-[12px] text-ink-3"><bdi>{a.userName}</bdi> · <span dir="ltr">{a.email}</span> · {a.languages.map((l) => l.toUpperCase()).join(" ")}</span>
                        </span></Link></Td>
                      <Td className="whitespace-nowrap"><Badge tone={a.roleKey === "support_lead" ? "gold" : a.roleKey.startsWith("partner") ? "brand" : "neutral"}>{L === "ar" ? a.roleNameAr : a.roleName}</Badge><span className="mt-1 block text-[12px] text-ink-3">{a.team === "pakistan" ? t("Pakistan") : a.team === "riyadh" ? t("Riyadh") : t("Management")}</span></Td>
                      <Td className="whitespace-nowrap">
                        {!a.active ? <Badge tone="neutral">{t("Deactivated")}</Badge> : (
                          <>
                            <span className={cx("block", a.onShift ? "text-ok" : "text-ink-3")}>{a.onShift ? (a.covering ? t("Covering for {name}", { name: name(a.covering) }) : t("On shift")) : t("Off shift")}</span>
                            <span className="text-[12px] text-ink-3">{t(a.status === "online" ? "Online" : a.status === "away" ? "Away" : "Signed off")} · {timeAgo(a.statusAt, L)}</span>
                          </>
                        )}
                      </Td>
                      <Td align="end" className="num">{a.open ? <Link className="hover:underline" href={`/adminwork/desk/tickets?o=${a.id}`}>{a.open}</Link> : <span className="text-ink-4">0</span>}</Td>
                      <Td align="end" className="num">{a.handledToday}</Td>
                      <Td align="end" className="num">{a.travellers}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <Pager page={page} total={shown.length} href={href} />
          </Card>

          <Card>
            <CardHead title={t("Roles on the desk")} hint={t("Support agent and Support lead are built in. A lead can add agents and leads; other Ops roles are managed from Team.")} action={<ShieldCheck className="size-4 text-ink-3" />} />
            <div className="grid gap-3 md:grid-cols-2">
              {roles.map((r) => (
                <div key={r.id} className="rounded-2xl bg-surface-2 p-4">
                  <div className="flex items-center gap-2"><span className="text-[14.5px] text-ink">{L === "ar" ? r.nameAr : r.name}</span><span className="num text-[12px] text-ink-3">{t("{n} agents", { n: all.filter((a) => a.active && a.roleKey === r.key).length })}</span></div>
                  <ul className="mt-2 space-y-1 text-[12.5px] text-ink-2">
                    {(r.permissions as Permission[]).filter((p) => p in PERMISSIONS).map((p) => <li key={p} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gold" />{L === "ar" ? PERMISSIONS[p].ar : PERMISSIONS[p].en}</li>)}
                  </ul>
                  {r.key === "support_agent" && <p className="mt-2 text-[12px] text-ink-3">{t("Passports stay masked; the full number needs a lead.")}</p>}
                  {r.key === "support_lead" && <p className="mt-2 text-[12px] text-ink-3">{t("Full passports behind a reveal that is written to the log.")}</p>}
                </div>
              ))}
              {roles.length === 0 && <p className="text-[13px] text-warn">{t("The support roles aren't set up yet (run the migrations).")}</p>}
            </div>
          </Card>
        </div>

        <aside className="space-y-4">
          {admin && (
            <Card id="add-agent" className="scroll-mt-24 ring-2 ring-gold/40">
              <CardHead title={t("Add agent")} hint={t("Creates the Ops login, gives it a support role, makes the desk profile and sends the invite. They start signed off: nothing is routed until they're on the rota.")} action={<UserPlus className="size-4 text-ink-3" />} />
              <AddAgentForm action={addAgentAction} className="grid gap-2 sm:grid-cols-2">
                <Field label={t("Full name")} className="sm:col-span-2"><Input name="name" required maxLength={80} placeholder="Faisal Al-Harbi" /></Field>
                <Field label={t("Email")}><Input name="email" type="email" required dir="ltr" placeholder="faisal@madatrips.com" /></Field>
                <Field label={t("Phone")}><Input name="phone" dir="ltr" placeholder="+9665…" /></Field>
                <RoleTeamFields t={t} roles={roles} />
                <ProfileFields t={t} />
                <SubmitButton className="sm:col-span-2">{t("Add agent")}</SubmitButton>
              </AddAgentForm>
            </Card>
          )}
          {admin && (
            <Card>
              <CardHead title={t("Travellers and their agent")} hint={t("“Faisal, your Mada agent”. Changing it changes who they see.")} />
              <form className="relative mb-3" action="/adminwork/desk/agents">
                {sp.f && <input type="hidden" name="f" value={sp.f} />}
                <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
                <input name="tq" defaultValue={tq} placeholder={t("Search name or phone…")} className="field ps-10" aria-label={t("Search")} />
              </form>
              {travellers.length === 0 ? <p className="text-[13px] text-ink-3">{t("No travellers found")}</p> : (
                <ul className="space-y-1.5">
                  {travellers.map((x) => (
                    <li key={x.id} className="rounded-2xl bg-surface-2 p-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={x.name || "?"} size={30} />
                        <div className="min-w-0 flex-1 leading-tight"><Link href={`/adminwork/desk/customers/${x.id}`} className="block truncate text-[13.5px] text-ink hover:underline">{x.name || t("No name yet")}</Link><div className="num truncate text-[11.5px] text-ink-3" dir="ltr">{x.phone ?? "—"}</div></div>
                      </div>
                      {agentOptions.length > 0 && (
                        <ActionForm action={assignPrimaryAction} className="mt-2 flex gap-2">
                          <input type="hidden" name="userId" value={x.id} />
                          <Select name="agentId" defaultValue={x.agentId ?? ""} placeholder={x.agentId ? undefined : t("Choose an agent")} options={agentOptions} className="h-9 min-w-0 flex-1 py-0 text-[13px]" aria-label={t("Agent")} />
                          <SubmitButton variant="outline" size="sm">{t("Save")}</SubmitButton>
                        </ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
