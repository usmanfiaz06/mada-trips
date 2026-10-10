import { AppleMark } from '@/components/BrandMarks';
import { Button } from '@/components/Button';
import { t } from '@/lib/i18n';

/** Web and Android builds (mock and review only: Apple is offered on iOS). AppleButton.ios.tsx is the system button. */
export function AppleButton({ onPress, busy }: { onPress: () => void; busy?: boolean }) {
  return <Button label={t('signin.apple')} icon={<AppleMark size={20} />} onPress={onPress} busy={busy} testID="signin-apple" />;
}
