import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { ArrowLeft, EyeOff } from "lucide-react";
import { db, schema } from "@/db";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { timeAgo } from "@/lib/dates";
import { amountInput, sar } from "@/lib/money";
import { agreedPrices, catalog, costFor, LEASE_TERMS, priceFor, SERVICES, siteOrigin, staffList, vehicleName, workspaceLink } from "@/lib/portal";
import { isUuid } from "@/lib/security";
import { Badge, Card, CardHead, Field, Input, LinkButton, Select, Table, Td, Textarea, Th, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { ClientMark } from "../../client-mark";
import { CopyLink } from "../../copy-link";
import { addClientLogin, manageClientLogin, savePricing, saveWorkspace, uploadLogo } from "../../actions";

const ROLES = [
  { value: "admin", label: "Admin · everything, adds people" },
  { value: "approver", label: "Approver · approves plans" },
  { value: "requester", label: "Requester · builds plans" },
  { value: "viewer", label: "Viewer · can only look" },
];

export default async function WorkspaceSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const u = await requirePerm("clients.manage");
  const t = await getT();
  const ar = t.locale === "ar";
  const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, id));
  if (!c) notFound();
  const pricing = can(u, "clients.credit");
  const [staff, people, cars, agreed, origin] = await Promise.all([
    staffList(),
    db.select().from(schema.users).where(eq(schema.users.clientId, id)).orderBy(asc(schema.users.name)),
    catalog(), agreedPrices(id), siteOrigin(),
  ]);
  const link = workspaceLink(origin, c.portalSlug);
  const services = c.portalServices as Record<string, string>;
  const terms = [...c.portalTerms].sort((a, b) => a - b);

  return (
    <>
      <Link href="/adminwork/corporate" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Workspace requests")}</Link>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <ClientMark clientId={c.id} name={c.name} hasLogo={!!c.portalLogoId} color={c.portalColor} size={52} />
          <div>
            <Badge tone={c.portalEnabled ? "ok" : "neutral"} dot>{c.portalEnabled ? t("Workspace on") : t("Workspace off")}</Badge>
            <h1 className="mt-2 text-[32px] font-[380] leading-none tracking-[-0.035em]">{c.name}</h1>
          </div>
        </div>
        <div className="flex gap-2">
          <LinkButton href={`/adminwork/corporate/inbox?c=${c.id}`} variant="outline">{t("Messages")}</LinkButton>
          <LinkButton href={`/adminwork/clients/${c.id}`} variant="outline">{t("Credit and sales")}</LinkButton>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHead title={t("Workspace")} hint={t("What this company sees when its people sign in.")} />
          <ActionForm action={saveWorkspace} className="space-y-4">
            <input type="hidden" name="id" value={c.id} />
            <label className="flex items-center justify-between gap-3 rounded-2xl bg-sunken px-4 py-3 text-[14px]">
              <span>{t("Workspace is on")}<span className="block text-[12px] text-ink-3">{t("Off: nobody at this company can sign in.")}</span></span>
              <input type="checkbox" name="enabled" defaultChecked={c.portalEnabled} className="size-5 accent-[var(--brand)]" />
            </label>
            <Field label={t("Link name")} hint={t("Their sign-in link is /corporate/ followed by this. Lowercase letters, numbers and dashes.")}>
              <Input name="slug" defaultValue={c.portalSlug ?? ""} dir="ltr" className="font-mono" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("Account manager")}><Select name="accountManagerId" defaultValue={c.accountManagerId ?? ""} placeholder={t("Nobody")} options={staff.map((s) => ({ value: s.id, label: s.name }))} /></Field>
              <Field label={t("Brand colour")}><Input type="color" name="color" defaultValue={c.portalColor ?? "#1e352d"} className="h-11 p-1" /></Field>
            </div>
            <div>
              <div className="mb-2 text-[12.5px] text-ink-3">{t("Services they can order")}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {SERVICES.map((s) => (
                  <label key={s.key} className="flex items-center justify-between gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-[13.5px] ring-1 ring-line">
                    <span>{ar ? s.ar : s.en}</span>
                    <select name={`svc_${s.key}`} defaultValue={services[s.key] ?? ""} className="field h-9 w-auto py-0 text-[13px]">
                      <option value="">{t("Not offered")}</option><option value="price">{t("Show prices")}</option><option value="quote">{t("Quote on request")}</option>
                    </select>
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-2xl bg-sunken px-4 py-3 text-[14px]">
              <span>{t("Plans need an approver at the company")}<span className="block text-[12px] text-ink-3">{t("Requesters' plans wait for an approver or admin before they reach Mada.")}</span></span>
              <input type="checkbox" name="needsApproval" defaultChecked={c.portalNeedsApproval} className="size-5 accent-[var(--brand)]" />
            </label>
            <Field label={<span className="flex items-center gap-1.5"><EyeOff className="size-3.5" />{t("Names never shown to this client")}</span>}
              hint={t("Comma or one per line. Wherever these appear (messages, updates, documents) the client sees “Mada team”. Spelling variants and Arabic are caught. Haneef and Abdulaziz are always hidden from every client.")}>
              <Textarea name="hiddenNames" rows={2} defaultValue={c.hiddenNames.join(", ")} placeholder={t("e.g. names of Mada partners or staff")} />
            </Field>
            <SubmitButton>{t("Save workspace")}</SubmitButton>
          </ActionForm>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHead title={t("Sign-in link")} hint={t("Send this to people at {name} with their login. It opens a sign-in page with their logo; they land straight in their workspace.", { name: c.name })} />
            <CopyLink url={link} />
          </Card>
          <Card>
            <CardHead title={t("Logo")} hint={t("Shown next to Mada's in their workspace. PNG, JPEG or WebP, under 2 MB.")} />
            <div className="flex flex-wrap items-center gap-4">
              <ClientMark clientId={c.id} name={c.name} hasLogo={!!c.portalLogoId} color={c.portalColor} size={56} />
              <ActionForm action={uploadLogo} className="flex flex-1 flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={c.id} />
                <input type="file" name="file" accept="image/png,image/jpeg,image/webp" className="text-[13px]" />
                <SubmitButton variant="outline" size="sm">{t("Upload")}</SubmitButton>
              </ActionForm>
            </div>
          </Card>

          <Card pad={false}>
            <div className="p-6 pb-2"><CardHead title={t("Logins")} hint={t("People at {name}. They sign in at the same Mada Ops page and see only their company.", { name: c.name })} /></div>
            <ul>
              {people.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{p.name} {!p.active && <Badge tone="bad">{t("Off")}</Badge>} {p.mustChangePassword && <Badge tone="info">{t("Not signed in yet")}</Badge>}</div>
                    <div className="truncate text-[12px] text-ink-3">{p.email} · {p.lastSeenAt ? t("seen {ago}", { ago: timeAgo(p.lastSeenAt, t.locale) }) : t("never signed in")}</div>
                  </div>
                  <ActionForm action={manageClientLogin} className="flex flex-wrap items-center gap-1.5">
                    <input type="hidden" name="id" value={p.id} />
                    <select name="role" defaultValue={p.clientRole ?? "viewer"} className="field h-8 w-auto py-0 text-[12.5px]" aria-label={t("Role")}>
                      {ROLES.map((r) => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
                    </select>
                    <SubmitButton size="sm" variant="soft" name="op" value="role">{t("Set role")}</SubmitButton>
                    <SubmitButton size="sm" variant="ghost" name="op" value="reset" confirm={t("Give {name} a new temporary password?", { name: p.name })}>{t("Reset password")}</SubmitButton>
                    <SubmitButton size="sm" variant="ghost" name="op" value="toggle">{p.active ? t("Switch off") : t("Switch on")}</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
            <div className="border-t border-line p-6">
              <ActionForm action={addClientLogin} resetOnOk>
                <div className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="clientId" value={c.id} />
                <Field label={t("Name")}><Input name="name" required /></Field>
                <Field label={t("Work email")}><Input name="email" type="email" required /></Field>
                <Field label={t("Role")}><Select name="role" defaultValue="admin" options={ROLES.map((r) => ({ value: r.value, label: t(r.label) }))} /></Field>
                <div className="flex items-end"><SubmitButton>{t("Create login")}</SubmitButton></div>
                </div>
              </ActionForm>
            </div>
          </Card>
        </div>
      </div>

      {pricing && (
        <Card className="mt-4">
          <CardHead title={t("Cars and prices")} hint={t("Monthly, before VAT. Supplier and cost stay in Ops. An agreed price beats markup and list price; leave a box empty to use the automatic price.")} />
          <ActionForm action={savePricing} className="space-y-4">
            <input type="hidden" name="id" value={c.id} />
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[13.5px]">
              <span className="text-ink-3">{t("Terms offered")}</span>
              {LEASE_TERMS.map((tm) => (
                <label key={tm} className="flex items-center gap-1.5"><input type="checkbox" name={`term_${tm}`} defaultChecked={terms.includes(tm)} className="size-4 accent-[var(--brand)]" />{tm} {t("months")}</label>
              ))}
              <span className="ms-auto flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5"><input type="radio" name="mode" value="list" defaultChecked={c.portalMarkupBps === null} className="accent-[var(--brand)]" />{t("List prices")}</label>
                <label className="flex items-center gap-1.5"><input type="radio" name="mode" value="markup" defaultChecked={c.portalMarkupBps !== null} className="accent-[var(--brand)]" />{t("Markup on cost")}</label>
                <Input name="markup" inputMode="decimal" defaultValue={c.portalMarkupBps !== null ? String(c.portalMarkupBps / 100) : "6"} className="h-9 w-20" aria-label={t("Markup %")} /> %
              </span>
            </div>
            <Table>
              <thead><tr><Th>{t("Show")}</Th><Th>{t("Vehicle")}</Th>{terms.map((tm) => <Th key={tm}>{tm} {t("months")}</Th>)}</tr></thead>
              <tbody>
                {cars.map((v) => (
                  <tr key={v.id}>
                    <Td><input type="checkbox" name={`show_${v.key}`} defaultChecked={!c.portalHiddenVehicles.includes(v.key)} className="size-4 accent-[var(--brand)]" aria-label={t("Show {name}", { name: vehicleName(v) })} /></Td>
                    <Td><div className="font-medium text-ink">{vehicleName(v)}</div><div className="text-[12px] text-ink-3">{v.onRequest ? t("Price on request") : v.supplier ?? t("No supplier set")}</div></Td>
                    {terms.map((tm) => {
                      const cost = costFor(v, tm);
                      const own = agreed.get(`${v.id}:${tm}`);
                      const auto = priceFor({ portalMarkupBps: c.portalMarkupBps }, v, tm);
                      const eff = own ?? auto;
                      const margin = cost !== null && eff !== null ? eff - cost : null;
                      return (
                        <Td key={tm}>
                          {v.onRequest ? <span className="text-[12px] text-ink-3">—</span> : (
                            <>
                              <Input name={`price_${v.key}_${tm}`} inputMode="decimal" defaultValue={own !== undefined ? amountInput(own) : ""} placeholder={auto !== null ? sar(auto) : t("No price")} className="h-9 w-[120px] num" dir="ltr" />
                              <div className="mt-1 text-[11.5px] text-ink-3" dir="ltr">
                                {cost === null ? t("no cost") : `${t("cost")} ${sar(cost)}`}
                                {margin !== null && <span className={cx("ms-1.5 font-medium", margin > 0 ? "text-ok" : "text-bad")}>{margin > 0 ? `+${sar(margin)}` : t("at cost")}</span>}
                              </div>
                            </>
                          )}
                        </Td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </Table>
            <SubmitButton>{t("Save prices")}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
