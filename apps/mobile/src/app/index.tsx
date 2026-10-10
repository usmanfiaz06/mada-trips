import { Redirect } from 'expo-router';
import { useSession } from '@/lib/session';

/** Launch: straight to Today when signed in or a guest, otherwise the welcome. */
export default function Index() {
  const status = useSession((s) => s.status);
  return <Redirect href={status === 'signedIn' || status === 'guest' ? '/today' : '/welcome'} />;
}
