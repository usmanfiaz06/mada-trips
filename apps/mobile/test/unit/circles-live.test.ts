import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inviteCodeIn, type CircleLiveEvent } from '@mada/shared';

const invalidate = vi.fn(async () => {});
vi.mock('@/lib/queries', () => ({ queryClient: { invalidateQueries: invalidate } }));
vi.mock('expo-clipboard', () => ({ hasStringAsync: async () => false, getStringAsync: async () => '' }));
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
const { applyEvent, pollEvery, useLive } = await import('@/lib/circles-live');

/* The live channel's client side: what each event refreshes, typing, repeats ignored, and when screens poll. */

let seq = 1000;
const ev = (kind: CircleLiveEvent['kind'], extra: Partial<CircleLiveEvent> = {}): CircleLiveEvent =>
  ({ id: (seq += 1), circleId: 'c1', kind, ref: null, actor: 'u2', ...extra });
const touched = () => invalidate.mock.calls.map((c) => JSON.stringify((c as unknown as [{ queryKey: unknown }])[0].queryKey));
const settle = () => new Promise((r) => setTimeout(r, 150));

beforeEach(() => { invalidate.mockClear(); useLive.setState({ mode: 'off', typing: {} }); });

describe('live events', () => {
  it('a new message refreshes that chat and the circles list, once even if it arrives twice', async () => {
    const e = ev('message', { ref: 'm1' });
    applyEvent(e, 'me');
    applyEvent(e, 'me');
    await settle();
    expect(touched().sort()).toEqual(['["circles","list"]', '["circles","messages","c1"]']);
  });

  it('someone joining or leaving refreshes the circle, its chat, the list and invites', async () => {
    applyEvent(ev('member', { ref: 'u3' }), 'me');
    await settle();
    expect(touched()).toEqual(expect.arrayContaining(['["circles","circle","c1"]', '["circles","messages","c1"]', '["circles","list"]', '["circles","invites"]']));
  });

  it('my own read receipt refreshes nothing; someone else\'s refreshes the chat (seen by)', async () => {
    applyEvent(ev('read', { actor: 'me' }), 'me');
    await settle();
    expect(touched()).toEqual([]);
    applyEvent(ev('read', { actor: 'u2' }), 'me');
    await settle();
    expect(touched()).toContain('["circles","messages","c1"]');
  });

  it('typing shows for a few seconds, never for me, and stops when their message lands', () => {
    applyEvent(ev('typing', { actor: 'me' }), 'me');
    expect(useLive.getState().typing.c1).toBeUndefined();
    applyEvent(ev('typing', { actor: 'u2' }), 'me');
    expect(useLive.getState().typing.c1?.u2).toBeGreaterThan(Date.now());
    applyEvent(ev('message', { actor: 'u2' }), 'me');
    expect(useLive.getState().typing.c1?.u2).toBeUndefined();
  });

  it('screens poll on their own only while the channel is down', () => {
    useLive.setState({ mode: 'off' });
    expect(pollEvery(5_000)).toBe(5_000);
    useLive.setState({ mode: 'stream' });
    expect(pollEvery(5_000)).toBe(60_000);
    useLive.setState({ mode: 'poll' });
    expect(pollEvery(15_000)).toBe(60_000);
  });
});

describe('invite codes in what people paste', () => {
  it('finds the code in a link, a short link, the app link or a WhatsApp message, and nothing else', () => {
    expect(inviteCodeIn('https://madatrips.sa/join/ab2cd3ef-gh4jk5')).toBe('ab2cd3ef-gh4jk5');
    expect(inviteCodeIn('madatrips.sa/i/AB2CD3EF-GH4JK5')).toBe('ab2cd3ef-gh4jk5');
    expect(inviteCodeIn('madatrips://join/ab2cd3ef-gh4jk5')).toBe('ab2cd3ef-gh4jk5');
    expect(inviteCodeIn('Join me on Mada Trips: https://madatrips.sa/join/ab2cd3ef-gh4jk5 see you')).toBe('ab2cd3ef-gh4jk5');
    expect(inviteCodeIn('  ab2cd3ef-gh4jk5 ')).toBe('ab2cd3ef-gh4jk5');
    expect(inviteCodeIn('hello')).toBeNull();
    expect(inviteCodeIn('ab2cd3ef-gh4jk5x')).toBeNull();
    expect(inviteCodeIn('https://evil.example/join/ab2cd3ef-gh4jk')).toBeNull();
    expect(inviteCodeIn(null)).toBeNull();
  });
});

describe('the install referrer (Android)', () => {
  it('reads invite=<code> from the Play Store referrer', async () => {
    vi.resetModules();
    vi.doMock('react-native', async () => { const rn = await import('./stubs/react-native'); return { ...rn, Platform: { ...rn.Platform, OS: 'android' } }; });
    vi.doMock('expo-application', () => ({ getInstallReferrerAsync: async () => 'utm_source=madatrips&invite%3Dab2cd3ef-gh4jk5' }));
    const { codeFromReferrer } = await import('@/lib/invite-pickup');
    expect(await codeFromReferrer()).toBe('ab2cd3ef-gh4jk5');
    vi.doMock('expo-application', () => ({ getInstallReferrerAsync: async () => 'utm_source=google-play&utm_medium=organic' }));
    vi.resetModules();
    const again = await import('@/lib/invite-pickup');
    expect(await again.codeFromReferrer()).toBeNull();
  });
});
