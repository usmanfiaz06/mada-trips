import "server-only";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { DESTINATIONS, esimCostChanges, type EsimPackage } from "@mada/shared";
import { db } from "@/db";
import { appRuntime } from "@/db/app-schema-resilience";
import { appEsimCatalogue } from "@/db/app-schema-esim";
import { esimVendor, suppliers } from "../suppliers";
import { toE4 } from "../suppliers/live/esimaccess";

/*
 * The supplier's catalogue, synced once a day (esim/ops.ts): every package with its cost, and what changed since the
 * last sync ("cost went up on 12 plans", in app_runtime "esim.catalogue"). Sell prices are never stored: the desk and
 * the app work them out from the owner's rules each time, so a cost change reprices by rule, never below the guard.
 */

const KEY = "esim.catalogue";
export type CatalogueStatus = { at: string | null; total: number; up: string[]; down: string[]; added: string[]; gone: string[] };
type Row = typeof appEsimCatalogue.$inferSelect;

export async function catalogueStatus(): Promise<CatalogueStatus> {
  const [row] = await db.select().from(appRuntime).where(eq(appRuntime.key, KEY)).catch(() => []);
  const v = (row?.value ?? {}) as Partial<CatalogueStatus>;
  return { at: v.at ?? null, total: v.total ?? 0, up: v.up ?? [], down: v.down ?? [], added: v.added ?? [], gone: v.gone ?? [] };
}

/** Everything the supplier sells: its own full list when it has one, else each destination Mada knows plus regions. */
async function everything(): Promise<EsimPackage[]> {
  const sup = suppliers.esim();
  if (sup.catalogue) return sup.catalogue();
  const countries = [...new Set(Object.values(DESTINATIONS).map((d) => d.country))];
  const lists = await Promise.all([sup.packages({ global: true }), ...countries.map((c) => sup.packages({ country: c }).catch(() => [] as EsimPackage[]))]);
  return lists.flat();
}

export async function syncCatalogue(now = new Date()): Promise<CatalogueStatus> {
  const supplier = esimVendor();
  const list = [...new Map((await everything()).map((p) => [p.id, p])).values()];
  const before = await db.select({ id: appEsimCatalogue.packageId, cost: appEsimCatalogue.costE4, gone: appEsimCatalogue.goneAt }).from(appEsimCatalogue).where(eq(appEsimCatalogue.supplier, supplier));
  const live = new Map(before.filter((b) => !b.gone).map((b) => [b.id, b.cost / 10_000]));
  const changes = esimCostChanges(live, list);
  const old = new Map(before.map((b) => [b.id, b.cost]));
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200).map((p) => {
      const cost = toE4(p.netUsd);
      const was = old.get(p.id);
      const changed = was !== undefined && was !== cost;
      return {
        packageId: p.id, supplier, pkg: p as unknown as Record<string, unknown>, coverageCode: p.coverage.code, gb: p.gb, days: p.days, daily: !!p.daily,
        costE4: cost, retailE4: p.retailUsd ? toE4(p.retailUsd) : null, prevCostE4: changed ? was! : null, costChangedAt: changed ? now : null, seenAt: now, goneAt: null,
      };
    });
    if (!chunk.length) continue;
    await db.insert(appEsimCatalogue).values(chunk).onConflictDoUpdate({
      target: appEsimCatalogue.packageId,
      set: {
        supplier, pkg: sqlExcluded("pkg"), coverageCode: sqlExcluded("coverage_code"), gb: sqlExcluded("gb"), days: sqlExcluded("days"), daily: sqlExcluded("daily"),
        retailE4: sqlExcluded("retail_e4"), seenAt: now, goneAt: null,
        // The previous cost and when it changed are kept until the next change.
        prevCostE4: sqlCase("prev_cost_e4"), costChangedAt: sqlCase("cost_changed_at"), costE4: sqlExcluded("cost_e4"),
      },
    });
  }
  const ids = list.map((p) => p.id);
  if (ids.length) await db.update(appEsimCatalogue).set({ goneAt: now }).where(and(eq(appEsimCatalogue.supplier, supplier), isNull(appEsimCatalogue.goneAt), notInArray(appEsimCatalogue.packageId, ids)));
  const status: CatalogueStatus = { at: now.toISOString(), total: list.length, up: changes.up.slice(0, 500), down: changes.down.slice(0, 500), added: before.length ? changes.added.slice(0, 500) : [], gone: changes.gone.slice(0, 500) };
  await db.insert(appRuntime).values({ key: KEY, value: status, updatedAt: now }).onConflictDoUpdate({ target: appRuntime.key, set: { value: status, updatedAt: now } });
  return status;
}

/** The catalogue for the desk's pricing page: one place (coverage code), or everything. */
export async function catalogueRows(code?: string | null): Promise<(Row & { pkgv: EsimPackage })[]> {
  const where = code ? and(eq(appEsimCatalogue.coverageCode, code), isNull(appEsimCatalogue.goneAt)) : isNull(appEsimCatalogue.goneAt);
  const rows = await db.select().from(appEsimCatalogue).where(where).orderBy(appEsimCatalogue.coverageCode, appEsimCatalogue.days).limit(code ? 400 : 2000);
  return rows.map((r) => ({ ...r, pkgv: { ...(r.pkg as unknown as EsimPackage), netUsd: r.costE4 / 10_000, retailUsd: r.retailE4 ? r.retailE4 / 10_000 : null } }));
}

/* `excluded.<col>` and "keep the old value unless the cost changed" for the upsert above. */
function sqlExcluded(col: string) { return sql.raw(`excluded."${col}"`); }
function sqlCase(col: string) {
  return sql.raw(`CASE WHEN excluded."cost_e4" <> "app_esim_catalogue"."cost_e4" THEN ${col === "prev_cost_e4" ? `"app_esim_catalogue"."cost_e4"` : "now()"} ELSE "app_esim_catalogue"."${col}" END`);
}
