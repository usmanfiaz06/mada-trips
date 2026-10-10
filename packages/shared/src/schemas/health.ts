import { z } from 'zod';

export const SupplierModeSchema = z.enum(['mock', 'live']);

export const HealthResponse = z.object({
  ok: z.boolean(),
  service: z.literal('mada-core'),
  apiVersion: z.literal('v1'),
  db: z.enum(['ok', 'error']),
  /** Which suppliers run against mocks. Never includes keys or hosts. */
  suppliers: z.record(z.string(), SupplierModeSchema),
  dataKey: z.enum(['ok', 'missing']),
  time: z.string(),
  /** Suppliers whose circuit breaker isn't fully closed right now (resilience/breaker.ts): name → degraded | down. */
  breakers: z.record(z.string(), z.enum(['degraded', 'down'])).optional(),
  /** Planned maintenance is on (GET /config). */
  maintenance: z.boolean().optional(),
  /** How long the database took to answer SELECT 1, in ms. */
  dbMs: z.number().int().optional(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
