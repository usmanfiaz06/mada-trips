import { describe, expect, it } from 'vitest';
import type { ChangeRequestView, ChatCard } from '@mada/shared';
import { turnsOfLines } from '@/lib/ask-chat';

/*
 * Companions in the chat (ASK-INTEGRATED.md §5.5, U5): a line Mada added on her own (a change Abdullah asked for, in
 * Omar's chat) keeps its card whole, so the chat opened on any device shows Approve · Decline under it.
 */

const change: ChangeRequestView = {
  id: 'c4a00000-0000-4000-8000-000000000001', tripId: '5a1e0000-0000-4000-8000-0000000000aa', tripTitle: 'Riyadh → Penang', byName: 'Abdullah', ownerName: 'Omar',
  summary: 'Two nights in Melaka', lines: [{ op: 'update', title: 'Stay in Melaka', day: 2, field: 'nights', from: '1', to: '2', text: 'Stay in Melaka: 1 → 2 nights' }],
  costs: false, status: 'pending', reason: null, mine: true, createdAt: '2026-10-21T10:00:00.000Z', expiresAt: '2026-10-23T10:00:00.000Z', decidedAt: null,
};

describe('kept cards on a thread line', () => {
  it('a change line opens with its card, even after a finished turn', () => {
    let n = 0;
    const card: ChatCard = { type: 'change', change };
    const turns = turnsOfLines([
      { who: 'me', text: 'Plan Penang', at: '2026-10-21T09:00:00.000Z' },
      { who: 'mada', text: 'Here it is.' },
      { who: 'mada', text: 'Abdullah suggests a change to Riyadh → Penang: Two nights in Melaka', kept: [card], at: '2026-10-21T10:00:00.000Z' },
    ], [], 'en', () => ++n);
    expect(turns).toHaveLength(2);
    expect(turns[1]!.cards).toEqual([card]);
    expect(turns[0]!.cards).toEqual([]);
  });

  it('the phone’s own copy of a turn never hides a kept card', () => {
    let n = 0;
    const card: ChatCard = { type: 'change', change: { ...change, status: 'approved' } };
    const cached = [{ id: 1, me: '', text: 'Omar approved: Two nights in Melaka', status: null, cards: [{ type: 'change', change } as ChatCard], pay: null, handoff: null, intent: null, lang: 'en' as const, state: 'done' as const }];
    const turns = turnsOfLines([{ who: 'mada', text: 'Omar approved: Two nights in Melaka', kept: [card] }], cached, 'en', () => ++n);
    expect(turns[0]!.cards).toEqual([card]);
  });
});
