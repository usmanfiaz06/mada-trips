import "server-only";

/* Resilience for the Core API (FLOWS.md §12). See each module; route() in ../http.ts wires them into every route. */
export { idempotent, idempotencyKeyOf, IDEMPOTENCY_TTL_MS } from "./idempotency";
export { BREAKER, SUPPLIER_TIMEOUTS, callSupplier, degradedSuppliers, guarded, healthOf, resetBreakers, supplierDown, supplierLabel, SupplierTimeout } from "./breaker";
export { clearRuntimeCache, maintenanceRetryAfter, mustUpdate, runtimeConfig, setRuntimeConfig, type RuntimeConfig } from "./runtime";
export { currentRequest, requestIdFrom, withRequest } from "./request";
