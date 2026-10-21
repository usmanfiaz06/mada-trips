import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AskScreen } from '@/components/ask/AskScreen';
import { ChatList, threadsKey } from '@/components/ask/ChatList';
import { Screen } from '@/components/Layout';
import { askThreadsApi, lastAskThread, useAskChatOn } from '@/lib/ask-chat';
import { useNet } from '@/lib/net';

/*
 * Ask (the orb, Today's shortcuts, /ask from anywhere), docs/app/ASK-INTEGRATED.md §2.1 and owner decision 1:
 *  - the conversation off (guests, flows only, offline): Ask's own flows, exactly as before;
 *  - ?prefill= / ?intent=: a new chat that sends it; ?resume=: back to the search in hand;
 *  - ?tripId= (the trip page): that trip's own chat, or a new one about it;
 *  - from the orb, when the last chat was under 24 h ago: straight into it (back goes to the list);
 *  - otherwise the chats list, or a new chat when there are none yet (never an empty list).
 */
export default function AskHome() {
  const router = useRouter();
  const p = useLocalSearchParams<{ prefill?: string; intent?: string; resume?: string; tripId?: string; from?: string; list?: string }>();
  const on = useAskChatOn();
  const online = useNet((s) => s.online) !== false;
  const chatOn = on && online;
  const toList = () => router.replace({ pathname: '/ask', params: { list: '1' } });
  if (!chatOn) return <AskScreen thread="last" />;
  if (p.resume) return <AskScreen thread="last" onBack={toList} />;
  if (p.prefill || p.intent) return <AskScreen thread="new" tripId={p.tripId ?? null} onBack={toList} />;
  return <Home tripId={p.tripId ?? null} orb={p.from === 'orb' && !p.list} />;
}

function Home({ tripId, orb }: { tripId: string | null; orb: boolean }) {
  const router = useRouter();
  // Where Ask opens is decided first (the trip's chat, the last chat), then the list.
  const [decided, setDecided] = useState(!tripId && !orb);
  useEffect(() => {
    let live = true;
    void (async () => {
      if (tripId) {
        const own = await askThreadsApi.list({ tripId }).then((r) => r.threads[0]?.id ?? null).catch(() => null);
        if (live) router.replace({ pathname: '/ask/[threadId]', params: { threadId: own ?? 'new', tripId } });
        return;
      }
      if (orb) {
        const last = await lastAskThread();
        if (last && live) { router.replace({ pathname: '/ask/[threadId]', params: { threadId: last } }); return; }
      }
      if (live) setDecided(true);
    })();
    return () => { live = false; };
  }, [tripId, orb]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = useQuery({ queryKey: threadsKey('', 'all'), queryFn: () => askThreadsApi.list(), enabled: decided });
  const back = () => (router.canGoBack() ? router.back() : router.replace('/today'));
  if (!decided) return <Screen><View /></Screen>;
  // Nobody to list yet: straight into a new chat with the usual suggestions.
  if (first.data && !first.data.threads.length && !first.data.archivedCount) return <AskScreen thread="new" />;
  return <ChatList onBack={back} />;
}
