import { useCallback } from 'react';
import { create } from 'zustand';
import { SendSupportMessageResponse, walletPath, type SendSupportMessageRequest, type SupportMessage, type SupportThreadResponse } from '@mada/shared';
import { request } from './api';
import { useApiMutation } from './net/hooks';
import { enqueue, registerOutboxKind, type EnqueueInput, type OutboxItem } from './net/outbox';
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

type Send = { key: string; threadId: string; req: SendSupportMessageRequest & { clientId: string }; label: string };

const outboxInput = ({ key, threadId, req, label }: Send): EnqueueInput => ({
  kind: SUPPORT_KIND, label, method: 'POST', path: walletPath('supportMessages', { id: threadId }), body: req,
  meta: { threadId, key, clientId: req.clientId, text: req.body },
});

/** Put a message straight in the outbox: it shows under the thread as waiting, sending or "Not sent". */
export function sendToMada(key: string, threadId: string, req: SendSupportMessageRequest, label: string): OutboxItem {
  return enqueue(outboxInput({ key, threadId, req: { ...req, clientId: req.clientId ?? newClientId() }, label }));
}

/**
 * Talk to Mada: sent at once when online (useApiMutation, with a key so a retry is done once), queued in the outbox
 * when there's no connection (queueWhenOffline). A message typed while the previous one is still going goes through
 * the outbox too, so a quick second message is never dropped; one that fails is kept there with Send again.
 */
export function useSendToMada(key: string, threadId: string | undefined, label: string) {
  const m = useApiMutation<{ messages: SupportMessage[] }, Send>({
    quiet: true,
    mutationFn: (v, { idempotencyKey }) => request({ method: 'POST', path: walletPath('supportMessages', { id: v.threadId }), body: v.req, idempotencyKey }, SendSupportMessageResponse),
    queueWhenOffline: outboxInput,
    onSuccess: (r, v) => { if (r) deliver(v.key, v.threadId, r.messages); },
    onError: (e, v) => { if (v) enqueue(outboxInput(v)); },
  });
  const send = useCallback((req: SendSupportMessageRequest) => {
    if (!threadId) return;
    const v: Send = { key, threadId, req: { ...req, clientId: req.clientId ?? newClientId() }, label };
    if (m.isPending) enqueue(outboxInput(v));
    else m.mutate(v);
  }, [key, threadId, label, m]);
  /** What's on its way right now (shown as a "Sending…" bubble until it lands). */
  const sending = m.isPending ? m.variables : undefined;
  return { send, sending };
}
