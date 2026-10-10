import { useRouter } from 'expo-router';
import { prettyPhone } from '@mada/shared';
import { LinkButton } from '@/components/Button';
import { CodeEntry } from '@/components/auth/CodeEntry';
import { Screen, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { auth, finishSignIn } from '@/lib/auth';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useOnboarding } from '@/lib/onboarding';

/** The SMS code. Right: signed in (new → name, known → Welcome back). Wrong: says so and clears (FLOWS.md §1). */
export default function Otp() {
  const router = useRouter();
  const phone = useOnboarding((s) => s.phone);
  return (
    <Screen>
      <TopBar onBack={() => router.back()} />
      <CodeEntry
        title={t('otp.title')} about="phone" demoHint={t('otp.demo')}
        sent={<><T v="body">{phone ? t('otp.sentTo', { phone: prettyPhone(phone) }) : t('otp.sentToFallback')}</T><LinkButton label={t('otp.change')} onPress={() => router.back()} /></>}
        onVerify={async (code) => {
          const id = await auth().verifyPhoneCode(phone, code);
          const next = await finishSignIn(id, 'phone');
          buzz('success');
          router.replace(next);
        }}
        onResend={() => auth().sendPhoneCode(phone)}
      />
    </Screen>
  );
}
