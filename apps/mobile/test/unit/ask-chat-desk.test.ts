import { describe, expect, it } from 'vitest';
import { AskChatEvent, AskDeskResponse, type AskDeskLine } from '@mada/shared';
import { applyChatEvent, applyDeskLines, savedOf, type ChatTurn } from '@/lib/ask-chat';

/*
 * A person on the desk takes Ask over (DESK-PLAN.md U5): the message the traveller sends while they have it gets no
 * answer from Mada, "Noura from Mada joined" shows once, and Noura's replies show as hers (`by`).
 */

const at = '2026-10-21T09:00:00.000Z';
const turn = (o: Partial<ChatTurn>): ChatTurn => ({ id: 1, me: 'hi', text: '', status: null, cards: [], pay: null, handoff: null, intent: null, lang: 'en', state: 'done', at, ...o });
const line = (o: Partial<AskDeskLine>): AskDeskLine => ({ n: 3, kind: 'agent', by: 'Noura', text: 'Hi, Noura here', at, ...o });
const ids = () => { let n = 100; return () => ++n; };

describe('the desk in the conversation', () => {
  it('reads the agent event and the desk endpoint', () => {
    expect(AskChatEvent.parse({ type: 'agent', name: 'Noura' })).toEqual({ type: 'agent', name: 'Noura' });
    expect(AskDeskResponse.parse({ mode: 'agent', agent: 'Noura', lines: [line({})], last: 3 }).lines).toHaveLength(1);
    // The message waits for the person: nothing more in this turn, and the bubble stays empty.
    expect(applyChatEvent(turn({ state: 'streaming', status: 'Thinking' }), { type: 'agent', name: 'Noura' })).toMatchObject({ status: null, text: '' });
  });

  it('shows "joined" once as its own line, then the reply as hers', () => {
    const before = [turn({ id: 1, me: 'Can I talk to someone', text: 'The team at Mada can take it from here.' })];
    const out = applyDeskLines(before, [line({ n: 2, kind: 'joined', text: 'Noura from Mada joined' }), line({ n: 3 })], ids());
    expect(out.map((x) => [x.me, x.by ?? null, x.desk ?? null, x.text])).toEqual([
      ['Can I talk to someone', null, null, 'The team at Mada can take it from here.'],
      ['', null, 'joined', 'Noura from Mada joined'],
      ['', 'Noura', null, 'Hi, Noura here'],
    ]);
  });

  it('answers the traveller\'s waiting message in place, and runs the same person\'s lines together', () => {
    const waiting = [turn({ id: 1, me: 'Hello? Anyone there', text: '' })];
    const a = applyDeskLines(waiting, [line({ text: 'Yes, Noura here' })], ids());
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ me: 'Hello? Anyone there', by: 'Noura', text: 'Yes, Noura here' });
    const b = applyDeskLines(a, [line({ n: 5, text: 'One moment' })], ids());
    expect(b).toHaveLength(2);
    const c = applyDeskLines(b, [line({ n: 6, text: 'Done: refunded' })], ids());
    expect(c).toHaveLength(2);
    expect(c[1]).toMatchObject({ me: '', by: 'Noura', text: 'One moment\n\nDone: refunded' });
  });

  it('keeps how far it read with the conversation', () => {
    const s = savedOf({ threadId: '0b6f2f3e-7c2a-4b8e-9d55-5a3c1f0e9a11', turns: [turn({})], deskAfter: 7 }, 'u1');
    expect(s?.deskAfter).toBe(7);
  });
});
