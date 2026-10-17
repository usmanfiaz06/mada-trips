import Link from "next/link";
import { ArrowLeft, Tags } from "lucide-react";
import { formatSar, type EsimPackage } from "@mada/shared";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { catalogueRows, catalogueStatus } from "@/lib/app/esim/catalogue";
import { esimPricing } from "@/lib/app/esim/pricing";
import { ActionForm, SubmitButton } from "@/components/client";
import { Badge, Card, CardHead, Empty, Field, Input, Notice, PageHeader, Table, Td, Th, cx } from "@/components/ui";
import { esimPlaceRuleAction, esimPlanRuleAction, esimRulesAction, esimSyncAction } from "../../esim-actions";

export const metadata = { title: "eSIM pricing · Desk" };

/*
 * The owner's eSIM pricing (admin only: settings.manage). Global rules (margin, minimum profit after the card fee,
 * rounding, match suggested retail, the hold window, the balance alert), then per place and per plan: cost in USD and
 * SAR, the sell price the rules give, what Mada keeps, against the supplier's suggested retail. Hide a plan, or pick up
 * to three per place for the app to show first. Every save is in the audit trail; prices follow at once.
 */

const RULE: Record<string, { label: string; tone: "neutral" | "info" | "warn" | "ok" | "gold" }> = {
  margin: { label: "Margin", tone: "neutral" }, min_profit: { label: "Min profit", tone: "info" }, retail: { label: "Retail", tone: "ok" }, fixed: { label: "Fixed", tone: "gold" }, floor: { label: "Guard", tone: "warn" },
};
const sar = (h: number) => formatSar(h, { decimals: "always", locale: "en" });
const usd = (v: number) => `$${v.toFixed(2)}`;

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ place?: string }> }) {
  await requirePerm("settings.manage");
  const t = await getT();
  const sp = await searchParams;
  const place = sp.place && /^[A-Za-z0-9-]{2,24}$/.test(sp.place) ? sp.place : null;
  const [pricing, cat, all] = await Promise.all([esimPricing(), catalogueStatus(), catalogueRows()]);
  const { rules } = pricing;
  const places = new Map<string, { name: string; n: number; up: number }>();
  for (const r of all) {
    const p = places.get(r.coverageCode) ?? { name: r.pkgv.coverage.name, n: 0, up: 0 };
    p.n += 1;
    if (cat.up.includes(r.packageId)) p.up += 1;
    places.set(r.coverageCode, p);
  }
  const rows = place ? all.filter((r) => r.coverageCode === place) : [];
  const picks = place ? rules.recommended[place] ?? [] : [];
  const ov = place ? rules.where[place] : undefined;
  const label = (p: EsimPackage) => `${p.gb === null ? t("Unlimited") : `${p.gb} GB`}${p.daily ? ` ${t("a day")}` : ""} · ${p.daily ? t("daily") : t("{n} days", { n: p.days })}`;

  return (
    <>
      <Link href="/adminwork/desk/esims" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("eSIMs")}</Link>
      <PageHeader eyebrow={t("App desk")} title={t("eSIM pricing")} subtitle={t("Supplier cost in USD, at today's dollar rate ({rate} SAR), becomes the sell price by these rules. Never below cost plus the card fee.", { rate: pricing.usdSar })}
        actions={<ActionForm action={esimSyncAction}><SubmitButton variant="outline" size="sm">{t("Sync now")}</SubmitButton></ActionForm>} />
      <div className="mb-3 flex flex-wrap gap-2 text-[12.5px] text-ink-3">
        {cat.at ? <span>{t("Catalogue synced {when}", { when: fmtDate(cat.at, t.locale, true) })}</span> : null}
        {cat.up.length ? <Badge tone="warn">{t("Cost went up on {n} plans", { n: cat.up.length })}</Badge> : null}
        {cat.down.length ? <Badge tone="ok">{t("Cost went down on {n} plans", { n: cat.down.length })}</Badge> : null}
        {rules.updatedAt ? <span>{t("Rules changed {when} by {name}", { when: fmtDate(rules.updatedAt, t.locale, true), name: rules.updatedBy ?? "—" })}</span> : null}
      </div>

      <Card className="mb-4">
        <CardHead title={t("The rules")} hint={t("For every plan, unless a place or a plan says otherwise.")} />
        <ActionForm action={esimRulesAction} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Field label={t("Margin %")}><Input name="marginPct" inputMode="decimal" defaultValue={rules.marginPct} /></Field>
          <Field label={t("Minimum profit, SAR")} hint={t("After the card fee")}><Input name="minProfitSar" inputMode="decimal" defaultValue={rules.minProfitSar} /></Field>
          <Field label={t("Card fee %")} hint={t("MyFatoorah")}><Input name="paymentFeePct" inputMode="decimal" defaultValue={rules.paymentFeePct} /></Field>
          <Field label={t("Card fee, SAR each")}><Input name="paymentFeeFixedSar" inputMode="decimal" defaultValue={rules.paymentFeeFixedSar} /></Field>
          <Field label={t("Rounding")}>
            <select name="rounding" className="field h-10" defaultValue={rules.rounding}>
              <option value="x9">{t("Up to the next 9 (19, 29, 49)")}</option>
              <option value="whole">{t("Up to a whole riyal")}</option>
              <option value="none">{t("No rounding")}</option>
            </select>
          </Field>
          <Field label={t("Hold a price shown, minutes")}><Input name="holdMinutes" inputMode="numeric" defaultValue={rules.holdMinutes} /></Field>
          <Field label={t("Balance alert below, USD")}><Input name="lowBalanceUsd" inputMode="decimal" defaultValue={rules.lowBalanceUsd} /></Field>
          <Field label={t("Promise when the balance runs out, minutes")}><Input name="sortingMinutes" inputMode="numeric" defaultValue={rules.sortingMinutes} /></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-ink-2"><input type="checkbox" name="matchRetail" defaultChecked={rules.matchRetail} />{t("Match suggested retail")}</label>
          <div className="self-end pb-1"><SubmitButton size="sm">{t("Save rules")}</SubmitButton></div>
        </ActionForm>
      </Card>

      {!all.length ? <Notice tone="info" title={t("No catalogue yet")}>{t("Sync now reads every plan from the supplier. The daily job keeps it fresh.")}</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card pad={false} className="max-h-[70dvh] overflow-y-auto">
          <ul className="divide-y divide-line text-[13px]">
            {[...places.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([code, p]) => (
              <li key={code}>
                <Link href={`/adminwork/desk/esims/pricing?place=${encodeURIComponent(code)}`} className={cx("flex items-center justify-between gap-2 px-3 py-2", place === code ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2/60")}>
                  <span className="truncate">{p.name} <span className="num text-ink-4">{code}</span></span>
                  <span className="flex shrink-0 items-center gap-1">{rules.where[code] ? <Badge tone="gold">{t("own rule")}</Badge> : null}{p.up ? <Badge tone="warn">↑{p.up}</Badge> : null}<span className="num text-ink-4">{p.n}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        {place ? (
          <div className="space-y-4">
            <Card>
              <CardHead title={t("{place}: its own rule", { place: places.get(place)?.name ?? place })} hint={t("Leave blank to use the global rule.")} />
              <ActionForm action={esimPlaceRuleAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="code" value={place} />
                <Field label={t("Margin %")}><Input name="marginPct" inputMode="decimal" defaultValue={ov?.marginPct ?? ""} placeholder={String(rules.marginPct)} /></Field>
                <Field label={t("Minimum profit, SAR")}><Input name="minProfitSar" inputMode="decimal" defaultValue={ov?.minProfitSar ?? ""} placeholder={String(rules.minProfitSar)} /></Field>
                <SubmitButton size="sm">{t("Save for this place")}</SubmitButton>
              </ActionForm>
              <p className="mt-2 text-[12px] text-ink-3">{t("Picks: up to three per place, shown first in the app, best value first. The rest are under See all plans.")}</p>
            </Card>
            <Card pad={false}>
              <Table>
                <thead><tr><Th>{t("Plan")}</Th><Th align="end">{t("Cost")}</Th><Th align="end">{t("Sell")}</Th><Th align="end">{t("Mada keeps")}</Th><Th align="end">{t("vs retail")}</Th><Th>{t("This plan")}</Th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const b = pricing.breakdown(r.pkgv);
                    const hidden = rules.hidden.includes(r.packageId);
                    const picked = picks.includes(r.packageId);
                    const own = rules.plans[r.packageId];
                    const up = cat.up.includes(r.packageId);
                    return (
                      <tr key={r.packageId} className={cx("align-top", hidden && "opacity-55")}>
                        <Td>
                          <span className="block text-ink">{label(r.pkgv)}</span>
                          <span className="num block text-[11.5px] text-ink-4">{r.packageId}</span>
                          <span className="mt-1 flex flex-wrap gap-1">{picked ? <Badge tone="ok">{t("Recommended")}</Badge> : null}{hidden ? <Badge tone="neutral">{t("Hidden")}</Badge> : null}<Badge tone={RULE[b.rule]!.tone}>{t(RULE[b.rule]!.label)}</Badge></span>
                        </Td>
                        <Td align="end"><span className="num block" dir="ltr">{usd(b.costUsd)}</span><span className="num block text-[12px] text-ink-3">{sar(b.cost)}</span>{up && r.prevCostE4 ? <span className="num block text-[11.5px] text-warn" dir="ltr">↑ {t("was {was}", { was: usd(r.prevCostE4 / 10_000) })}</span> : null}</Td>
                        <Td align="end"><span className="num text-ink">{sar(b.sell)}</span></Td>
                        <Td align="end"><span className={cx("num block", b.margin < 0 ? "text-bad" : "text-ink")}>{sar(b.margin)}</span><span className="num block text-[12px] text-ink-3">{b.marginPct}%</span></Td>
                        <Td align="end">{b.retail ? <><span className="num block text-[12px]">{sar(b.retail)}</span><span className={cx("num block text-[12px]", b.sell > b.retail ? "text-warn" : "text-ok")}>{b.sell > b.retail ? "+" : ""}{sar(b.sell - b.retail)}</span></> : <span className="text-ink-4">—</span>}</Td>
                        <Td>
                          <div className="flex flex-col gap-1.5">
                            <div className="flex gap-1.5">
                              <ActionForm action={esimPlanRuleAction}><input type="hidden" name="packageId" value={r.packageId} /><input type="hidden" name="code" value={place} /><input type="hidden" name="op" value={picked ? "unpick" : "pick"} /><SubmitButton variant={picked ? "outline" : "soft"} size="sm">{picked ? t("Unpick") : t("Pick")}</SubmitButton></ActionForm>
                              <ActionForm action={esimPlanRuleAction}><input type="hidden" name="packageId" value={r.packageId} /><input type="hidden" name="op" value={hidden ? "show" : "hide"} /><SubmitButton variant="ghost" size="sm">{hidden ? t("Show") : t("Hide")}</SubmitButton></ActionForm>
                            </div>
                            <ActionForm action={esimPlanRuleAction} className="flex items-center gap-1">
                              <input type="hidden" name="packageId" value={r.packageId} /><input type="hidden" name="op" value="rule" />
                              <input name="marginPct" className="field h-8 w-16 px-2 text-[12px]" placeholder="%" defaultValue={own?.marginPct ?? ""} aria-label={t("Margin %")} />
                              <input name="minProfitSar" className="field h-8 w-16 px-2 text-[12px]" placeholder={t("min")} defaultValue={own?.minProfitSar ?? ""} aria-label={t("Minimum profit, SAR")} />
                              <input name="fixedSar" className="field h-8 w-16 px-2 text-[12px]" placeholder={t("fixed")} defaultValue={own?.fixedSar ?? ""} aria-label={t("Fixed price, SAR")} />
                              <SubmitButton variant="outline" size="sm">{t("Set")}</SubmitButton>
                            </ActionForm>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          </div>
        ) : <Card className="grid place-items-center"><Empty icon={<Tags className="size-5" />} title={t("Pick a place")} hint={t("Its plans, what they cost, what they sell for and what Mada keeps.")} /></Card>}
      </div>
    </>
  );
}
