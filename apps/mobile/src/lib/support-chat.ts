import { create } from 'zustand';
import { SendSupportMessageResponse, walletPath, type SendSupportMessageRequest, type SupportMessage, type SupportThreadResponse } from '@mada/shared';
import { enqueue, registerOutboxKind, type OutboxItem } from './net/outbox';
import { queryClient } from './queries';
import { walletKeys } from './wallet';

/*
 * Sending to Mada goes through the outbox (lib/net/outbox.ts): written offline, it waits on the phone and goes in
 * order once there's a connection, each with its own key and clientId so it's never doubled. Instant answers from
 * Mada are shown after a short "typing" beat, like the prototype, instead of all at once.
 */

export const SUPPORT_KIND = 'support-message';
const TYPING_MS = 1300;

type Chat = { typing: Record<string, boolean>; setTyping: (threadId: string, on: boolean) => void };
export const useChat = create<Chat>((set) => ({ typing: {}, setTyping: (id, on) => set((s) => ({ typing: { ...s.typing, [id]: on } })) }));

/** Put messages into the cached thread, newest last, no duplicates. */
export function addToThread(key: string, messages: SupportMessage[]) {
  queryClient.setQueryData<SupportThreadResponse>(walletKeys.thread(key), (old) => {
    if (!old) return old;
    const seen = new Set(old.messages.map((m) => m.id));
    // An earlier optimistic copy of the same message (same clientId) is replaced.
    const ids = new Set(messages.map((m) => m.clientId).filter(Boolean));
    const kept = old.messages.filter((m) => !(m.clientId && ids.has(m.clientId) && !seen.has(m.id) && m.id.startsWith('local-')));
    return { ...old, messages: [...kept, ...messages.filter((m) => !seen.has(m.id))] };
  });
}

/** Their message at once; Mada's answer after the typing beat. */
export function deliver(key: string, threadId: string, messages: SupportMessage[]) {
  const mine = messages.filter((m) => m.author.kind === 'user');
  const theirs = messages.filter((m) => m.author.kind !== 'user');
  addToThread(key, mine);
  if (!theirs.length) return;
  useChat.getState().setTyping(threadId, true);
  setTimeout(() => {
    useChat.getState().setTyping(threadId, false);
    addToThread(key, theirs);
  }, TYPING_MS);
}

registerOutboxKind(SUPPORT_KIND, {
  onSent: (result, item: OutboxItem) => {
    const parsed = SendSupportMessageResponse.safeParse(result);
    if (parsed.success && item.meta?.threadId) deliver(item.meta.key ?? item.meta.threadId, item.meta.threadId, parsed.data.messages);
  },
});

let n = 0;
export const newClientId = () => `c${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Queue a message (sent at once when online). `key` is the cache key the screen reads the thread from. */
export function sendToMada(key: string, threadId: string, req: SendSupportMessageRequest, label: string): OutboxItem {
  const clientId = req.clientId ?? newClientId();
  return enqueue({ kind: SUPPORT_KIND, label, method: 'POST', path: walletPath('supportMessages', { id: threadId }), body: { ...req, clientId }, meta: { threadId, key, clientId, text: req.body } });
}
