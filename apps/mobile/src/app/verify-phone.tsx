import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { prettyPhone } from '@mada/shared';
import { LinkButton } from '@/components/Button';
import { CodeEntry } from '@/components/auth/CodeEntry';
import { PhoneForm } from '@/components/auth/PhoneForm';
import { Screen, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { AuthError, auth, syncIdentity } from '@/lib/auth';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useOnboarding } from '@/lib/onboarding';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';

/*
 * Verify your phone. Accounts that began with Apple, Google or email need a reachable mobile before their first
 * booking (Saudi travel, gate changes, Faisal's messages). The number is added to the Supabase identity (a code to
 * the new number), then copied onto the Mada account (POST /auth/session/sync).
 *   ?then=onboarding  right after sign-in: "Later" is allowed, and both go on to name or Welcome back
 *   ?then=back        from Profile, Sign-in methods or the pay sheet: back to where it was opened
 */
export default function VerifyPhone() {
  const router = useRouter();
  const { then = 'back' } = useLocalSearchParams<{ then?: 'onboarding' | 'back' }>();
  const { via, afterPhone } = useOnboarding();
  const user = useSession((s) => s.user);
  const [step, setStep] = useState<'number' | 'code'>('number');
  const [phone, setPhone] = useState('');

  const onboarding = then === 'onboarding';
  const leave = () => (onboarding ? router.replace(afterPhone) : router.back());
  const provider = via === 'apple' ? t('auth.provider.apple') : via === 'google' ? t('auth.provider.google') : via === 'email' ? t('auth.provider.email') : null;

  if (step === 'code') {
    return (
      <Screen>
        <TopBar onBack={() => setStep('number')} />
        <CodeEntry
          title={t('otp.title')} about="phone" demoHint={t('otp.demo')}
          sent={<><T v="body">{t('otp.sentTo', { phone: prettyPhone(phone) })}</T><LinkButton label={t('otp.change')} onPress={() => setStep('number')} /></>}
          onVerify={async (code) => {
            const token = await auth().verifyAddedPhone(phone, code);
            await syncIdentity(token);
            buzz('success');
            toast(t('auth.verifyPhone.done'));
            leave();
          }}
          onResend={() => auth().addPhone(phone)}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar
        onBack={() => router.back()}
        right={onboarding ? <View style={{ paddingHorizontal: 4 }}><LinkButton label={t('auth.verifyPhone.later')} size={15} onPress={leave} /></View> : undefined}
      />
      <PhoneForm
        title={t('auth.verifyPhone.title')}
        body={provider && onboarding ? t('auth.verifyPhone.body', { provider }) : t('auth.verifyPhone.bodyPlain')}
        initial={user?.phone ?? ''}
        onSend={async (p) => {
          if (!(await auth().hasSession())) throw new AuthError('noSession');
          await auth().addPhone(p);
        }}
        onSent={(p) => { setPhone(p); setStep('code'); }}
      />
    </Screen>
  );
}
