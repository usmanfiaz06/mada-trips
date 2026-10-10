import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTransport, type Wire, type WireResponse } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useGates } from '@/lib/net/gates';
import { resetNet, simulateOffline } from '@/lib/net/state';
import { kvRead, kvWrite } from '@/lib/net/kv';

vi.mock('@/lib/queries', () => ({ queryClient: { invalidateQueries: vi.fn(async () => {}) } }));
const { discardItem, enqueue, flushOutbox, loadOutbox, registerOutboxKind, resetOutbox, retryItem, useOutboxStore } = await import('@/lib/net/outbox');

/* The outbox: order, dedupe by key and by Idempotency-Key, per-item states, persistence across restarts. */

let sent: Wire[] = [];
let answer: (w: Wire) => WireResponse | Promise<WireResponse> = () => ({ status: 201, json: { ok: true } });
const items = () => useOutboxStore.getState().items;

beforeEach(async () => {
  sent = [];
  answer = () => ({ status: 201, json: { ok: true } });
  resetOutbox();
  resetNet({ connected: true });
  useGates.setState({ expired: false });
  await useSession.getState().signIn({ accessToken: 'a.b.c', accessExpiresAt: '2099-01-01T00:00:00Z', refreshToken: 'r', refreshExpiresAt: '2099-01-01T00:00:00Z' }, { id: 'u1' } as never);
  setTransport(async (w) => { sent.push(w); return answer(w); });
});

const msg = (text: string, extra: Partial<Parameters<typeof enqueue>[0]> = {}) => ({ kind: 'message', label: text, method: 'POST' as const, path: '/support/messages', body: { text }, ...extra });

describe('the outbox', () => {
  it('keeps what was written offline and sends it in order once back', async () => {
    simulateOffline(true);
    enqueue(msg('one'));
    enqueue(msg('two'));
    enqueue(msg('three'));
    await flushOutbox();
    expect(sent).toHaveLength(0);
    expect(items().map((i) => i.state)).toEqual(['queued', 'queued', 'queued']);
    simulateOffline(false);
    expect(await flushOutbox()).toBe(3);
    expect(sent.map((w) => (w.body as { text: string }).text)).toEqual(['one', 'two', 'three']);
    expect(items()).toHaveLength(0);
  });

  it('sends each item with its own Idempotency-Key, the same key on every try', async () => {
    let fails = 1;
    answer = () => (fails-- > 0 ? { status: 503, json: { error: { code: 'INTERNAL', message: 'x' } } } : { status: 201, json: { ok: true } });
    const item = enqueue(msg('hello'));
    await flushOutbox();
    expect(items()[0]).toMatchObject({ state: 'queued', tries: 1 });
    useOutboxStore.setState((s) => ({ items: s.items.map((i) => ({ ...i, nextAt: 0 })) }));
    await flushOutbox();
    expect(items()).toHaveLength(0);
    const keys = sent.map((w) => w.headers?.['Idempotency-Key']);
    expect(keys).toEqual([item.key, item.key]);
  });

  it('a transient problem stops the run so nothing overtakes; a lasting refusal is marked and the run goes on', async () => {
    answer = (w) => ((w.body as { text: string }).text === 'bad' ? { status: 400, json: { error: { code: 'VALIDATION', message: 'A detail needs another look.' } } } : { status: 201, json: { ok: true } });
    simulateOffline(true);
    enqueue(msg('bad'));
    enqueue(msg('good'));
    simulateOffline(false);
    await flushOutbox();
    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({ label: 'bad', state: 'failed', problem: 'A detail needs another look.' });
    expect(sent.map((w) => (w.body as { text: string }).text)).toEqual(['bad', 'good']);

    answer = () => ({ status: 502, json: { error: { code: 'INTERNAL', message: 'x' } } });
    sent = [];
    simulateOffline(true);
    enqueue(msg('first'));
    enqueue(msg('second'));
    simulateOffline(false);
    await flushOutbox();
    expect(sent.map((w) => (w.body as { text: string }).text)).toEqual(['first']);
    expect(items().filter((i) => i.state === 'queued').map((i) => i.label)).toEqual(['first', 'second']);
  });

  it('dedupes by key: the latest choice replaces a queued one, in its place, with a new Idempotency-Key', () => {
    simulateOffline(true);
    const a = enqueue({ kind: 'disruption', label: 'Take the 21:15', method: 'POST', path: '/trips/t1/disruption', body: { option: 'a' }, dedupe: 'disruption:t1' });
    enqueue(msg('note'));
    const b = enqueue({ kind: 'disruption', label: 'Take the 07:30', method: 'POST', path: '/trips/t1/disruption', body: { option: 'b' }, dedupe: 'disruption:t1' });
    expect(items()).toHaveLength(2);
    expect(items()[0]).toMatchObject({ id: a.id, label: 'Take the 07:30', body: { option: 'b' } });
    expect(b.key).not.toBe(a.key);
  });

  it('Send again and Remove', async () => {
    answer = () => ({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'no' } } });
    const i = enqueue(msg('x'));
    await flushOutbox();
    expect(items()[0]!.state).toBe('failed');
    answer = () => ({ status: 201, json: { ok: true } });
    retryItem(i.id);
    await flushOutbox();
    expect(items()).toHaveLength(0);
    answer = () => ({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'no' } } });
    const j = enqueue(msg('y'));
    await flushOutbox();
    discardItem(j.id);
    expect(items()).toHaveLength(0);
  });

  it('tells the area once sent', async () => {
    const onSent = vi.fn();
    registerOutboxKind('message', { onSent });
    answer = () => ({ status: 201, json: { message: { id: 'm1' } } });
    enqueue(msg('hi'));
    await flushOutbox();
    expect(onSent).toHaveBeenCalledWith({ message: { id: 'm1' } }, expect.objectContaining({ label: 'hi' }));
  });

  it('survives a restart: what was mid-send goes back in line with the same key', async () => {
    const saved = [{ id: 'ob1', key: 'o-keep-me-123', kind: 'message', label: 'kept', method: 'POST', path: '/support/messages', body: { text: 'kept' }, createdAt: 1, state: 'sending', tries: 0, nextAt: 0 }];
    await kvWrite('mada.outbox.v1', JSON.stringify(saved));
    useOutboxStore.setState({ items: [], loaded: false });
    await loadOutbox();
    expect(items()[0]).toMatchObject({ id: 'ob1', state: 'queued' });
    await flushOutbox();
    expect(sent[0]?.headers?.['Idempotency-Key']).toBe('o-keep-me-123');
    expect(JSON.parse((await kvRead('mada.outbox.v1')) ?? '[]')).toEqual([]);
  });
});
