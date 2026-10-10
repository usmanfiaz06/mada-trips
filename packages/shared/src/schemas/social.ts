import { z } from 'zod';
import { HalalasAmount, Id, IsoDateTime } from './common';

/** A circle: the people you travel with (SCOPE.md §5.5). */
export const Circle = z.object({
  id: Id,
  name: z.string().min(1).max(60),
  imageUrl: z.string().nullable(),
  tripId: Id.nullable(),
  role: z.enum(['admin', 'member']),
  memberCount: z.number().int(),
  muted: z.boolean(),
  unread: z.number().int(),
  createdAt: IsoDateTime,
});
export type Circle = z.infer<typeof Circle>;

export const CircleMember = z.object({
  userId: Id,
  firstName: z.string(),
  role: z.enum(['admin', 'member']),
  /** What they owe on the group split, in halalas. A record only: Mada holds no money for the group. */
  shareDue: HalalasAmount,
  joinedAt: IsoDateTime,
});
export type CircleMember = z.infer<typeof CircleMember>;

/**
 * Who wrote a message. Software never passes as a person (COPY.md §6.3): 'mada' messages carry no face,
 * 'agent' messages always carry the named person who wrote them.
 */
export const MessageAuthor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mada') }),
  z.object({ kind: z.literal('agent'), id: z.string(), name: z.string(), photoUrl: z.string().nullable() }),
  z.object({ kind: z.literal('user'), id: Id, name: z.string() }),
]);
export type MessageAuthor = z.infer<typeof MessageAuthor>;

export const Message = z.object({
  id: Id,
  thread: z.object({ kind: z.enum(['request', 'circle', 'support']), id: Id }),
  author: MessageAuthor,
  body: z.string().max(4000),
  /** Cards that can be acted on: a vote, pay my share, approve. */
  card: z.record(z.string(), z.unknown()).nullable(),
  createdAt: IsoDateTime,
  readAt: IsoDateTime.nullable(),
});
export type Message = z.infer<typeof Message>;

export const SendMessageRequest = z.object({ body: z.string().trim().min(1).max(4000) });
