import { beforeEach, describe, expect, it } from 'vitest';
import { ASK_CHAT_KEEP_MS, ASK_CHAT_KEY, freshSaved, newAskChat, restoreAskChat, savedOf, useAskChat, type ChatTurn, type SavedChat } from '@/lib/ask-chat';
import { kvReadJson, setKvBackend } from '@/lib/net/kv';
import { useSession } from '@/lib/session';

/* Continuity on the phone: reopening Ask within a day continues the same conversation; "New chat" starts fresh. */

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
    store.set(ASK_CHAT_KEY, JSON.stringify(saved));
    expect(await restoreAskChat()).toBe(true);
    expect(useAskChat.getState()).toMatchObject({ threadId: TID, turns: [{ id: 4, me: 'message 4' }] });
    useAskChat.getState().reset();
    expect(await restoreAskChat(Date.now() + ASK_CHAT_KEEP_MS)).toBe(false);
    expect(useAskChat.getState().turns).toEqual([]);
  });

  it('saves as turns finish, and New chat clears it', async () => {
    await restoreAskChat();
    useAskChat.setState({ threadId: TID, turns: [turn(7, 'done')], busy: false });
    await wait(400);
    expect((await kvReadJson<SavedChat>(ASK_CHAT_KEY))?.threadId).toBe(TID);
    newAskChat();
    await wait(50);
    expect(await kvReadJson<SavedChat>(ASK_CHAT_KEY)).toBeNull();
    expect(useAskChat.getState()).toMatchObject({ threadId: null, turns: [] });
  });
});
