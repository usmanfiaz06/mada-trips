import { z } from 'zod';
import { Id, IsoDateTime } from './common';

/** SCOPE.md §7. 'time_sensitive' breaks through Focus; promotions never exist as a level. */
export const NotificationLevel = z.enum(['time_sensitive', 'active', 'passive']);

export const NotificationKind = z.enum([
  'gate_change', 'leave_now', 'driver_here', 'booking_confirmed', 'connection_risk', 'flight_cancelled', 'flight_delayed',
  'refund_moved', 'agent_reply', 'agent_needs_answer', 'document_problem', 'digest', 'circle', 'other',
]);

export const Notification = z.object({
  id: Id,
  kind: NotificationKind,
  level: NotificationLevel,
  /** Lock-screen limits (COPY.md §5.8). */
  title: z.string().max(32),
  body: z.string().max(90),
  /** In-app destination, e.g. "/trips/…" */
  href: z.string().nullable(),
  readAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type Notification = z.infer<typeof Notification>;

export const RegisterDeviceRequest = z.object({
  pushToken: z.string().min(10).max(400),
  platform: z.enum(['ios', 'android', 'web']),
  name: z.string().max(80).optional(),
});
