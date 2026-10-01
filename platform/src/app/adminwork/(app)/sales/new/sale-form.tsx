"use client";
import { useActionState, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { PendingContext, useSubmit } from "@/components/client";
import { ACCOUNT, ACCOUNTS } from "@/lib/labels";
import { AlertCircle, ArrowLeftRight, ArrowRight, Building2, Check, Landmark, Loader2, Plane, Hotel, Stamp, Package, Car, Sparkles, MoreHorizontal, Search, UserPlus, X, Ticket, Hourglass, ShieldCheck } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { cx, btn } from "@/components/ui";
import { createSale } from "../actions";
import { Picker, type PickerItem } from "@/components/picker";
import { ServiceDetails } from "./service-details";
import { Travellers } from "./travellers";
import { AIRLINES, AIRPORTS, airlineLabel } from "@/lib/travel-data";

const AIRPORT_ITEMS: PickerItem[] = AIRPORTS.map((a) => ({
  value: a.code, code: a.code, primary: a.city, secondary: `${a.name} · ${a.country}`,
  keywords: `${a.code} ${a.city} ${a.cityAr ?? ""} ${a.name} ${a.country}`,
}));
const AIRLINE_ITEMS: PickerItem[] = AIRLINES.map((a) => ({
  value: airlineLabel(a), code: a.code, primary: a.name, secondary: a.nameAr,
  keywords: `${a.code} ${a.name} ${a.nameAr ?? ""} ${a.country}`,
}));

type Client = { id: string; name: string; type: string; phone: string | null; creditLimit: number; exposure: number; terms: number };
type Props = {
  clients: Client[]; targetBps: number; canIssueAll: boolean; creditDualLimit: number; showRules: boolean;
  delegation: { scope: string; maxTicket: number; dailyLeft: number } | null; defaultClientId?: string;
  partners: { id: string; name: string }[]; myPartnerId: string | null;
};

const SERVICES = [
  { k: "flight", icon: Plane, label: "Flight" }, { k: "hotel", icon: Hotel, label: "Hotel" }, { k: "visa", icon: Stamp, label: "Visa" },
  { k: "package", icon: Package, label: "Package" }, { k: "transport", icon: Car, label: "Transport" }, { k: "event", icon: Sparkles, label: "Event" }, { k: "other", icon: MoreHorizontal, label: "Other" },
];
const METHODS = [{ k: "mada", label: "mada" }, { k: "card", label: "Card" }, { k: "cash", label: "Cash" }, { k: "transfer", label: "Transfer" }];

const toH = (v: string) => { const n = Number(String(v).replace(/,/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const show = (h: number) => (h / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-card bg-surface p-6 shadow-card">
      <div className="mb-5 flex items-center gap-3">
        <span className={cx("grid size-7 place-items-center rounded-full text-[12.5px] transition", done ? "bg-ok text-white" : "bg-sunken text-ink-2")}>{done ? <Check className="size-3.5" strokeWidth={3} /> : n}</span>
        <h2 className="text-[17px] font-[450] tracking-[-0.02em]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Submit({ label }: { label: string }) {
  const pending = useContext(PendingContext);
  return (
    <button type="submit" disabled={pending} className={btn("gold", "lg", "w-full")}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}{label}<ArrowRight className="size-4 rtl:rotate-180" />
    </button>
  );
}

export function SaleForm({ clients, targetBps, canIssueAll, creditDualLimit, showRules, delegation, defaultClientId, partners, myPartnerId }: Props) {
  const t = useT();
  const [state, action, pending] = useActionState(createSale, null);
  const onSubmit = useSubmit(action);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState<Client | null>(() => clients.find((c) => c.id === defaultClientId) ?? null);
  const [newClient, setNewClient] = useState<{ name: string; phone: string; type: "retail" | "noncontracted" } | null>(null);
  const [service, setService] = useState("flight");
  const [net, setNet] = useState("");
  const [sell, setSell] = useState("");
  const [paid, setPaid] = useState<string | null>(null);
  const [method, setMethod] = useState("mada");
  const [issueNow, setIssueNow] = useState(true);
  const [account, setAccount] = useState<"retail" | "corporate">("retail");
  const [supplierPay, setSupplierPay] = useState("unpaid");
  const [supplierAccount, setSupplierAccount] = useState<"retail" | "corporate">("retail");
  const [viaBsp, setViaBsp] = useState(true);
  const [names, setNames] = useState<string[]>([]);
  const [count, setCount] = useState(1);
  const [tickets, setTickets] = useState<string[]>([]); // kept in state so a failed save doesn't wipe them
  const onNames = useCallback((n: string[], c: number) => { setNames((old) => (old.join("|") === n.join("|") ? old : n)); setCount(c); }, []);
  const pax = names.join(", ");
  const [pnr, setPnr] = useState("");
  const [from, setFrom] = useState("RUH");
  const [to, setTo] = useState("");
  const [trip, setTrip] = useState<"oneway" | "return">("return");
  const [airline, setAirline] = useState("");
  const route = from && to ? `${from} ${trip === "return" ? "⇄" : "→"} ${to}` : "";
  const searchRef = useRef<HTMLInputElement>(null);

  const ctype = client?.type ?? (newClient ? newClient.type : null);
  const isRetail = ctype === "retail";
  const netH = toH(net), sellH = toH(sell);
  const paidH = paid === null ? (isRetail || ctype === null ? sellH : 0) : toH(paid);
  const unpaid = Math.max(0, sellH - paidH);
  const margin = sellH - netH;
  const marginBps = sellH ? Math.round((margin / sellH) * 10000) : 0;
  const marginTone = !sellH ? "idle" : margin < 0 ? "bad" : marginBps < targetBps ? "warn" : "ok";

  // Predict what will happen on save, using the same rules as the server.
  const channel = isRetail ? "retail" : "corporate";
  const creditNeeded = unpaid > 0 && (ctype !== "contracted" || (client ? client.exposure + unpaid > client.creditLimit : true));
  const canIssue = canIssueAll || service !== "flight" || (!!delegation && (delegation.scope === "all" || channel === "retail") && sellH <= delegation.maxTicket && sellH <= delegation.dailyLeft);
  const outcome = !ctype || !sellH ? null
    : creditNeeded && !showRules ? { icon: ShieldCheck, tone: "warn", title: t("Needs approval before issuing"), body: t("Management reviews pay-later sales. You'll see the decision on the sale.") }
    : creditNeeded ? { icon: ShieldCheck, tone: "warn", title: t("Goes to directors for credit approval"), body: unpaid <= creditDualLimit ? t("Any 2 directors must approve the unpaid SAR {v}.", { v: show(unpaid) }) : t("Above SAR {limit}: all directors must agree.", { limit: show(creditDualLimit) }) }
    : issueNow && canIssue ? { icon: Ticket, tone: "ok", title: service === "flight" ? t("You'll issue it now") : t("Confirmed on save"), body: t("It appears in tonight's report straight away.") }
    : { icon: Hourglass, tone: "gold", title: t("Sent to the issuance queue"), body: canIssue ? t("You chose to issue later.") : t("Flights need Bader or a delegated issuer. They'll be notified.") };

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? clients.filter((c) => c.name.toLowerCase().includes(s) || c.phone?.replace(/\s/g, "").includes(s.replace(/\s/g, ""))) : clients).slice(0, 7);
  }, [q, clients]);

  useEffect(() => { if (!client && !newClient) searchRef.current?.focus(); }, [client, newClient]);

  return (
    <PendingContext.Provider value={pending}>
    <form onSubmit={onSubmit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        {state?.error && (
          <div role="alert" className="flex items-start gap-2 rounded-2xl bg-bad-soft px-4 py-3 text-[13.5px] text-bad animate-rise"><AlertCircle className="mt-0.5 size-4 shrink-0" />{t(state.error)}</div>
        )}

        <Step n={1} title={t("Who is it for?")} done={!!ctype}>
          {client ? (
            <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3 ring-1 ring-line">
              <span className="grid size-10 place-items-center rounded-full bg-ink text-bg">{client.type === "retail" ? client.name[0] : <Building2 className="size-4" />}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px]">{client.name}</div>
                <div className="text-[12.5px] text-ink-3">
                  {t(client.type === "retail" ? "Retail" : client.type === "contracted" ? "Contracted corporate" : "Non-contracted corporate")}
                  {client.type === "contracted" && <> · {t("Credit left")} <span className="num" dir="ltr">{show(Math.max(0, client.creditLimit - client.exposure))}</span></>}
                </div>
              </div>
              <button type="button" onClick={() => { setClient(null); setQ(""); }} className="grid size-8 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink" aria-label={t("Change client")}><X className="size-4" /></button>
              <input type="hidden" name="clientId" value={client.id} />
            </div>
          ) : newClient ? (
            <div className="space-y-3 rounded-2xl bg-surface-2 p-4 ring-1 ring-line">
              <div className="flex items-center justify-between text-[13px] text-ink-3"><span className="flex items-center gap-2"><UserPlus className="size-4" />{t("New client")}</span>
                <button type="button" onClick={() => setNewClient(null)} className="text-ink-3 hover:text-ink">{t("Cancel")}</button></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input name="newClientName" value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} className="field" placeholder={t("Full name or company")} required />
                <input name="newClientPhone" value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })} className="field" placeholder={t("Phone")} dir="ltr" />
              </div>
              <div className="flex gap-2">
                {(["retail", "noncontracted"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setNewClient({ ...newClient, type: k })}
                    className={cx("h-9 rounded-full px-4 text-[13px] transition", newClient.type === k ? "bg-ink text-bg" : "bg-surface text-ink-2 ring-1 ring-line hover:ring-line-strong")}>
                    {t(k === "retail" ? "Individual" : "Company (no contract)")}
                  </button>
                ))}
              </div>
              <input type="hidden" name="newClientType" value={newClient.type} />
            </div>
          ) : (
            <div className="relative">
              <Search className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <input ref={searchRef} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
                className="field h-12 ps-11 text-[15px]" placeholder={t("Search by name or phone…")} autoComplete="off" />
              {open && (
                <ul className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-2xl bg-surface p-1.5 shadow-float ring-1 ring-line animate-rise">
                  {matches.map((c) => (
                    <li key={c.id}>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setClient(c); setOpen(false); setPaid(null); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start hover:bg-surface-2">
                        <span className="grid size-8 place-items-center rounded-full bg-sunken text-[12px] text-ink-2">{c.type === "retail" ? c.name[0] : <Building2 className="size-3.5" />}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-[14px]">{c.name}</span><span className="block text-[12px] text-ink-3" dir="ltr">{c.phone ?? ""}</span></span>
                        <span className="text-[11.5px] text-ink-3">{t(c.type === "retail" ? "Retail" : c.type === "contracted" ? "Contract" : "No contract")}</span>
                      </button>
                    </li>
                  ))}
                  <li>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setNewClient({ name: q, phone: "", type: "retail" }); setOpen(false); setPaid(null); }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-ink hover:bg-gold-soft">
                      <span className="grid size-8 place-items-center rounded-full bg-gold text-[#1a140a]"><UserPlus className="size-3.5" /></span>
                      {q ? t("Add “{q}” as a new client", { q }) : t("Add a new client")}
                    </button>
                  </li>
                </ul>
              )}
            </div>
          )}
        </Step>

        <Step n={2} title={t("What are they buying?")} done={!!pax && (service !== "flight" || !!pnr)}>
          <div className="mb-5 flex flex-wrap gap-2">
            {SERVICES.map(({ k, icon: Icon, label }) => (
              <button key={k} type="button" onClick={() => setService(k)}
                className={cx("flex h-10 items-center gap-2 rounded-full px-4 text-[13.5px] transition", service === k ? "bg-ink text-bg" : "bg-surface-2 text-ink-2 ring-1 ring-line hover:ring-line-strong")}>
                <Icon className="size-4" />{t(label)}
              </button>
            ))}
            <input type="hidden" name="serviceType" value={service} />
          </div>
          <div className="grid gap-4 sm:grid-cols-6">
            <Travellers service={service} invalid={!!state?.fields?.travellers} onNames={onNames} />
            {service === "flight" ? (
              <>
                <div className="sm:col-span-6">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[12.5px] text-ink-3">{t("Route")} <span className="text-gold-2">*</span></span>
                    <div className="flex rounded-full bg-sunken p-0.5 text-[12px]">
                      {(["return", "oneway"] as const).map((k) => (
                        <button key={k} type="button" onClick={() => setTrip(k)} className={cx("h-7 rounded-full px-3 transition", trip === k ? "bg-ink text-bg" : "text-ink-3 hover:text-ink")}>{k === "return" ? t("Return") : t("One way")}</button>
                      ))}
                    </div>
                  </div>
                  <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
                    <Picker items={AIRPORT_ITEMS} value={from} onChange={setFrom} label={t("From")} placeholder={t("From: city or code, e.g. Riyadh")} invalid={!!state?.fields?.description && !from} />
                    <button type="button" onClick={() => { setFrom(to); setTo(from); }} className="mx-auto grid size-9 place-items-center rounded-full text-ink-3 ring-1 ring-line transition hover:bg-surface-2 hover:text-ink" aria-label={t("Swap")} title={t("Swap")}><ArrowLeftRight className="size-4" /></button>
                    <Picker items={AIRPORT_ITEMS} value={to} onChange={setTo} label={t("To")} placeholder={t("To: city or code, e.g. Dubai")} invalid={!!state?.fields?.description && !to} />
                  </div>
                  {from && to && from === to && <p className="mt-1.5 text-[12.5px] text-bad">{t("From and To can't be the same airport")}</p>}
                  <input type="hidden" name="description" value={route} />
                </div>
                <div className="sm:col-span-3"><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Airline")} <span className="text-gold-2">*</span></span>
                  <Picker items={AIRLINE_ITEMS} value={airline} onChange={setAirline} label={t("Airline")} placeholder={t("Airline name or code, e.g. flynas")} invalid={!!state?.fields?.supplier && !airline} />
                  <input type="hidden" name="supplier" value={airline} />
                </div>
              </>
            ) : (
              <ServiceDetails key={service} service={service} invalid={!!state?.fields?.details} />
            )}
            {service === "flight" && (
              <label className="sm:col-span-3"><span className="mb-1.5 block text-[12.5px] text-ink-3">PNR <span className="text-gold-2">*</span></span>
                <input name="pnr" value={pnr} onChange={(e) => setPnr(e.target.value.toUpperCase())} maxLength={8} className="field num uppercase tracking-[0.2em]" placeholder="ABC123" dir="ltr" aria-invalid={!!state?.fields?.pnr} /></label>
            )}
{service !== "hotel" && (
            <label className="sm:col-span-3"><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Travel date")}</span>
              <input name="travelDate" type="date" className="field" /></label>
            )}
          </div>
        </Step>

        <Step n={3} title={t("Price")} done={sellH > 0 && netH > 0}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Net cost (what we pay)")} <span className="text-gold-2">*</span></span>
              <div className="relative" dir="ltr"><input name="netCost" inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} className="field field-lg pe-14" placeholder="0.00" dir="ltr" aria-invalid={!!state?.fields?.netCost} />
                <span className="absolute end-4 top-1/2 -translate-y-1/2 text-[12px] text-ink-3">SAR</span></div></label>
            <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Selling price (what they pay)")} <span className="text-gold-2">*</span></span>
              <div className="relative" dir="ltr"><input name="sellPrice" inputMode="decimal" value={sell} onChange={(e) => setSell(e.target.value)} className="field field-lg pe-14" placeholder="0.00" dir="ltr" aria-invalid={!!state?.fields?.sellPrice} />
                <span className="absolute end-4 top-1/2 -translate-y-1/2 text-[12px] text-ink-3">SAR</span></div></label>
          </div>
          {count > 1 && sellH > 0 && (
            <p className="mt-3 text-[13px] text-ink-3">{t("{n} × SAR {v} each", { n: count, v: show(Math.round(sellH / count)) })}{netH > 0 ? ` · ${t("cost SAR {v} each", { v: show(Math.round(netH / count)) })}` : ""}</p>
          )}

          {netH > 0 && (
            <div className="mt-4 rounded-2xl bg-surface-2 p-4 ring-1 ring-line">
              {service === "flight" && (
                <div className="mb-3">
                  <span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Settled through")}</span>
                  <div className="grid grid-cols-2 gap-1 rounded-full bg-sunken p-1 sm:max-w-sm">
                    <button type="button" onClick={() => setViaBsp(true)} className={cx("h-9 rounded-full text-[13px] transition", viaBsp ? "bg-ink text-bg" : "text-ink-3 hover:text-ink")}>{t("IATA (BSP)")}</button>
                    <button type="button" onClick={() => setViaBsp(false)} className={cx("h-9 rounded-full text-[13px] transition", !viaBsp ? "bg-ink text-bg" : "text-ink-3 hover:text-ink")}>{t("Directly with airline")}</button>
                  </div>
                </div>
              )}
              <input type="hidden" name="viaBsp" value={service === "flight" && viaBsp ? "1" : ""} />
              {service === "flight" && viaBsp ? (
                <p className="flex items-start gap-2 text-[12.5px] text-ink-3"><Landmark className="mt-0.5 size-3.5 shrink-0" />{t("Billed by IATA — this cost rolls into the 15-day BSP closing.")}</p>
              ) : (<>
              <span className="mb-2 block text-[12.5px] text-ink-3">{t("Supplier cost — have we paid it?")}</span>
              <div className="flex flex-wrap gap-1.5">
                {([["unpaid", t("Not paid yet")], ["bank", t("Paid from a bank")], ...(myPartnerId ? [["partner", t("A partner paid it")]] : [])] as [string, string][]).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setSupplierPay(k)} className={cx("h-9 rounded-full px-4 text-[13px] transition", supplierPay === k ? "bg-ink text-bg" : "bg-surface text-ink-2 ring-1 ring-line hover:ring-line-strong")}>{label}</button>
                ))}
              </div>
              <input type="hidden" name="supplierPay" value={supplierPay} />
              {supplierPay === "bank" && (
                <div className="mt-3">
                  <span className="mb-1.5 block text-[12px] text-ink-3">{t("From which bank?")}</span>
                  <div className="grid grid-cols-2 gap-1 rounded-full bg-sunken p-1 sm:max-w-xs">
                    {ACCOUNTS.map((a) => <button key={a.value} type="button" onClick={() => setSupplierAccount(a.value)} className={cx("h-9 rounded-full text-[13px] transition", supplierAccount === a.value ? "bg-ink text-bg" : "text-ink-3 hover:text-ink")}>{t(a.label)}</button>)}
                  </div>
                  <input type="hidden" name="supplierAccount" value={supplierAccount} />
                </div>
              )}
              {supplierPay === "partner" && (
                <div className="mt-3">
                  <span className="mb-1.5 block text-[12px] text-ink-3">{t("Which partner paid?")}</span>
                  <select name="supplierPartnerId" defaultValue={myPartnerId ?? ""} className="field h-10 sm:max-w-xs">
                    {partners.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === myPartnerId ? ` (${t("me")})` : ""}</option>)}
                  </select>
                  <p className="mt-1.5 text-[12px] text-ink-3">{t("Goes to that partner's ledger once the other directors approve.")}</p>
                </div>
              )}
              {supplierPay === "unpaid" && <p className="mt-2 text-[12px] text-ink-3">{t("It will show in “Money we owe” until you mark it paid.")}</p>}
              </>)}
            </div>
          )}
          {sellH > 0 && netH > 0 && marginTone !== "ok" && (
            <p className={cx("mt-3 text-[13px]", marginTone === "bad" ? "text-bad" : "text-warn")}>
              {marginTone === "bad" ? t("This sale loses money. Double-check the prices.") : t("Margin is below the {p}% target.", { p: (targetBps / 100).toFixed(0) })}
            </p>
          )}
        </Step>

        <Step n={4} title={t("Payment & issuing")} done={!!ctype && sellH > 0}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Received now")}</span>
              <div className="relative" dir="ltr"><input name="paidNow" inputMode="decimal" value={paid ?? (paidH ? show(paidH).replace(/,/g, "") : "0")} onChange={(e) => setPaid(e.target.value)} className="field h-12 pe-14 text-[17px] num" dir="ltr" />
                <span className="absolute end-4 top-1/2 -translate-y-1/2 text-[12px] text-ink-3">SAR</span></div>
              <span className="mt-1.5 flex gap-2 text-[12px]">
                <button type="button" onClick={() => setPaid(show(sellH).replace(/,/g, ""))} className="text-ink-3 underline-offset-2 hover:text-ink hover:underline">{t("Full amount")}</button>
                <button type="button" onClick={() => setPaid("0")} className="text-ink-3 underline-offset-2 hover:text-ink hover:underline">{t("Pay later")}</button>
              </span></label>
            <div><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Method")}</span>
              <div className="grid grid-cols-4 gap-1 rounded-full bg-sunken p-1">
                {METHODS.map((m) => (
                  <button key={m.k} type="button" onClick={() => setMethod(m.k)} className={cx("h-10 rounded-full text-[13px] transition", method === m.k ? "bg-ink text-bg" : "text-ink-3 hover:text-ink")}>{t(m.label)}</button>
                ))}
              </div>
              <input type="hidden" name="method" value={method} />
              <input name="paymentRef" className="field mt-2 h-10" placeholder={t("Receipt / transfer ref (optional)")} dir="ltr" />
            </div>
          </div>

          <div className="mt-4">
            <span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Into which bank account?")}</span>
            <div className="grid grid-cols-2 gap-1 rounded-full bg-sunken p-1 sm:max-w-xs">
              {ACCOUNTS.map((a) => (
                <button key={a.value} type="button" onClick={() => setAccount(a.value)} className={cx("h-10 rounded-full text-[13.5px] transition", account === a.value ? "bg-ink text-bg" : "text-ink-3 hover:text-ink")}>{t(a.label)}</button>
              ))}
            </div>
            <input type="hidden" name="account" value={account} />
          </div>

          {creditNeeded && ctype !== "contracted" && (
            <label className="mt-4 block animate-rise"><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Why should they pay later?")} <span className="text-gold-2">*</span></span>
              <textarea name="creditReason" rows={2} className="field" placeholder={showRules ? t("Directors will read this before approving") : t("Management will read this before approving")} /></label>
          )}

          <div className="mt-5 flex items-start gap-3 rounded-2xl bg-surface-2 p-4 ring-1 ring-line">
            <input id="issueNow" type="checkbox" name="issueNow" checked={issueNow} onChange={(e) => setIssueNow(e.target.checked)} disabled={!canIssue || creditNeeded} className="mt-1 size-4 accent-[var(--gold)]" />
            <label htmlFor="issueNow" className="flex-1">
              <span className="block text-[14px]">{service === "flight" ? t("Issue the ticket now") : t("Confirm now")}</span>
              <span className="block text-[12.5px] text-ink-3">
                {canIssueAll ? t("You have full issuing authority.")
                  : delegation ? t("Your limit: SAR {max} per ticket, {left} left today{scope}.", { max: show(delegation.maxTicket), left: show(delegation.dailyLeft), scope: delegation.scope === "retail" ? t(", retail only") : "" })
                  : service === "flight" ? t("You can't issue flights. It will go to the issuance queue.") : t("Non-flight services are confirmed by the preparer.")}
              </span>
              {issueNow && canIssue && !creditNeeded && service === "flight" && (
                <span className="mt-3 grid gap-2 sm:grid-cols-2">
                  {(names.length ? names : [""]).map((n, i) => (
                    <input key={i} name="ticket" value={tickets[i] ?? ""} onChange={(e) => setTickets((x) => { const y = [...x]; y[i] = e.target.value; return y; })} className="field num" dir="ltr" aria-label={t("Ticket number for {name}", { name: n || String(i + 1) })}
                      placeholder={names.length > 1 ? `${n} · 065-1234567890` : t("Ticket number, e.g. 065-1234567890")} />
                  ))}
                </span>
              )}
            </label>
          </div>
          <label className="mt-4 block"><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Remark (optional)")}</span>
            <input name="note" className="field" placeholder={t("Anything the team should know")} /></label>
        </Step>
      </div>

      {/* The live receipt: always shows exactly what will happen */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="night relative overflow-hidden rounded-card p-6">
          <div className="night-grid pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative">
            <div className="flex items-center justify-between text-[12.5px] text-tile-ink-3"><span>{t("Summary")}</span>{ctype && <span>{ACCOUNT[account]}</span>}</div>
            <div className="mt-4 min-h-[44px]">
              <div className="truncate text-[18px] font-[420]">{client?.name ?? newClient?.name ?? <span className="text-tile-ink-3">{t("No client yet")}</span>}</div>
              <div className="truncate text-[13px] text-tile-ink-3">{count > 1 && <span className="num">{count} × </span>}{pax || "—"} {pnr && <span dir="ltr">· {pnr}</span>}</div>
            </div>

            <div className="mt-6 text-[12px] text-tile-ink-3">{t("Margin")}</div>
            <div className={cx("figure mt-1 text-[56px]", marginTone === "bad" ? "text-glow-ember" : marginTone === "warn" ? "text-glow-gold" : "")} dir="ltr">
              {show(margin).split(".")[0]}<span className="text-[0.45em] opacity-60">.{show(margin).split(".")[1]}</span>
            </div>
            <div className="mt-3">
              <div className="relative h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className={cx("h-full rounded-full transition-all duration-500", marginTone === "bad" ? "bg-glow-ember" : marginTone === "warn" ? "bg-glow-gold" : "bg-glow-green")} style={{ width: `${Math.min(100, Math.max(0, marginBps / (targetBps * 2)) * 100)}%` }} />
                <div className="absolute inset-y-0 w-px bg-tile-ink/60" style={{ insetInlineStart: "50%" }} />
              </div>
              <div className="mt-1.5 flex justify-between text-[11.5px] text-tile-ink-3 num"><span dir="ltr">{(marginBps / 100).toFixed(1)}%</span><span>{t("target")} {(targetBps / 100).toFixed(0)}%</span></div>
            </div>

            <dl className="mt-6 space-y-2.5 border-t border-tile-line pt-5 text-[13.5px]">
              {[[t("Selling price"), sellH], [t("Net cost"), netH], [t("Received now"), Math.min(paidH, sellH)], [t("Still owed"), unpaid]].map(([k, v]) => (
                <div key={k as string} className="flex justify-between"><dt className="text-tile-ink-3">{k}</dt><dd className="num" dir="ltr">{show(v as number)}</dd></div>
              ))}
            </dl>

            {outcome ? (
              <div className={cx("mt-6 flex gap-3 rounded-2xl p-3.5", outcome.tone === "warn" ? "bg-glow-gold/15" : outcome.tone === "ok" ? "bg-glow-green/15" : "bg-white/[0.06]")}>
                <outcome.icon className={cx("mt-0.5 size-4 shrink-0", outcome.tone === "warn" ? "text-glow-gold" : outcome.tone === "ok" ? "text-glow-mint" : "text-tile-ink")} />
                <div><div className="text-[13.5px]">{outcome.title}</div><div className="mt-0.5 text-[12.5px] text-tile-ink-3">{outcome.body}</div></div>
              </div>
            ) : (
              <div className="mt-6 rounded-2xl bg-white/[0.06] p-3.5 text-[12.5px] text-tile-ink-3">{t("Pick a client and enter prices to see what happens next.")}</div>
            )}
          </div>
        </div>
        <div className="mt-4"><Submit label={creditNeeded ? t("Save & request credit") : issueNow && canIssue ? (service === "flight" ? t("Save & issue") : t("Save & confirm")) : t("Save sale")} /></div>
        <p className="mt-3 text-center text-[12px] text-ink-3">{t("Saved sales appear in tonight's 10 PM report automatically.")}</p>
      </aside>
    </form>
    </PendingContext.Provider>
  );
}
