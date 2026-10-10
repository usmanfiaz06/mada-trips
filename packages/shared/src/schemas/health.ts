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
});
export type HealthResponse = z.infer<typeof HealthResponse>;
