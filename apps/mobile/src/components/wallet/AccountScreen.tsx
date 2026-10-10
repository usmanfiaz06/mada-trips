import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Act, Scroll, Screen, TopBar } from '../Layout';
import { T } from '../Text';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { useAccount, walletApi, walletKeys } from '@/lib/wallet';
import { useSession } from '@/lib/session';
import { fmtDate } from '@/lib/wallet-model';
import { colors } from '@/theme';
import { Button } from '../Button';
import { QueryState, SkeletonList } from '../states';
import type { ApiQueryResult } from '@/lib/net/hooks';
import { Notice } from './ui';

/** A pushed account screen: back on the start side, a title, the scrolling list, and an optional Act zone. */
/**
 * An Account page. Pass `query` (the screen's main read) and the page waits for it with a skeleton, says why when it
 * can't load, and marks the saved copy when offline (components/states QueryState).
 */
export function AccountScreen({ title, backLabel, children, act, testID, query }: { title?: string; backLabel?: string; children: ReactNode; act?: ReactNode; testID?: string; query?: ApiQueryResult<unknown> }) {
  const router = useRouter();
  const body = query ? <QueryState query={query} skeleton={<SkeletonList />} badge>{() => children}</QueryState> : children;
  return (
    <Screen>
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/profile'))} backLabel={backLabel} title={title} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1 }} testID={testID}>
          <Scroll top={8} bottomPad={act ? 160 : 60}>{body}</Scroll>
          {act && (!query || query.data !== undefined) ? <Act>{act}</Act> : null}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** "Scheduled for deletion on …" with a way back (Account.jsx DeletionBanner). */
export function DeletionBanner() {
  const qc = useQueryClient();
  const account = useAccount();
  const at = account.data?.deleteAt;
  if (!at) return null;
  return (
    <Notice icon="bell" warn title={t('privacy.banner.title', { date: fmtDate(at, true) })} body={t('privacy.banner.body')} testID="deletion-banner">
      <Button variant="secondary" size="small" block={false} label={t('privacy.banner.cancel')} style={{ alignSelf: 'flex-start', marginTop: 6 }} testID="deletion-cancel"
        onPress={async () => {
          try { await walletApi.cancelDeletion(); await qc.invalidateQueries({ queryKey: walletKeys.account }); buzz('success'); toast(t('privacy.banner.cancelled')); } catch { toast(t('error.internal')); }
        }} />
    </Notice>
  );
}

/** Words for the version line. */
export const VERSION = '1.0 (build 1)';

export function Footnote({ children }: { children: string }) {
  return <T v="tiny" style={{ paddingHorizontal: 4 }} color={colors.ink3}>{children}</T>;
}

export const useMeUser = () => useSession((s) => s.user);
