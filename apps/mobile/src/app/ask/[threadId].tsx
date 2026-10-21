import { useLocalSearchParams, useRouter } from 'expo-router';
import { AskScreen } from '@/components/ask/AskScreen';

/*
 * One Ask chat (docs/app/ASK-INTEGRATED.md §2): /ask/{id} opens it from the server (the phone's copy paints first),
 * /ask/new starts one (?prefill= sends the words from the list's composer; ?tripId= makes it about that trip). Back goes
 * to the chats list. ?find= (a search in the list) opens it at the line that has the words.
 */
export default function AskThread() {
  const router = useRouter();
  const p = useLocalSearchParams<{ threadId: string; tripId?: string; from?: string; find?: string }>();
  const back = () => (p.from === 'list' && router.canGoBack() ? router.back() : router.replace({ pathname: '/ask', params: { list: '1' } }));
  return <AskScreen key={p.threadId} thread={p.threadId || 'new'} tripId={p.tripId ?? null} find={p.find ?? null} onBack={back} />;
}
