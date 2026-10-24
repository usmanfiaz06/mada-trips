import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireClientUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { timeAgo } from "@/lib/dates";
import { Badge, Card, CardHead, Field, Input, PageHeader, Select } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { inviteTeammate, setTeammate } from "../actions";

export const metadata = { title: "Team" };
const ROLES = [
  { value: "admin", label: "Admin", hint: "Everything, including adding people and approving plans." },
  { value: "approver", label: "Approver", hint: "Approves or declines plans before they go to Mada." },
  { value: "requester", label: "Requester", hint: "Builds plans and sends them for approval." },
  { value: "viewer", label: "Viewer", hint: "Can look, can't send anything." },
];

export default async function Team() {
  const u = await requireClientUser();
  const t = await getT();
  const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, u.clientId));
  const people = await db.select().from(schema.users).where(eq(schema.users.clientId, c.id)).orderBy(asc(schema.users.name));
  const admin = u.clientRole === "admin";
  return (
    <>
      <PageHeader title={t("Team")} subtitle={t("Who at {name} can use this workspace.", { name: c.name })} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card pad={false}>
          <ul>
            {people.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3.5 last:border-0">
                <span className="grid size-9 place-items-center rounded-full bg-sunken text-[12px] font-semibold">{p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{p.name}{p.id === u.id && <span className="text-ink-3"> · {t("you")}</span>}</div>
                  <div className="truncate text-[12px] text-ink-3">{p.email} · {p.lastSeenAt ? t("seen {ago}", { ago: timeAgo(p.lastSeenAt, t.locale) }) : t("hasn't signed in yet")}</div>
                </div>
                {!p.active && <Badge tone="bad">{t("Off")}</Badge>}
                {admin && p.id !== u.id ? (
                  <ActionForm action={setTeammate} className="flex items-center gap-1.5">
                    <input type="hidden" name="id" value={p.id} />
                    <select name="op" defaultValue={p.clientRole ?? "viewer"} className="field h-8 w-auto py-0 text-[12.5px]" aria-label={t("Role")}>
                      {ROLES.map((r) => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
                    </select>
                    <SubmitButton size="sm" variant="soft">{t("Save")}</SubmitButton>
                  </ActionForm>
                ) : <Badge>{t(ROLES.find((r) => r.value === p.clientRole)?.label ?? "")}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-4">
          {admin && (
            <Card>
              <CardHead title={t("Add someone")} hint={t("They get a temporary password and choose their own on first sign-in.")} />
              <ActionForm action={inviteTeammate} resetOnOk className="space-y-3">
                <Field label={t("Name")}><Input name="name" required /></Field>
                <Field label={t("Work email")}><Input name="email" type="email" required placeholder={`name@${u.email.split("@")[1]}`} /></Field>
                <Field label={t("Role")}><Select name="role" defaultValue="requester" options={ROLES.map((r) => ({ value: r.value, label: t(r.label) }))} /></Field>
                <SubmitButton>{t("Add")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Card>
            <CardHead title={t("Roles")} />
            <dl className="space-y-3 text-[13px]">{ROLES.map((r) => <div key={r.value}><dt className="font-medium">{t(r.label)}</dt><dd className="text-ink-3">{t(r.hint)}</dd></div>)}</dl>
          </Card>
        </div>
      </div>
    </>
  );
}
