import { useRouter } from 'expo-router';
import { LinkButton } from '@/components/Button';
import { CodeEntry } from '@/components/auth/CodeEntry';
import { Screen, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { auth, finishSignIn } from '@/lib/auth';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useOnboarding } from '@/lib/onboarding';

/** The email code. A new account goes on to Verify your phone, then name and alerts. */
export default function EmailCode() {
  const router = useRouter();
  const email = useOnboarding((s) => s.email);
  return (
    <Screen>
      <TopBar onBack={() => router.back()} />
      <CodeEntry
        title={t('auth.email.codeTitle')} about="email" demoHint={t('auth.email.demo')} testID="email-code-input"
        sent={<><T v="body">{t('auth.email.sentTo', { email })}</T><LinkButton label={t('auth.email.change')} onPress={() => router.back()} /></>}
        onVerify={async (code) => {
          const id = await auth().verifyEmailCode(email, code);
          const next = await finishSignIn(id, 'email');
          buzz('success');
          router.replace(next);
        }}
        onResend={() => auth().sendEmailCode(email)}
      />
    </Screen>
  );
}
