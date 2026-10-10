/*
 * Resilience on the phone (FLOWS.md §12): the connection, the server's clock, the offline copy, the outbox, the
 * remote switches, and the hooks screens use. Components for each state are in components/states.
 */
export { useNet, isOffline, simulateOffline, startNet } from './state';
export { serverNow, useServerNow, clockOffset } from './clock';
export { freshnessLabel, useFreshness, isStale } from './freshness';
export { backoffDelay, newIdempotencyKey, sleep } from './retry';
export { useGates, useFeature, dismissMaintenance } from './gates';
export { loadConfig, useRemoteConfig, useSupplierStatus } from './remote';
export { enqueue, registerOutboxKind, retryItem, discardItem, useOutbox, flushOutbox, type OutboxItem } from './outbox';
export { persistQueries } from './persist';
export { describeError, type Described } from './describe';
export { useApiQuery, useApiMutation, useSlow, type QueryView } from './hooks';
export { reportError, breadcrumb } from './report';
export { useStorageHealth } from './kv';
