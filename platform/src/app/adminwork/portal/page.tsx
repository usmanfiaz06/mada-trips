import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { requireClientUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { BASE } from "@/lib/base";
import { fmtDate } from "@/lib/dates";
import { clientCatalog, linesText, scrub, SERVICES, STATUS_LABEL, TRACK, type Line } from "@/lib/portal";
import { Badge, Card, CardHead, Money, Textarea, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { Showroom } from "./showroom";
import { decidePlan, sendToMada } from "./actions";

export const metadata = { title: "Home" };

export default async function PortalHome({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const u = await requireClientUser();
  const t = await getT();
  const ar = t.locale === "ar";
  const { s: tab } = await searchParams;
  const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, u.clientId));
  const requester = alias(schema.users, "requester");
  const [cat, requests, msgs, manager] = await Promise.all([
    clientCatalog(c),
    db.select({ r: schema.portalRequests, by: requester.name }).from(schema.portalRequests)
      .innerJoin(requester, eq(requester.id, schema.portalRequests.requestedBy))
      .where(and(eq(schema.portalRequests.clientId, c.id), inArray(schema.portalRequests.status, ["awaiting_approval", "submitted", "confirmed", "delivering", "active"])))
      .orderBy(desc(schema.portalRequests.updatedAt)),
    db.select({ m: schema.portalMessages, author: schema.users.name }).from(schema.portalMessages)
      .leftJoin(schema.users, eq(schema.users.id, schema.portalMessages.authorId))
      .where(eq(schema.portalMessages.clientId, c.id)).orderBy(desc(schema.portalMessages.createdAt)).limit(40),
    c.accountManagerId ? db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, c.accountManagerId)).then((r) => r[0]?.name ?? null) : Promise.resolve(null),
  ]);
  const services = c.portalServices as Record<string, string>;
  const offered = SERVICES.filter((s) => services[s.key]);
  const active = offered.find((s) => s.key === tab) ?? offered[0];
  const canApprove = u.clientRole === "admin" || u.clientRole === "approver";
  const pending = requests.filter((x) => x.r.status === "awaiting_approval");
  const latest = requests.find((x) => x.r.status !== "awaiting_approval") ?? requests[0];
  const selfApproves = !c.portalNeedsApproval || canApprove;

  // Everything below is what this client sees: hidden names are replaced before anything leaves the server,
  // and nobody at Mada is ever shown by name.
  const view = scrub({
    manager: manager ?? "Mada team",
    msgs: msgs.reverse().map(({ m, author }) => ({ id: m.id, side: m.side, kind: m.kind, body: m.body, at: m.createdAt, who: m.side === "client" ? author ?? "" : m.side === "system" ? "Mada" : "Mada team" })),
    pending: pending.map(({ r, by }) => ({ id: r.id, ref: r.ref, lines: linesText(r.lines as Line[]), term: r.term, monthly: r.monthly, by, mine: r.requestedBy === u.id })),
    latest: latest ? { ref: latest.r.ref, lines: linesText(latest.r.lines as Line[]), status: latest.r.status, term: latest.r.term } : null,
    cars: cat.vehicles,
  }, c.hiddenNames);

  const step = view.latest ? TRACK.indexOf(view.latest.status as (typeof TRACK)[number]) : -1;

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav className="flex flex-wrap gap-1 rounded-full bg-sunken p-1" aria-label={t("Service")}>
            {offered.map((s) => (
              <a key={s.key} href={`?s=${s.key}`} aria-current={s.key === active?.key ? "page" : undefined}
                className={cx("flex h-9 items-center rounded-full px-4 text-[13.5px] transition", s.key === active?.key ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink")}>{ar ? s.ar : s.en}</a>
            ))}
          </nav>
          <span className="text-[13px] text-ink-3">{t("Prepared for {name}", { name: c.name })}</span>
        </div>

        {active && services[active.key] === "price" && active.key === "lease" ? (
          <Showroom cars={view.cars} terms={cat.terms} base={BASE} canSend={u.clientRole !== "viewer"}
            sendLabel={selfApproves ? t("Send to Mada") : t("Send for approval")} defaultContact={u.name} />
        ) : active ? (
          <Card>
            <CardHead title={ar ? active.ar : active.en} hint={t("Quoted per request. Tell us dates, cities and numbers and Mada replies here.")} />
            <ActionForm action={sendToMada} resetOnOk className="space-y-3">
              <input type="hidden" name="kind" value="price" />
              <Textarea name="body" rows={4} placeholder={t("What do you need? Dates, cities, how many people or cars.")} />
              <SubmitButton>{t("Ask for a quote")}</SubmitButton>
            </ActionForm>
          </Card>
        ) : <Card><p className="text-[14px] text-ink-3">{t("No services are set up for your company yet. Mada will add them.")}</p></Card>}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHead title={t("Latest request")} />
            {!view.latest ? <p className="text-[13.5px] text-ink-3">{t("Build a plan above and send it. You'll follow it here until the cars are at your door.")}</p> : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div><div className="text-[15px] font-medium">{view.latest.lines}</div><div className="font-mono text-[11.5px] text-ink-3">{view.latest.ref} · {view.latest.term} {t("months")}</div></div>
                  <Badge tone="gold">{t(STATUS_LABEL[view.latest.status])}</Badge>
                </div>
                <ol className="mt-4 space-y-0">
                  {TRACK.map((s, i) => (
                    <li key={s} className="flex gap-3">
                      <span className="flex w-3.5 flex-col items-center">
                        <span className={cx("mt-1 size-3 shrink-0 rounded-full", i < step ? "bg-ok" : i === step ? "bg-gold ring-4 ring-gold/25" : "bg-line-strong")} />
                        {i < TRACK.length - 1 && <span className={cx("min-h-3 w-0.5 flex-1", i < step ? "bg-ok" : "bg-line")} />}
                      </span>
                      <span className={cx("pb-2.5 text-[13px]", i <= step ? "font-medium text-ink" : "text-ink-3")}>{t(s === "completed" ? "Lease complete" : s === "active" ? "Delivered to your door" : STATUS_LABEL[s])}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </Card>
          <Card>
            <CardHead title={t("Approvals")} action={<Badge>{view.pending.length}</Badge>} />
            {view.pending.length === 0 ? <p className="text-[13.5px] text-ink-3">{t("Nothing waiting.")}</p> : (
              <div className="space-y-3">
                {view.pending.map((p) => (
                  <div key={p.id} className="rounded-2xl bg-surface-2 p-4 ring-1 ring-line">
                    <div className="text-[14px] font-medium">{p.lines}</div>
                    <div className="text-[12px] text-ink-3">{t("From {name} · {n} months", { name: p.by, n: p.term })} · <span className="font-mono">{p.ref}</span></div>
                    <div className="mt-2 flex items-baseline justify-between"><span className="text-[12px] text-ink-3">{t("Monthly")}</span><Money v={p.monthly} className="text-[16px] font-medium text-ink" /></div>
                    {canApprove && !p.mine ? (
                      <ActionForm action={decidePlan} className="mt-3 space-y-2">
                        <input type="hidden" name="id" value={p.id} />
                        <input name="note" className="field" placeholder={t("Note (needed to decline)")} />
                        <div className="grid grid-cols-2 gap-2">
                          <SubmitButton name="op" value="decline" variant="soft">{t("Decline")}</SubmitButton>
                          <SubmitButton name="op" value="approve">{t("Approve")}</SubmitButton>
                        </div>
                      </ActionForm>
                    ) : <p className="mt-2 text-[12px] text-ink-3">{p.mine ? t("Waiting for another approver.") : t("Waiting for an approver.")}</p>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Mada desk */}
      <aside id="desk" className="flex flex-col overflow-hidden rounded-card bg-surface shadow-card 2xl:sticky 2xl:top-24 2xl:max-h-[calc(100dvh-7.5rem)]">
        <div className="flex items-center gap-3 border-b border-line p-5">
          <span className="grid size-11 place-items-center rounded-2xl bg-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${BASE}/symbol-gold.svg`} alt="" className="h-5" />
          </span>
          <div><div className="text-[15px] font-medium">{t("Mada desk")}</div><div className="text-[12px] text-ink-3">{view.manager} · {t("8am–10pm")}</div></div>
        </div>
        <details className="border-b border-line px-5 py-3">
          <summary className="cursor-pointer text-[13px] font-medium">{t("Book a call")}</summary>
          <ActionForm action={sendToMada} className="mt-3 space-y-2">
            <input type="hidden" name="kind" value="call" />
            <select name="slot" className="field" aria-label={t("When")}>
              {["as soon as possible", "today after 4pm", "tomorrow morning", "tomorrow afternoon"].map((x) => <option key={x} value={x}>{t(x)}</option>)}
            </select>
            <SubmitButton size="sm">{t("Request call")}</SubmitButton>
          </ActionForm>
        </details>
        <details className="border-b border-line px-5 py-3">
          <summary className="cursor-pointer text-[13px] font-medium">{t("Report an issue with a car")}</summary>
          <ActionForm action={sendToMada} resetOnOk className="mt-3 space-y-2">
            <input type="hidden" name="kind" value="issue" />
            <select name="what" className="field" aria-label={t("What happened")}>
              {["Breakdown", "Accident", "Service due", "Other"].map((x) => <option key={x} value={x}>{t(x)}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2"><input name="plate" className="field" placeholder={t("Plate")} /><input name="where" className="field" placeholder={t("Where")} /></div>
            <SubmitButton size="sm">{t("Send to roadside team")}</SubmitButton>
          </ActionForm>
        </details>
        <div className="flex min-h-[220px] flex-1 flex-col gap-3 overflow-y-auto p-5" aria-live="polite">
          {view.msgs.length === 0 && <p className="text-[13px] text-ink-3">{t("Ask anything: prices, other models, delivery, your invoices.")}</p>}
          {view.msgs.map((m) => {
            const me = m.side === "client";
            return (
              <div key={m.id} className={cx("flex flex-col gap-1", me ? "items-end" : "items-start")}>
                <div className={cx("max-w-[88%] whitespace-pre-wrap rounded-[16px] px-3.5 py-2.5 text-[13px] leading-relaxed", me ? "bg-brand text-brand-ink" : m.side === "system" ? "bg-sunken text-ink-2" : "bg-surface-2 text-ink ring-1 ring-line")}>{m.body}</div>
                <span className="text-[11px] text-ink-3">{m.who} · {fmtDate(m.at, t.locale, true)}</span>
              </div>
            );
          })}
        </div>
        <ActionForm action={sendToMada} resetOnOk className="flex items-end gap-2 border-t border-line p-4">
          <input type="hidden" name="kind" value="message" />
          <textarea name="body" rows={2} className="field flex-1" placeholder={t("Write to Mada")} aria-label={t("Message")} />
          <SubmitButton>{t("Send")}</SubmitButton>
        </ActionForm>
      </aside>
    </div>
  );
}

