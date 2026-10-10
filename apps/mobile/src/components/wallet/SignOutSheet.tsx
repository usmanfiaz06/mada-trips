import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { queryClient, usePeople } from '@/lib/queries';
import { deleteSecret } from '@/lib/storage';
import { walletApi } from '@/lib/wallet';
import { useWalletLock } from '@/lib/wallet-lock';
import { colors } from '@/theme';
import { Button } from '../Button';
import { Card } from '../Card';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { T } from '../Text';

/*
 * Sign out, two ways (Account.jsx SignOutSheet). Keep: trips stay on this phone and documents stay locked until the
 * next sign-in, which then says "Welcome back". Remove: nothing of this account is left on the phone.
 * "Everywhere" ends every session first, this phone included.
 */
export function SignOutSheet({ visible, onClose, everywhere }: { visible: boolean; onClose: () => void; everywhere?: boolean }) {
  const router = useRouter();
  const people = usePeople();
  const others = (people.data ?? []).filter((p) => !p.isSelf).length;
  const go = async (mode: 'keep' | 'remove') => {
    buzz('tap');
    onClose();
    if (everywhere) await walletApi.signOutEverywhere().catch(() => {});
    useWalletLock.getState().lock();
    await api.logout().catch(() => {});
    if (mode === 'remove') {
      queryClient.clear();
      await deleteSecret('mada.wallet.lockout.v1');
    }
    router.replace('/welcome');
  };
  return (
    <Sheet visible={visible} onClose={onClose} label={everywhere ? t('security.everywhere') : t('profile.signOut')}>
      <T v="h2" accessibilityRole="header">{everywhere ? t('signout.titleEverywhere') : t('signout.title')}</T>
      <T v="body" style={{ marginTop: -8 }}>{everywhere ? t('signout.bodyEverywhere') : t('signout.body')}</T>
      <Card variant="well" onPress={() => go('keep')} accessibilityLabel={t('signout.keep')} style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} testID="signout-keep">
          <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' }}><Icon name="lock" size={18} /></View>
          <T v="h3" style={{ fontSize: 15 }}>{t('signout.keep')}</T>
        </View>
        <T v="small" style={{ paddingStart: 46 }}>{others ? tn('signout.keepBodyFamily', others) : t('signout.keepBody')}</T>
      </Card>
      <Card variant="well" onPress={() => go('remove')} accessibilityLabel={t('signout.remove')} style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} testID="signout-remove">
          <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={18} color={colors.badInk} /></View>
          <T v="h3" style={{ fontSize: 15 }} color={colors.badInk}>{t('signout.remove')}</T>
        </View>
        <T v="small" style={{ paddingStart: 46 }}>{t('signout.removeBody')}</T>
      </Card>
      <Button variant="ghost" label={t('common.cancel')} onPress={onClose} />
    </Sheet>
  );
}
