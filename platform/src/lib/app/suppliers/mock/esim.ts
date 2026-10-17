import "server-only";
import { ESIM_FIXTURE_PACKAGES, iosInstallLink, mockEsimSim, mockEsimUsage } from "@mada/shared";
import { EsimRefused, type EsimSim, type EsimSupplier, type EsimSupplierOrder } from "../esim-types";

/*
 * The mock eSIM supplier: Airalo-shaped packages from the shared fixtures (Türkiye, the UAE, the UK, Saudi Arabia,
 * Europe and Global), deterministic ICCIDs and install codes from the order's description, usage that switches on once
 * the eSIM is installed. Orders are kept by description, so findOrder answers like Airalo's description filter.
 * `test-out-of-stock-7days-1gb` (as Airalo's sandbox) and demoFail are refused as out of stock.
 */

const g = globalThis as unknown as { __madaMockEsimOrders?: Map<string, EsimSupplierOrder>; __madaMockEsimInstalled?: Map<string, string> };
const orders: Map<string, EsimSupplierOrder> = (g.__madaMockEsimOrders ??= new Map<string, EsimSupplierOrder>());
/** ICCID → when the mock "saw" it switch on (set by markMockEsimInstalled). */
const installed: Map<string, string> = (g.__madaMockEsimInstalled ??= new Map<string, string>());
let seq = 1000;
export const mockEsimCalls = { orders: 0, topups: 0, refunds: 0 };
/** The mock's prepaid balance (USD), like eSIM Access's: an order costs its net price; below it, refused as low balance. */
export const mockEsimBalance = { usd: 500 };
export function resetMockEsim() { orders.clear(); installed.clear(); mockEsimCalls.orders = 0; mockEsimCalls.topups = 0; mockEsimCalls.refunds = 0; mockEsimBalance.usd = 500; }
export const markMockEsimInstalled = (iccid: string, at = new Date().toISOString()) => { installed.set(iccid, at); };

const simFor = (description: string, i: number, packageId: string): EsimSim => {
  const s = mockEsimSim(description, i);
  const p = ESIM_FIXTURE_PACKAGES.find((x) => x.id === packageId);
  return { iccid: s.iccid, lpa: s.lpa, smdp: s.smdp, matchingId: s.matchingId, iosLink: iosInstallLink(s.lpa), apn: p?.apn ?? { type: "automatic", value: null }, roaming: p?.roaming ?? true };
};

const planOfIccid = (iccid: string) => {
  for (const o of orders.values()) if (o.sims.some((s) => s.iccid === iccid)) return ESIM_FIXTURE_PACKAGES.find((p) => p.id === o.packageId) ?? null;
  return null;
};

export const mockEsim: EsimSupplier = {
  name: "mock",
  async packages(q) {
    return "global" in q ? ESIM_FIXTURE_PACKAGES.filter((p) => p.coverage.kind !== "local") : ESIM_FIXTURE_PACKAGES.filter((p) => p.coverage.kind === "local" && p.coverage.code === q.country);
  },
  async catalogue() {
    // A suggested retail on each, as eSIM Access gives one, so the desk's "vs suggested retail" has something to show.
    return ESIM_FIXTURE_PACKAGES.map((p) => ({ ...p, retailUsd: Math.round(p.netUsd * 18) / 10 }));
  },
  async balance() {
    return { usd: mockEsimBalance.usd };
  },
  async topupPackages(iccid) {
    const p = planOfIccid(iccid);
    if (!p) throw new EsimRefused(404, "not found");
    return ESIM_FIXTURE_PACKAGES.filter((x) => x.coverage.code === p.coverage.code && x.days <= 30 && x.topup).map((x) => ({ ...x, id: `${x.id}-topup` }));
  },
  async order({ packageId, quantity, description, demoFail }) {
    if (demoFail || packageId.startsWith("test-out-of-stock")) throw new EsimRefused(33, "Insufficient stock", true);
    if (!ESIM_FIXTURE_PACKAGES.some((p) => p.id === packageId)) throw new EsimRefused(34, "The selected package is invalid.");
    const p = ESIM_FIXTURE_PACKAGES.find((x) => x.id === packageId)!;
    if (mockEsimBalance.usd < p.netUsd * quantity) throw new EsimRefused("200007", "Insufficient account balance", true, false, true);
    mockEsimBalance.usd = Math.round((mockEsimBalance.usd - p.netUsd * quantity) * 100) / 100;
    mockEsimCalls.orders += 1;
    seq += 1;
    const o: EsimSupplierOrder = {
      id: String(seq), code: `20261017-${seq}`, packageId, quantity, description, netUsd: p.netUsd * quantity,
      sims: Array.from({ length: quantity }, (_, i) => simFor(description, i, packageId)),
    };
    orders.set(description, o);
    return o;
  },
  async findOrder(description) {
    return orders.get(description) ?? null;
  },
  async sim(iccid) {
    for (const o of orders.values()) { const s = o.sims.find((x) => x.iccid === iccid); if (s) return s; }
    throw new EsimRefused(404, "not found");
  },
  async usage(iccid) {
    const p = planOfIccid(iccid);
    return mockEsimUsage({ gb: p?.gb ?? 5, days: p?.days ?? 30 }, installed.get(iccid) ?? null);
  },
  async topup({ iccid, packageId, description }) {
    if (!planOfIccid(iccid)) throw new EsimRefused(404, "not found");
    mockEsimCalls.topups += 1;
    seq += 1;
    orders.set(description, { id: String(seq), code: null, packageId, quantity: 1, description, netUsd: null, sims: [] });
    return { id: String(seq) };
  },
  async refund() {
    mockEsimCalls.refunds += 1;
    seq += 1;
    return { id: `rf-${seq}` };
  },
};
