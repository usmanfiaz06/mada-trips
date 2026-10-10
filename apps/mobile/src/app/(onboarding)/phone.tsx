import { useRouter } from 'expo-router';
import { PhoneForm } from '@/components/auth/PhoneForm';
import { Screen, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { auth } from '@/lib/auth';
import { SHOW_DEMO_HINTS } from '@/lib/config';
import { t } from '@/lib/i18n';
import { useOnboarding } from '@/lib/onboarding';
import { colors } from '@/theme';

/** Continue with phone number: Supabase texts a 6-digit code (through our Saudi SMS sender), then the code screen. */
export default function Phone() {
  const router = useRouter();
  const { phone, set } = useOnboarding();
  return (
    <Screen>
      <TopBar onBack={() => router.back()} />
      <PhoneForm
        title={t('phone.title')} body={t('phone.body')} initial={phone}
        onSend={(p) => auth().sendPhoneCode(p)}
        onSent={(p) => { set({ phone: p, via: 'phone', social: null }); router.push('/otp'); }}
        hint={SHOW_DEMO_HINTS ? <T v="tiny" color={colors.ink3}>{t('phone.demo')}</T> : null}
      />
    </Screen>
  );
}
