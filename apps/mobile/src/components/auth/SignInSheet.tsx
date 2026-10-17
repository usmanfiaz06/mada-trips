import { View } from 'react-native';
import { router, type Href } from 'expo-router';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useOnboarding } from '@/lib/onboarding';
import { setReturnTo } from '@/lib/resume';
import { useSignInAsk, type AccountReason } from '@/lib/signin-ask';
import { colors } from '@/theme';
import { Button } from '../Button';
import { MadaDot } from '../booking/parts';
import { Sheet } from '../Sheet';
import { T } from '../Text';

const TITLE: Record<AccountReason, 'signin.ask.book' | 'signin.ask.save' | 'signin.ask.chat' | 'signin.ask.circles' | 'signin.ask.wallet' | 'signin.ask.trips'> = {
  book: 'signin.ask.book', save: 'signin.ask.save', chat: 'signin.ask.chat', circles: 'signin.ask.circles', wallet: 'signin.ask.wallet', trips: 'signin.ask.trips',
};

/**
 * "Sign in to book this": over whatever screen asked (lib/signin-ask.ts). Sign in opens the usual sign-in on top;
 * the screen underneath stays as it is, and the end of sign-in comes back to it (lib/resume.ts takeReturnTo).
 */
export function SignInSheet() {
  const reason = useSignInAsk((s) => s.reason);
  const returnTo = useSignInAsk((s) => s.returnTo);
  const close = useSignInAsk((s) => s.close);
  if (!reason) return null;
  return (
    <Sheet visible label={t(TITLE[reason])} onClose={close}>
      <View style={{ gap: 14 }} testID="signin-sheet">
        <MadaDot size={36} />
        <T v="h2" accessibilityRole="header">{t(TITLE[reason])}</T>
        <T v="body" color={colors.ink2}>{t(reason === 'book' ? 'signin.ask.bodyBook' : 'signin.ask.body')}</T>
        <Button label={t('signin.ask.go')} testID="signin-sheet-go" onPress={() => {
          buzz('tap');
          if (returnTo) setReturnTo(returnTo);
          useOnboarding.getState().reset();
          close();
          router.push('/signin' as Href);
        }} />
        <Button variant="ghost" label={t('signin.ask.later')} onPress={close} testID="signin-sheet-later" />
      </View>
    </Sheet>
  );
}
