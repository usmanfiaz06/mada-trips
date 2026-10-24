import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { amountInput, sar } from "@/lib/money";
import { costFor, LEASE_TERMS, vehicleName } from "@/lib/portal";
import { withBase } from "@/lib/base";
import { Badge, Card, Input, PageHeader, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { saveVehicle } from "../actions";

export const metadata = { title: "Lease catalog" };

export default async function CatalogPage() {
  await requirePerm("clients.credit");
  const t = await getT();
  const cars = await db.select().from(schema.vehicles).orderBy(asc(schema.vehicles.sort));
  return (
    <>
      <PageHeader eyebrow={t("Corporate clients")} title={t("Lease catalog")}
        subtitle={t("Supplier cost and Mada's list price per car, per month, before VAT. Clients see the list price unless their workspace has a markup or an agreed price. Costs never leave Ops.")} />
      <div className="space-y-3">
        {cars.map((v) => {
          const price = v.price as Record<string, number>;
          return (
            <Card key={v.id} className={cx(!v.active && "opacity-60")}>
              <ActionForm action={saveVehicle} className="grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
                <input type="hidden" name="id" value={v.id} />
                <div className="flex items-center gap-3">
                  <span className="grid h-14 w-24 shrink-0 place-items-center rounded-xl bg-sunken">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {v.image ? <img src={withBase(v.image)} alt="" className="max-h-12 max-w-[88px] object-contain" /> : <span className="text-[11px] text-ink-3">{t("No photo")}</span>}
                  </span>
                  <div>
                    <div className="text-[14.5px] font-medium">{vehicleName(v)}</div>
                    <div className="text-[12px] text-ink-3">{[v.trim, v.engine, v.drive, v.seats ? `${v.seats} ${t("seats")}` : null].filter(Boolean).join(" · ")}</div>
                    {v.onRequest && <Badge tone="info" className="mt-1">{t("Price on request")}</Badge>}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="text-[12.5px]">
                    <thead><tr><th className="pe-3 text-start font-normal text-ink-3"></th>{LEASE_TERMS.map((tm) => <th key={tm} className="px-1.5 pb-1 text-start font-normal text-ink-3">{tm} {t("mo")}</th>)}</tr></thead>
                    <tbody>
                      <tr>
                        <td className="pe-3 text-ink-3">{t("Supplier cost")}</td>
                        {LEASE_TERMS.map((tm) => { const c = costFor(v, tm); return <td key={tm} className="px-1.5 py-1"><Input name={`cost_${tm}`} defaultValue={c !== null ? amountInput(c) : ""} inputMode="decimal" dir="ltr" className="num h-9 w-[110px]" /></td>; })}
                      </tr>
                      <tr>
                        <td className="pe-3 text-ink-3">{t("List price")}</td>
                        {LEASE_TERMS.map((tm) => {
                          const p = price[String(tm)], c = costFor(v, tm);
                          return (
                            <td key={tm} className="px-1.5 py-1">
                              <Input name={`price_${tm}`} defaultValue={p !== undefined ? amountInput(p) : ""} inputMode="decimal" dir="ltr" className="num h-9 w-[110px]" />
                              {p !== undefined && c !== null && <div className={cx("mt-0.5 text-[11px]", p > c ? "text-ok" : "text-bad")} dir="ltr">{p > c ? `+${sar(p - c)}` : t("at cost")}</div>}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-2 text-[13px]">
                  <Input name="supplier" defaultValue={v.supplier ?? ""} placeholder={t("Supplier")} className="h-9 w-40" />
                  <label className="flex items-center gap-2"><input type="checkbox" name="onRequest" defaultChecked={v.onRequest} className="accent-[var(--brand)]" />{t("Price on request")}</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={v.active} className="accent-[var(--brand)]" />{t("In the catalog")}</label>
                  <SubmitButton size="sm">{t("Save")}</SubmitButton>
                </div>
              </ActionForm>
            </Card>
          );
        })}
      </div>
    </>
  );
}
