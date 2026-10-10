import { z } from 'zod';

/*
 * The agent desk's contract with the app: who is there for this traveller right now (COPY.md §1, "Mada and Faisal").
 * GET /api/app/v1/support/presence[?threadKind=request|support&threadId=…]
 */

export const PresenceAgent = z.object({
  id: z.string(),
  /** First name, as the traveller knows them: "Faisal". */
  name: z.string(),
  initial: z.string(),
  photoUrl: z.string().nullable(),
  languages: z.array(z.string()),
});
export type PresenceAgent = z.infer<typeof PresenceAgent>;

export const PresenceResponse = z.object({
  /** Always "Mada": the chat header's title. The person is the line under it. */
  title: z.string(),
  /** The person on duty for this traveller now, or null when nobody is (never at launch: the desk is 24/7). */
  agent: PresenceAgent.nullable(),
  /** The traveller's own agent, when someone else is covering tonight. */
  usual: PresenceAgent.nullable(),
  covering: z.boolean(),
  online: z.boolean(),
  /** True while the agent is typing in the thread asked about. */
  typing: z.boolean(),
  /** "Usually replies in 2 min". */
  replyMinutes: z.number().int().positive(),
  /** The finished line for under the title: "Faisal is online · Usually replies in 2 min". */
  line: z.string(),
});
export type PresenceResponse = z.infer<typeof PresenceResponse>;

export const PresenceQuery = z.object({
  threadKind: z.enum(['request', 'support']).optional(),
  threadId: z.uuid().optional(),
});
