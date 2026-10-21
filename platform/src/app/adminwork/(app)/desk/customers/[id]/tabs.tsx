import Link from "next/link";
import { Bot, Brain, CreditCard, History, Lock, MessagesSquare, Receipt, ShoppingBag, Smartphone, Wallet } from "lucide-react";
import type { CurrentUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { ESIM_STATUS, ORDER_STAGE, PAY_STATUS, REFUND_STAGE, REQUEST_KIND, REQUEST_STATUS } from "@/lib/labels";
import { bookingStage } from "@/lib/app/desk/adapters";
import { DeskError } from "@/lib/app/desk/core";
import {
  customerAudit, customerBookings, customerChats, customerCredit, customerEsims, customerMemory, customerPayments, customerRequests, readAskThread,
  type Customer, type OpenItem,
} from "@/lib/app/desk/customers";
import { Badge, Card, CardHead, Empty, KV, Money, Table, Td, Th, cx } from "@/components/ui";
import { PassportReveal } from "@/components/desk/live";
import { StatusBadge } from "@/components/desk/parts";
import { revealCustomerPassportAction } from "../actions";

/* The customer page's tabs (server components). Each one reads only what it shows. */

export const OPEN_KIND: Record<OpenItem["kind"], string> = { request: "Request", order: "Booking", refund: "Refund to decide", esim: "eSIM with Mada", chat: "Chat waiting for a reply" };
const RELATION: Record<string, string> = { self: "Account holder", spouse: "Spouse", child: "Child", parent: "Parent", sibling: "Sibling", helper: "Helper", friend: "Friend", other: "Other" };
const CONTACT: Record<string, string> = { call: "A call", whatsapp: "WhatsApp", in_app: "In the app" };
const CREDIT_KIND: Record<string, string> = { refund: "Refund", goodwill: "Goodwill", spend: "Spent", expiry: "Expired", adjustment: "Adjustment" };
const MEMORY_KIND: Record<string, string> = {
  home_airport: "Home airport", airline: "Airline", cabin: "Cabin", seat: "Seat", budget: "Budget", food: "Food", mobility: "Mobility", health: "Health", family: "Family", contact: "Contact", other: "Other",
};
const orderKindLabel = (k: string) => ({ flight: "Flights", stay: "Stay", trip: "Trip", package: "Package", esim: "eSIM", quote: "Quote", share: "Shared pay" } as Record<string, string>)[k] ?? k;
const linkCls = "text-ink decoration-gold decoration-2 underline-offset-4 hover:underline";

export async function OverviewTab({ c, canReveal }: { c: Customer; canReveal: boolean }) {
  const t = await getT();
  const L = t.locale;
  const u = c.user;
  const flags = [
    c.flags.blocked && <Badge key="b" tone="bad" dot>{t("Blocked")}</Badge>,
    c.flags.deleted && <Badge key="d" tone="neutral" dot>{t("Account deleted")}</Badge>,
    c.flags.notificationsOff && <Badge key="n" tone="warn" dot>{t("Notifications off")}</Badge>,
    c.flags.unverified && <Badge key="v" tone="warn" dot>{t("Not verified")}</Badge>,
    c.flags.passportsExpiring > 0 && <Badge key="p" tone="warn" dot>{t("{n} passports under 6 months", { n: c.flags.passportsExpiring })}</Badge>,
    u.alerts === "everything" && <Badge key="a" tone="info" dot>{t("Wants every alert")}</Badge>,
  ].filter(Boolean);
  return (
    <>
      <Card>
        <CardHead title={t("Who")} action={flags.length ? <div className="flex flex-wrap justify-end gap-1.5">{flags}</div> : undefined} />
        <KV cols={3} items={[
          [t("Name"), <bdi key="n">{u.name || "—"}</bdi>],
          [t("Phone"), u.phone ? <span key="p" className="num" dir="ltr">{u.phone}{u.phoneVerified ? " ✓" : ""}</span> : "—"],
          [t("Email"), u.email ? <span key="e" dir="ltr">{u.email}{u.emailVerified ? " ✓" : ""}</span> : "—"],
          [t("Language"), u.locale === "ar" ? "العربية" : "English"],
          [t("Contact preference"), c.contact ? `${t(CONTACT[c.contact.preference] ?? c.contact.preference)}${c.contact.window ? ` · ${c.contact.window}` : ""}` : t("In the app")],
          [t("Primary agent"), c.agent?.name ?? t("Shared queue")],
        ]} />
      </Card>

      <Card pad={false}>
        <div className="px-6 pt-6"><CardHead title={t("Household")} hint={canReveal ? t("Full passport numbers open for 30 seconds, and every look is logged.") : t("Passport numbers show the last three characters. Issuing rights show them in full.")} /></div>
        {c.household.length === 0 ? <Empty title={t("No travellers saved")} hint={t("People they book for appear here once they add them in the app.")} /> : (
          <Table>
            <thead><tr><Th>{t("Name")}</Th><Th>{t("Relation")}</Th><Th>{t("Born")}</Th><Th>{t("Nationality")}</Th><Th>{t("Passport")}</Th><Th>{t("Expires")}</Th></tr></thead>
            <tbody>
              {c.household.map((p) => (
                <tr key={p.id}>
                  <Td className="whitespace-nowrap"><bdi className="text-ink">{p.name}</bdi></Td>
                  <Td className="whitespace-nowrap">{t(RELATION[p.relation] ?? p.relation)}</Td>
                  <Td className="whitespace-nowrap">{p.dateOfBirth ? fmtDate(p.dateOfBirth, L) : "—"}</Td>
                  <Td>{p.nationality ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{p.passportMasked ? <PassportReveal masked={p.passportMasked} can={canReveal && p.hasPassport} reveal={revealCustomerPassportAction.bind(null, u.id, p.id)} /> : <span className="text-ink-4">{t("Missing")}</span>}</Td>
                  <Td className="whitespace-nowrap">{p.passportExpiry ? <span className={p.expiresSoon ? "text-bad" : ""}>{fmtDate(p.passportExpiry, L)}</span> : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card pad={false}>
        <div className="px-6 pt-6"><CardHead title={t("Open items")} hint={t("Everything this customer is waiting on, oldest first.")} /></div>
        {c.open.length === 0 ? <Empty title={t("Nothing open")} hint={t("No requests, refunds, eSIMs or chats are waiting on the desk.")} /> : (
          <Table>
            <thead><tr><Th>{t("What")}</Th><Th>{t("Type")}</Th><Th>{t("Since")}</Th></tr></thead>
            <tbody>
              {c.open.map((o) => (
                <tr key={`${o.kind}${o.id}`} className="group transition hover:bg-surface-2">
                  <Td><Link href={o.href} className={cx("block max-w-[420px] truncate", linkCls)}>{o.title}</Link></Td>
                  <Td className="whitespace-nowrap">{t(OPEN_KIND[o.kind])}</Td>
                  <Td className="whitespace-nowrap text-[12.5px] text-ink-3">{timeAgo(o.at, L)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHead title={t("Next trip")} />
          {c.trip ? <KV cols={1} items={[[t("Where"), c.trip.city], [t("When"), `${fmtDate(c.trip.startDate, L)}${c.trip.endDate ? ` – ${fmtDate(c.trip.endDate, L)}` : ""}`], [t("Booking ref"), c.trip.bookingRef ? <span key="r" className="num" dir="ltr">{c.trip.bookingRef}</span> : "—"]]} />
            : <p className="text-[13px] text-ink-3">{t("No upcoming trips.")}</p>}
        </Card>
        <Card>
          <CardHead title={t("Last chat")} action={c.lastChat ? <Link href={`/adminwork/desk/chats?t=support:${c.lastChat.threadId}`} className="text-[12.5px] text-info hover:underline">{t("Open")}</Link> : undefined} />
          {c.lastChat ? <><p dir="auto" className="line-clamp-3 text-[13.5px] text-ink-2">{c.lastChat.body}</p><p className="mt-2 text-[12px] text-ink-3">{c.lastChat.authorKind === "user" ? t("From the traveller") : t("From the desk")} · {timeAgo(c.lastChat.createdAt, L)}</p></>
            : <p className="text-[13px] text-ink-3">{t("They haven't written to the desk yet.")}</p>}
        </Card>
      </div>
    </>
  );
}

export async function BookingsTab({ userId }: { userId: string }) {
  const t = await getT();
  const L = t.locale;
  const b = await customerBookings(userId);
  return (
    <>
      <Card pad={false}>
        <div className="px-6 pt-6"><CardHead title={t("Bookings")} hint={t("{n} orders", { n: b.orders.length })} /></div>
        {b.orders.length === 0 ? <Empty icon={<ShoppingBag className="size-5" />} title={t("No bookings yet")} /> : (
          <Table>
            <thead><tr><Th>{t("Booking")}</Th><Th>{t("Type")}</Th><Th>{t("Status")}</Th><Th>{t("Supplier ref")}</Th><Th align="end">{t("Total")}</Th></tr></thead>
            <tbody>
              {b.orders.map((o) => (
                <tr key={o.id} className="group transition hover:bg-surface-2">
                  <Td>{o.href ? <Link href={o.href} className={cx("block max-w-[300px] truncate", linkCls)}>{o.title}</Link> : <span className="block max-w-[300px] truncate text-ink">{o.title}</span>}
                    <span className="block text-[12px] text-ink-3"><span className="num">{o.ref}</span> · {fmtDate(o.createdAt, L)}</span></Td>
                  <Td className="whitespace-nowrap">{t(orderKindLabel(o.kind))}</Td>
                  <Td>{o.engine ? <StatusBadge map={ORDER_STAGE} value={bookingStage(o.status)} /> : <StatusBadge map={REQUEST_STATUS} value={o.status} />}</Td>
                  <Td className="num whitespace-nowrap" >{o.supplierRef ? <span dir="ltr">{o.supplierRef}</span> : "—"}</Td>
                  <Td align="end">{o.total != null ? <Money v={o.total} /> : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card pad={false}>
        <div className="px-6 pt-6"><CardHead title={t("Trips")} /></div>
        {b.trips.length === 0 ? <Empty title={t("No trips")} /> : (
          <Table>
            <thead><tr><Th>{t("Where")}</Th><Th>{t("When")}</Th><Th>{t("Status")}</Th><Th>{t("Flights")}</Th><Th>{t("PNR")}</Th></tr></thead>
            <tbody>
              {b.trips.map((tr) => {
                const pnrs = [...new Set([tr.bookingRef, ...tr.segments.map((s) => s.pnr)].filter(Boolean))];
                return (
                  <tr key={tr.id}>
                    <Td className="whitespace-nowrap text-ink">{tr.city}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(tr.startDate, L)}{tr.endDate ? ` – ${fmtDate(tr.endDate, L)}` : ""}</Td>
                    <Td><Badge tone={tr.status === "cancelled" ? "bad" : tr.status === "planning" ? "neutral" : "ok"} dot>{t(tr.status[0]!.toUpperCase() + tr.status.slice(1))}</Badge></Td>
                    <Td className="whitespace-nowrap text-[12.5px]" ><span dir="ltr">{tr.segments.map((s) => `${s.flight} ${s.from}→${s.to}`).join(", ") || "—"}</span></Td>
                    <Td className="num whitespace-nowrap"><span dir="ltr">{pnrs.join(", ") || "—"}</span></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

export async function PaymentsTab({ userId }: { userId: string }) {
  const t = await getT();
  const L = t.locale;
  const { payments, refunds, invoices } = await customerPayments(userId);
  return (
    <>
      <Card pad={false}>
        <div className="px-6 pt-6"><CardHead title={t("Payments")} /></div>
        {payments.length === 0 ? <Empty icon={<CreditCard className="size-5" />} title={t("No payments yet")} /> : (
          <Table>
            <thead><tr><Th>{t("When")}</Th><Th>{t("Paid with")}</Th><Th>{t("Status")}</Th><Th>{t("Provider ref")}</Th><Th align="end">{t("Amount")}</Th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <Td className="whitespace-nowrap">{fmtDate(p.createdAt, L, true)}</Td>
                  <Td className="whitespace-nowrap">{p.label ?? p.method}{p.instalments > 1 ? ` · ${t("{n} instalments", { n: p.instalments })}` : ""}</Td>
                  <Td><StatusBadge map={PAY_STATUS} value={p.status} /></Td>
                  <Td className="num max-w-[160px] truncate text-[12.5px] text-ink-3"><span dir="ltr">{p.providerRef ?? "—"}</span></Td>
                  <Td align="end"><Money v={p.amount} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card pad={false}>
        <div className="px-6 pt-6"><CardHead title={t("Refunds")} /></div>
        {refunds.length === 0 ? <Empty title={t("No refunds")} /> : (
          <Table>
            <thead><tr><Th>{t("Asked")}</Th><Th>{t("To")}</Th><Th>{t("Status")}</Th><Th>{t("Expected by")}</Th><Th align="end">{t("Amount")}</Th></tr></thead>
            <tbody>
              {refunds.map((f) => (
                <tr key={f.id} className="group transition hover:bg-surface-2">
                  <Td className="whitespace-nowrap"><Link href={`/adminwork/desk/refunds?s=${f.stage}&focus=${f.id}`} className={linkCls}>{fmtDate(f.createdAt, L)}</Link></Td>
                  <Td className="whitespace-nowrap">{f.destination === "credit" ? t("Mada credit") : t("The card")}</Td>
                  <Td><StatusBadge map={REFUND_STAGE} value={f.stage} /></Td>
                  <Td className="whitespace-nowrap">{f.expectedBy ? fmtDate(f.expectedBy, L) : "—"}</Td>
                  <Td align="end"><Money v={f.amount} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card pad={false}>
        <div className="px-6 pt-6"><CardHead title={t("Invoices")} /></div>
        {invoices.length === 0 ? <Empty icon={<Receipt className="size-5" />} title={t("No invoices")} /> : (
          <Table>
            <thead><tr><Th>{t("Number")}</Th><Th>{t("Issued")}</Th><Th>{t("ZATCA")}</Th><Th align="end">{t("VAT")}</Th><Th align="end">{t("Total")}</Th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <Td className="num whitespace-nowrap text-ink"><span dir="ltr">{i.number}</span></Td>
                  <Td className="whitespace-nowrap">{fmtDate(i.issuedAt, L)}</Td>
                  <Td><Badge tone={i.zatcaStatus === "cleared" || i.zatcaStatus === "reported" ? "ok" : i.zatcaStatus === "failed" ? "bad" : "neutral"} dot>{t(i.zatcaStatus[0]!.toUpperCase() + i.zatcaStatus.slice(1))}</Badge></Td>
                  <Td align="end"><Money v={i.vat} /></Td>
                  <Td align="end"><Money v={i.total} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

export async function CreditTab({ userId }: { userId: string }) {
  const t = await getT();
  const L = t.locale;
  const c = await customerCredit(userId);
  return (
    <Card pad={false}>
      <div className="flex items-baseline justify-between px-6 pt-6"><CardHead title={t("Credit ledger")} hint={t("Every movement on their Mada credit. Corrections are new lines; nothing is edited.")} /><Money v={c.balance.amount} className="text-[26px] font-[350] tracking-[-0.03em]" /></div>
      {c.entries.length === 0 ? <Empty icon={<Wallet className="size-5" />} title={t("No Mada credit yet")} /> : (
        <Table>
          <thead><tr><Th>{t("When")}</Th><Th>{t("Type")}</Th><Th>{t("Note")}</Th><Th align="end">{t("Amount")}</Th></tr></thead>
          <tbody>
            {c.entries.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap">{fmtDate(e.createdAt, L, true)}</Td>
                <Td><Badge tone={e.amount > 0 ? "ok" : "neutral"}>{t(CREDIT_KIND[e.kind] ?? e.kind)}</Badge></Td>
                <Td><span dir="auto" className="block max-w-[360px] truncate">{e.note ?? "—"}</span></Td>
                <Td align="end"><Money v={e.amount} sign className={e.amount > 0 ? "text-ok" : ""} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export async function EsimsTab({ userId }: { userId: string }) {
  const t = await getT();
  const L = t.locale;
  const rows = await customerEsims(userId);
  return (
    <Card pad={false}>
      <div className="px-6 pt-6"><CardHead title={t("eSIMs")} /></div>
      {rows.length === 0 ? <Empty icon={<Smartphone className="size-5" />} title={t("No eSIMs")} /> : (
        <Table>
          <thead><tr><Th>{t("Plan")}</Th><Th>{t("ICCID")}</Th><Th>{t("Status")}</Th><Th>{t("Bought")}</Th></tr></thead>
          <tbody>
            {rows.map((e) => {
              const p = e.plan as { coverage?: { name?: string }; gb?: number | null; days?: number };
              return (
                <tr key={e.id} className="group transition hover:bg-surface-2">
                  <Td><Link href={`/adminwork/desk/esims/${e.id}`} className={linkCls}>{p.coverage?.name ?? "eSIM"}</Link>
                    <span className="block text-[12px] text-ink-3">{p.gb == null ? t("Unlimited") : `${p.gb} GB`} · {t("{n} days", { n: p.days ?? 0 })}</span></Td>
                  <Td className="num whitespace-nowrap text-[12.5px]"><span dir="ltr">{e.iccid ?? "—"}</span></Td>
                  <Td><StatusBadge map={ESIM_STATUS} value={e.status} /></Td>
                  <Td className="whitespace-nowrap">{fmtDate(e.createdAt, L)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export async function RequestsTab({ userId }: { userId: string }) {
  const t = await getT();
  const L = t.locale;
  const rows = await customerRequests(userId);
  return (
    <Card pad={false}>
      <div className="px-6 pt-6"><CardHead title={t("Requests")} /></div>
      {rows.length === 0 ? <Empty icon={<Receipt className="size-5" />} title={t("No requests")} /> : (
        <Table>
          <thead><tr><Th>{t("Request")}</Th><Th>{t("Type")}</Th><Th>{t("Status")}</Th><Th>{t("Agent")}</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="group transition hover:bg-surface-2">
                <Td><Link href={`/adminwork/desk/requests/${r.id}`} className={cx("block max-w-[360px] truncate", linkCls)}>{r.summary}</Link><span className="block text-[12px] text-ink-3">{fmtDate(r.createdAt, L)}</span></Td>
                <Td className="whitespace-nowrap">{t(REQUEST_KIND[r.kind] ?? r.kind)}</Td>
                <Td><StatusBadge map={REQUEST_STATUS} value={r.status} /></Td>
                <Td className="whitespace-nowrap">{r.agentName ?? <span className="text-ink-4">—</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

const WHY: Record<string, string> = { lead: "You can read every Ask conversation as a support lead.", handoff: "Handed to the desk.", open_item: "Open because this customer has something open with us." };

export async function ChatsTab({ actor, userId, hasOpen, ask }: { actor: CurrentUser; userId: string; hasOpen: boolean; ask: string | null }) {
  const t = await getT();
  const L = t.locale;
  const chats = await customerChats(actor, userId, hasOpen);
  let thread: Awaited<ReturnType<typeof readAskThread>> | null = null, refused: string | null = null;
  if (ask) {
    try { thread = await readAskThread(actor, userId, ask); } catch (e) { refused = e instanceof DeskError ? e.message : "Not found"; }
  }
  const base = `/adminwork/desk/customers/${userId}?tab=chats`;
  return (
    <>
      {(thread || refused) && (
        <Card id="ask">
          <CardHead title={<span className="inline-flex items-center gap-2"><Bot className="size-4 text-gold" />{t("Ask Mada conversation")}</span>}
            hint={thread ? `${t(WHY[thread.why]!)} ${t("Read-only. This read is in the audit log.")}` : undefined}
            action={<span className="flex items-center gap-3">{thread && <Link href={`/adminwork/desk/ask/${thread.id}`} className="text-[12.5px] text-ink-3 underline decoration-gold decoration-2 underline-offset-4 hover:text-ink">{t("Open in Ask threads")}</Link>}<Link href={base} className="text-[12.5px] text-ink-3 hover:text-ink">{t("Close")}</Link></span>} />
          {refused ? <p className="rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn"><Lock className="me-1.5 inline size-3.5" />{t(refused)}</p> : thread && (
            <>
              {thread.summary && <p className="mb-4 rounded-2xl bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-ink-3"><span className="font-medium text-ink-2">{t("Earlier, in short:")}</span> <span dir="auto">{thread.summary}</span></p>}
              <ol className="space-y-3">
                {thread.lines.map((l, i) => (
                  <li key={i} className={cx("flex", l.who === "me" ? "justify-start" : "justify-end")}>
                    <div className={cx("max-w-[80%]", l.who === "mada" && "text-end")}>
                      <div className="mb-1 text-[11.5px] text-ink-3">{l.who === "me" ? t("Traveller") : "Mada"}</div>
                      <div dir="auto" className={cx("inline-block whitespace-pre-wrap break-words rounded-[18px] px-3.5 py-2 text-start text-[14px] leading-relaxed",
                        l.who === "me" ? "rounded-es-md bg-surface-2 text-ink ring-1 ring-line" : "rounded-ee-md bg-brand text-brand-ink")}>{l.text}</div>
                      {l.cards && l.cards.length > 0 && <div className="mt-1 flex flex-wrap justify-end gap-1">{l.cards.map((c, j) => <Badge key={j} tone="neutral">{c}</Badge>)}</div>}
                    </div>
                  </li>
                ))}
              </ol>
              {thread.lines.length === 0 && <p className="text-[13px] text-ink-3">{t("Nothing in this thread yet")}</p>}
            </>
          )}
        </Card>
      )}

      <Card pad={false}>
        <div className="px-6 pt-6"><CardHead title={t("Support chats")} /></div>
        {chats.support.length === 0 && chats.requests.length === 0 ? <Empty icon={<MessagesSquare className="size-5" />} title={t("No chats with the desk")} /> : (
          <Table>
            <thead><tr><Th>{t("Thread")}</Th><Th>{t("Messages")}</Th><Th>{t("Last message")}</Th></tr></thead>
            <tbody>
              {chats.support.map((s) => (
                <tr key={s.id} className="group transition hover:bg-surface-2">
                  <Td><Link href={`/adminwork/desk/chats?t=support:${s.id}`} className={linkCls}>{s.about === "general" ? t("Support") : s.about}</Link>
                    {s.lastBody && <span dir="auto" className="block max-w-[360px] truncate text-[12px] text-ink-3">{s.lastBody}</span>}</Td>
                  <Td className="num">{s.messages}</Td>
                  <Td className="whitespace-nowrap text-[12.5px] text-ink-3">{s.lastAt ? timeAgo(s.lastAt, L) : "—"}</Td>
                </tr>
              ))}
              {chats.requests.map((r) => (
                <tr key={r.id} className="group transition hover:bg-surface-2">
                  <Td><Link href={`/adminwork/desk/chats?t=request:${r.id}`} className={cx("block max-w-[360px] truncate", linkCls)}>{r.summary}</Link><span className="block text-[12px] text-ink-3">{t(REQUEST_KIND[r.kind] ?? r.kind)}</span></Td>
                  <Td className="num">{r.messages}</Td>
                  <Td className="whitespace-nowrap text-[12.5px] text-ink-3">{r.lastAt ? timeAgo(r.lastAt, L) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card pad={false}>
        <div className="px-6 pt-6"><CardHead title={t("Ask Mada conversations")} hint={t("What they said to Mada in the app. Agents open the ones handed to the desk, or all of them while the customer has something open; every read is logged.")} /></div>
        {chats.ask.length === 0 ? <Empty icon={<Bot className="size-5" />} title={t("No Ask conversations")} /> : (
          <Table>
            <thead><tr><Th>{t("Started")}</Th><Th>{t("Turns")}</Th><Th>{t("Handed to the desk")}</Th><Th>{t("Last turn")}</Th></tr></thead>
            <tbody>
              {chats.ask.map((a) => (
                <tr key={a.id} className={cx("group transition hover:bg-surface-2", ask === a.id && "bg-gold-soft/40")}>
                  <Td className="whitespace-nowrap">{a.access ? <Link href={`${base}&ask=${a.id}#ask`} prefetch={false} className={linkCls}>{fmtDate(a.createdAt, L, true)}</Link>
                    : <span className="inline-flex items-center gap-1.5 text-ink-3" title={t("Ask conversations open to the desk once they're handed over, or while the customer has something open with us")}><Lock className="size-3.5" />{fmtDate(a.createdAt, L, true)}</span>}</Td>
                  <Td className="num">{a.turns}</Td>
                  <Td>{a.handedOff ? <Badge tone="gold" dot>{t("Yes")}</Badge> : <span className="text-ink-4">{t("No")}</span>}</Td>
                  <Td className="whitespace-nowrap text-[12.5px] text-ink-3">{timeAgo(a.updatedAt, L)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

export async function MemoryTab({ userId }: { userId: string }) {
  const t = await getT();
  const L = t.locale;
  const rows = await customerMemory(userId);
  return (
    <Card pad={false}>
      <div className="px-6 pt-6"><CardHead title={t("What Mada remembers")} hint={t("Small facts the traveller told Ask Mada to keep. Read-only: the traveller sees and deletes them in Account → What Mada remembers.")} /></div>
      {rows.length === 0 ? <Empty icon={<Brain className="size-5" />} title={t("Nothing remembered")} /> : (
        <Table>
          <thead><tr><Th>{t("About")}</Th><Th>{t("What")}</Th><Th>{t("From")}</Th><Th>{t("Saved")}</Th><Th>{t("Last used")}</Th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <Td className="whitespace-nowrap"><Badge tone={m.kind === "health" || m.kind === "mobility" ? "warn" : "neutral"}>{t(MEMORY_KIND[m.kind] ?? m.kind)}</Badge></Td>
                <Td><span dir="auto" className="block max-w-[380px] text-ink">{m.text}</span></Td>
                <Td className="whitespace-nowrap">{m.source === "booking" ? t("A booking") : t("A conversation")}</Td>
                <Td className="whitespace-nowrap">{fmtDate(m.createdAt, L)}</Td>
                <Td className="whitespace-nowrap text-[12.5px] text-ink-3">{m.lastUsedAt ? timeAgo(m.lastUsedAt, L) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export async function AuditTab({ userId }: { userId: string }) {
  const t = await getT();
  const L = t.locale;
  const rows = await customerAudit(userId);
  const SOURCE: Record<string, { label: string; tone: "gold" | "neutral" | "info" }> = { desk: { label: "Desk", tone: "gold" }, traveller: { label: "Traveller", tone: "info" }, system: { label: "System", tone: "neutral" } };
  return (
    <Card>
      <CardHead title={<span className="inline-flex items-center gap-2"><History className="size-4 text-ink-3" />{t("History")}</span>} hint={t("What the traveller, the system and the desk did on this account, newest first.")} action={<span className="text-[12px] text-ink-3">{t("{n} entries", { n: rows.length })}</span>} />
      {rows.length === 0 ? <p className="text-[13px] text-ink-3">{t("Nothing yet")}</p> : (
        <ol className="relative space-y-4 before:absolute before:inset-y-2 before:start-[13px] before:w-px before:bg-line">
          {rows.map((e) => (
            <li key={e.id} className="relative flex gap-3">
              <span className="relative z-[1] mt-1 grid size-7 shrink-0 place-items-center"><span className={cx("size-2.5 rounded-full border-2 border-surface ring-4 ring-surface", e.source === "desk" ? "bg-gold" : e.source === "traveller" ? "bg-info" : "bg-ink-4")} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-ink-3">
                  <span className="font-medium text-ink">{e.source === "desk" ? e.who : t(e.who)}</span><Badge tone={SOURCE[e.source]!.tone}>{t(SOURCE[e.source]!.label)}</Badge>
                  <span title={fmtDate(e.at, L, true)}>{timeAgo(e.at, L)}</span>
                </div>
                <div className="mt-0.5 text-[13.5px] text-ink-2">{e.summary}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
