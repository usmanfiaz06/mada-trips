import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { fullDay, type AskShare } from '@mada/shared';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/Button';
import { Screen, TopBar, useBottomInset } from '@/components/Layout';
import { Notice } from '@/components/booking/parts';
import { T } from '@/components/Text';
import { askDocsApi } from '@/lib/ask-docs';
import { ApiError } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors, font } from '@/theme';

/*
 * "Share your passport for this trip?" (docs/app/ASK-INTEGRATED.md §5.4): opened from the notification a trip owner's
 * request sends. One tap shares it for this trip only (the owner sees the last two characters and the expiry, never the
 * number), until the trip ends + 7 days; the other declines. Without a passport on file, add it first.
 */
export default function ShareScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const bottom = useBottomInset();
  const q = useQuery({ queryKey: ['ask', 'share', id], queryFn: async () => (await askDocsApi.share(String(id))).share, retry: 0 });
  const [busy, setBusy] = useState<'share' | 'decline' | null>(null);
  const [share, setShare] = useState<AskShare | null>(null);
  const [noPassport, setNoPassport] = useState(false);
  const s = share ?? q.data ?? null;
  const locale = getLocale();
  const until = s?.until ? fullDay(s.until.slice(0, 10), locale) : '';
  const answer = async (action: 'share' | 'decline') => {
    setBusy(action);
    try { setShare((await askDocsApi.answerShare(String(id), action)).share); buzz(action === 'share' ? 'success' : 'tap'); }
    catch (e) { if (e instanceof ApiError && e.status === 400) setNoPassport(true); else toast(t('doc.attach.notSent')); }
    finally { setBusy(null); }
  };
  return (
    <Screen>
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/today'))} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 + bottom }}>
        <T style={font('display')} accessibilityRole="header">{t('share.screen.title')}</T>
        {q.isError && !s ? <Notice icon="doc"><T v="small">{t('share.status.expired')}</T></Notice> : null}
        {s ? <T v="body" color={colors.ink2} testID="share-body">{t('share.screen.body', { name: s.name, trip: s.trip ?? t('share.tripFallback'), until })}</T> : null}
        {s?.status === 'shared' ? <Notice icon="check"><T v="small" testID="share-done">{t('share.screen.done', { until })}</T></Notice> : null}
        {s?.status === 'declined' ? <Notice icon="doc"><T v="small">{t('share.screen.declined', { name: s.name })}</T></Notice> : null}
        {s?.status === 'expired' ? <Notice icon="doc"><T v="small">{t('share.status.expired')}</T></Notice> : null}
        {noPassport ? (
          <View style={{ gap: 10 }}>
            <Notice icon="doc"><T v="small">{t('share.screen.noPassport')}</T></Notice>
            <Button label={t('share.screen.addPassport')} onPress={() => router.push('/passport')} testID="share-add-passport" />
          </View>
        ) : null}
        {s?.status === 'sent' && !noPassport ? (
          <View style={{ gap: 10 }}>
            <Button label={t('share.screen.share')} busy={busy === 'share'} disabled={!!busy} onPress={() => { void answer('share'); }} testID="share-yes" />
            <Button variant="secondary" label={t('share.screen.decline')} busy={busy === 'decline'} disabled={!!busy} onPress={() => { void answer('decline'); }} testID="share-no" />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
