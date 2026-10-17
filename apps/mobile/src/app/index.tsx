import { useEffect, useState } from 'react';
import { Redirect, type Href } from 'expo-router';
import { takeRelaunch } from '@/lib/resume';
import { useSession } from '@/lib/session';

/** Launch: straight to Today when signed in or a guest, otherwise the welcome; after a language switch, back where it was. */
export default function Index() {
  const status = useSession((s) => s.status);
  const [relaunch, setRelaunch] = useState<string | null | undefined>(undefined);
  useEffect(() => { void takeRelaunch().then(setRelaunch).catch(() => setRelaunch(null)); }, []);
  if (relaunch === undefined) return null;
  const inApp = status === 'signedIn' || status === 'guest';
  if (inApp && relaunch) return <Redirect href={relaunch as Href} />;
  return <Redirect href={inApp ? '/today' : '/welcome'} />;
}
