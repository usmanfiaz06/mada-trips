import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSseFrames, type AskChatEvent } from '@mada/shared';
import { applyChatEvent, sendAskChat, streamAskChat, useAskChat, type ChatTurn } from '@/lib/ask-chat';
import { useSession } from '@/lib/session';
import { resetNet } from '@/lib/net/state';

/* Ask as a conversation on the phone: the stream read as it arrives, the turn built from it, and every way it stops. */

const TOKENS = { accessToken: 'a.b.c', accessExpiresAt: new Date(Date.now() + 60_000).toISOString(), refreshToken: 'r1', refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString() };
const USER = { id: 'u1', name: 'Omar', phone: '+966500004127' } as never;
const TID = '0b6f2f3e-7c2a-4b8e-9d55-5a3c1f0e9a11';
const frame = (e: AskChatEvent) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;

/** An SSE body that arrives in awkward pieces (frames split mid-way). */
function sse(events: AskChatEvent[], status = 200) {
  const text = events.map(frame).join('');
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 11) chunks.push(text.slice(i, i + 11));
  const body = new ReadableStream<Uint8Array>({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); } });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

beforeEach(async () => { resetNet({ connected: true }); await useSession.getState().signIn(TOKENS, USER); useAskChat.getState().reset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the stream', () => {
  it('reads frames split anywhere, and skips ones it cannot read', () => {
    const all = frame({ type: 'text', delta: 'Three ' }) + 'data: {nope}\n\n' + frame({ type: 'text', delta: 'ways.' });
    const a = readSseFrames(all.slice(0, 30));
    const b = readSseFrames(a.rest + all.slice(30));
    expect([...a.events, ...b.events].map((e) => (e as { delta: string }).delta)).toEqual(['Three ', 'ways.']);
  });

  it('builds the turn token by token, then cards, and keeps the thread for the next message', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(String(init.body));
      return sse([
        { type: 'thread', threadId: TID, lang: 'en' },
        { type: 'status', text: 'Checking flights to Istanbul' },
        { type: 'text', delta: 'Three ways ' },
        { type: 'text', delta: 'to get there.' },
        { type: 'cards', cards: [{ type: 'car', city: 'Istanbul', from: 'Istanbul Airport', to: 'Taksim', when: 'now' }] },
        { type: 'done', text: 'Three ways to get there.' },
      ]);
    }));
    const turn = await sendAskChat('Istanbul for Eid');
    expect(turn).toMatchObject({ state: 'done', text: 'Three ways to get there.', status: null });
    expect(turn.cards[0]).toMatchObject({ type: 'car', to: 'Taksim' });
    expect(useAskChat.getState()).toMatchObject({ threadId: TID, busy: false });
    await sendAskChat('make it 5 of us');
    expect(JSON.parse(seen[1]!)).toMatchObject({ text: 'make it 5 of us', threadId: TID });
  });

  it('falls back to the flows on an error event, a plain error, no network or a broken line', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([{ type: 'thread', threadId: TID, lang: 'en' }, { type: 'error', code: 'SUPPLIER_UNAVAILABLE', fallback: true }])));
    expect(await streamAskChat({ text: 'hi' }, () => {})).toBe('fallback');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'NOT_CONFIGURED' } }), { status: 501, headers: { 'content-type': 'application/json' } })));
    expect(await streamAskChat({ text: 'hi' }, () => {})).toBe('fallback');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Network request failed'); }));
    expect(await streamAskChat({ text: 'hi' }, () => {})).toBe('fallback');
    // A stream that ends without "done" is not an answer.
    vi.stubGlobal('fetch', vi.fn(async () => sse([{ type: 'text', delta: 'Three' }])));
    const turn = await sendAskChat('Istanbul');
    expect(turn.state).toBe('stopped');
  });
});

describe('two messages', () => {
  it('a newer message takes over: the older one stops quietly, without falling back', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      n += 1;
      if (n === 1) return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      return sse([{ type: 'thread', threadId: TID, lang: 'en' }, { type: 'done', text: 'Noted.' }]);
    }));
    const first = sendAskChat('Istanbul');
    const second = await sendAskChat('No, Dubai');
    expect((await first).state).toBe('superseded');
    expect(second.state).toBe('done');
    expect(useAskChat.getState().busy).toBe(false);
  });
});

describe('a turn', () => {
  const blank: ChatTurn = { id: 1, me: 'x', text: '', status: null, cards: [], pay: null, handoff: null, intent: null, lang: 'en', state: 'streaming' };
  it('takes back words a check removed, and ends on the server’s final text', () => {
    let t = applyChatEvent(blank, { type: 'text', delta: 'The first is ' });
    t = applyChatEvent(t, { type: 'replace', text: 'Here’s what we found.' });
    expect(t.text).toBe('Here’s what we found.');
    t = applyChatEvent(t, { type: 'handoff', threadId: TID, agent: 'Noura' });
    expect(applyChatEvent(t, { type: 'done', text: 'Noura at Mada can take it from here.' })).toMatchObject({ state: 'done', handoff: { agent: 'Noura' }, text: 'Noura at Mada can take it from here.' });
  });
});
