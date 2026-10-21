import { z } from 'zod';
import { Id, IsoDateTime } from './common';

/*
 * What Mada remembers (docs/app/ASK-CHAT.md §7): small lasting facts a traveller told Ask ("aisle seat", "flies from
 * Jeddah", "my mother uses a wheelchair"), so the next conversation starts knowing them. Visible and deletable in
 * Account → What Mada remembers; removed with the account. Never a passport, card or anything redaction removes.
 */

export const ASK_MEMORY_ROUTE = '/ask/memory';

export const MemoryKind = z.enum(['home_airport', 'airline', 'cabin', 'seat', 'budget', 'food', 'mobility', 'health', 'family', 'contact', 'other']);
export type MemoryKind = z.infer<typeof MemoryKind>;

/** Kinds saved only after the traveller said yes to "Shall we remember that for next time?". */
export const SENSITIVE_MEMORY_KINDS: readonly MemoryKind[] = ['mobility', 'health'];

export const MemoryFact = z.object({
  id: Id,
  kind: MemoryKind,
  text: z.string().min(1).max(160),
  /** chat: said in a conversation. booking: read from a booking. */
  source: z.enum(['chat', 'booking']),
  createdAt: IsoDateTime,
  lastUsedAt: IsoDateTime.nullable(),
});
export type MemoryFact = z.infer<typeof MemoryFact>;

export const MemoryResponse = z.object({ facts: z.array(MemoryFact) });
export type MemoryResponse = z.infer<typeof MemoryResponse>;
