import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Layout';
import { Sun } from '@/components/Sun';
import { T } from '@/components/Text';
import { sayAuthError } from '@/components/auth/say';
import { auth, finishSignIn, syncIdentity } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/*
 * The web build signs in with Apple and Google by redirect (Supabase OAuth). The browser comes back here with a
 * code that supabase-js exchanges for a session; we then swap it for a Core API session, or (?link=1, from Sign-in
 * methods) copy the new provider onto the signed-in account. Native builds never land here.
 */
export default function AuthCallback() {
  const router = useRouter();
  const { link, via } = useLocalSearchParams<{ link?: string; via?: string }>();
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let id = await auth().sessionFromRedirect();
        for (let i = 0; !id && i < 10; i += 1) { await new Promise((r) => setTimeout(r, 300)); id = await auth().sessionFromRedirect(); }
        if (!alive) return;
        if (!id) { setProblem(t('auth.signin.cancelled')); return; }
        if (link && useSession.getState().status === 'signedIn') {
          await syncIdentity(id.accessToken);
          router.replace('/account/signin');
          return;
        }
        router.replace(await finishSignIn(id, via === 'apple' ? 'apple' : 'google'));
      } catch (e) {
        if (alive) setProblem(sayAuthError(e));
      }
    })();
    return () => { alive = false; };
  }, [link, via, router]);

  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingHorizontal: 24 }}>
        <Sun width={56} />
        <T v="body" style={{ textAlign: 'center' }}>{problem ?? t('auth.signin.busy')}</T>
        {problem ? <Button variant="secondary" block={false} label={t('common.back')} onPress={() => router.replace('/signin')} /> : null}
      </View>
    </Screen>
  );
}
