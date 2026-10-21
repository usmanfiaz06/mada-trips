import { beforeEach, describe, expect, it } from 'vitest';
import { ASK_CHAT_KEEP_MS, ASK_CHAT_KEY, cacheWith, freshSaved, lastAskThread, newAskChat, openAskThread, restoreAskChat, savedOf, turnsOfLines, useAskChat, type ChatTurn, type SavedChat, type SavedChats } from '@/lib/ask-chat';
import { kvReadJson, setKvBackend } from '@/lib/net/kv';
import { useSession } from '@/lib/session';

/*
 * Continuity on the phone (ASK-INTEGRATED.md §2.5): a cache keyed by thread id (3 chats); the orb reopens the last chat
 * within a day; "New chat" starts fresh and leaves the others in the cache and the list.
 */

const TOKENS = { accessToken: 'a.b.c', accessExpiresAt: new Date(Date.now() + 60_000).toISOString(), refreshToken: 'r1', refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString() };
const TID = '0b6f2f3e-7c2a-4b8e-9d55-5a3c1f0e9a11';
const store = new Map<string, string>();
setKvBackend({ getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); }, removeItem: async (k) => { store.delete(k); } });

const turn = (id: number, state: ChatTurn['state'], at = new Date().toISOString()): ChatTurn => ({
  id, me: `message ${id}`, at, text: `reply ${id}`, status: null, cards: [], pay: null, handoff: null, intent: null, lang: 'en', state,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  store.clear();
  await useSession.getState().signIn(TOKENS, { id: 'u1', name: 'Omar', phone: '+966500004127' } as never);
  useAskChat.getState().reset();
});

describe('keeping the conversation', () => {
  it('keeps finished turns only, for this account, for 24 hours', () => {
    const s = savedOf({ threadId: TID, turns: [turn(1, 'done'), turn(2, 'stopped'), turn(3, 'done')] }, 'u1')!;
    expect(s.turns.map((x) => x.id)).toEqual([1, 3]);
    expect(savedOf({ threadId: null, turns: [turn(1, 'done')] }, 'u1')).toBeNull();
    expect(freshSaved(s, 'u1')).toBe(s);
    expect(freshSaved(s, 'u2')).toBeNull();
    expect(freshSaved(s, 'u1', s.at + ASK_CHAT_KEEP_MS + 1)).toBeNull();
  });

  it('comes back when Ask opens again within a day, and not after', async () => {
    const saved: SavedChat = { v: 1, at: Date.now() - 60 * 60_000, user: 'u1', threadId: TID, turns: [turn(4, 'done')] };
    store.set(ASK_CHAT_KEY, JSON.stringify({ v: 2, user: 'u1', last: TID, chats: [saved] } satisfies SavedChats));
    expect(await lastAskThread()).toBe(TID);
    expect(await restoreAskChat()).toBe(true);
    expect(useAskChat.getState()).toMatchObject({ threadId: TID, turns: [{ id: 4, me: 'message 4' }] });
    useAskChat.getState().reset();
    expect(await restoreAskChat(Date.now() + ASK_CHAT_KEEP_MS)).toBe(false);
    expect(useAskChat.getState().turns).toEqual([]);
  });

  it('saves as turns finish; New chat lets go of it but keeps it to open again', async () => {
    await restoreAskChat();
    useAskChat.setState({ threadId: TID, turns: [turn(7, 'done')], busy: false });
    await wait(400);
    expect((await kvReadJson<SavedChats>(ASK_CHAT_KEY))).toMatchObject({ last: TID, chats: [{ threadId: TID }] });
    newAskChat();
    await wait(50);
    expect(await kvReadJson<SavedChats>(ASK_CHAT_KEY)).toMatchObject({ last: null, chats: [{ threadId: TID }] });
    expect(useAskChat.getState()).toMatchObject({ threadId: null, turns: [] });
    expect(await lastAskThread()).toBeNull();
    // Opening it again paints the phone's copy at once (the server answers later, or not at all offline).
    expect(await openAskThread(TID)).toBe(true);
    expect(useAskChat.getState()).toMatchObject({ threadId: TID, turns: [{ id: 7 }] });
  });

  it('keeps three chats, newest first, each with its own turns', () => {
    let c: SavedChats = { v: 2, user: 'u1', last: null, chats: [] };
    for (const [i, id] of ['a', 'b', 'c', 'd'].entries()) c = cacheWith(c, { v: 1, at: i, user: 'u1', threadId: id, turns: [turn(i, 'done')] }, id);
    expect(c.chats.map((x) => x.threadId)).toEqual(['d', 'c', 'b']);
    expect(c.last).toBe('d');
    c = cacheWith(c, { v: 1, at: 9, user: 'u1', threadId: 'b', turns: [turn(9, 'done')] }, 'b');
    expect(c.chats.map((x) => [x.threadId, x.turns[0]!.id])).toEqual([['b', 9], ['d', 3], ['c', 2]]);
  });
});

describe('a chat from the server', () => {
  it("pairs each message with its answer, a person's reply and the joined line, keeping the phone's cards", () => {
    let n = 100;
    const cached: ChatTurn[] = [{ ...turn(1, 'done'), me: 'Flights to Istanbul', text: 'Three good ways.', cards: [{ type: 'trips', trips: [] }] }];
    const turns = turnsOfLines([
      { who: 'me', text: 'Flights to Istanbul', at: '2026-10-21T10:00:00.000Z' },
      { who: 'mada', text: 'Three good ways.', next: ['Book the first one'] },
      { who: 'me', text: 'A person please', at: '2026-10-21T10:05:00.000Z' },
      { who: 'mada', text: 'The team at Mada can take it from here.' },
      { who: 'joined', text: 'Noura from Mada joined', by: 'Noura', at: '2026-10-21T10:06:00.000Z' },
      { who: 'agent', text: 'Hi, Noura here.', by: 'Noura' },
      { who: 'agent', text: 'Which dates?', by: 'Noura' },
    ], cached, 'en', () => ++n);
    expect(turns.map((x) => [x.me, x.text, x.by ?? null, x.desk ?? null])).toEqual([
      ['Flights to Istanbul', 'Three good ways.', null, null],
      ['A person please', 'The team at Mada can take it from here.', null, null],
      ['', 'Noura from Mada joined', null, 'joined'],
      ['', 'Hi, Noura here.\n\nWhich dates?', 'Noura', null],
    ]);
    expect(turns[0]!.cards).toHaveLength(1);
    expect(turns[0]!.next).toEqual(['Book the first one']);
  });
});
