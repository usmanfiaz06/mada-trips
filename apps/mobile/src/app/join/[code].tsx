import { Linking, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Faces } from '@/components/circles/ui';
import { VGradient } from '@/components/Gradient';
import { ErrorState, GoneState } from '@/components/states';
import { Icon } from '@/components/Icon';
import { Screen, useBottomInset } from '@/components/Layout';
import { T } from '@/components/Text';
import { ApiError } from '@/lib/api';
import { COVERS, circlesApi, ck, useAct, usePreview } from '@/lib/circles';
import { holdJoin } from '@/lib/circles-join';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { colors, ff, font } from '@/theme';

/**
 * An invite link, opened (madatrips.sa/join/<code>). The preview first, signed in or not (FLOWS.md §1). Signed in:
 * join. New to Mada: sign up, then land in the circle. Expired or cancelled: say so, and how to get a new one.
 */
export default function Join() {
  const router = useRouter();
  const { code = '' } = useLocalSearchParams<{ code: string }>();
  const signedIn = useSession((s) => s.status === 'signedIn');
  const bottom = useBottomInset();
  const q = usePreview(code);
  const accept = useAct(() => circlesApi.accept(code), () => [ck.all]);
  const leave = () => (router.canGoBack() ? router.back() : router.replace(signedIn ? '/circles' : '/welcome'));
  const p = q.data;

  if (q.isLoading) return <Screen dark background={colors.night}><View /></Screen>;
  if (!p && q.isError && (q.error as ApiError)?.status === 404) return <Screen><GoneState /></Screen>;
  if (!p && q.isError) return <Screen><ErrorState problem={q.problem} onRetry={q.retry} /></Screen>;
  if (!p || p.status !== 'open') {
    const from = p?.from.short ?? t('circles.someone');
    const cancelled = p?.status === 'cancelled';
    return (
      <Screen>
        <View style={{ paddingTop: 120, paddingHorizontal: 28, gap: 16, flex: 1 }}>
          <Icon name="link" size={36} />
          <T v="h1" accessibilityRole="header">{!p ? t('circles.join.notFound') : cancelled ? t('circles.join.cancelledTitle') : t('circles.join.expiredTitle')}</T>
          {p ? <T v="body">{cancelled ? t('circles.join.cancelledBody', { name: from }) : t('circles.join.expiredBody', { name: from })}</T> : null}
        </View>
        <View style={{ paddingHorizontal: 20, paddingBottom: 28 + bottom, gap: 10 }}>
          {p ? <Button label={t('circles.join.askOnWhatsApp', { name: from })} onPress={() => Linking.openURL('https://wa.me/')} /> : null}
          <Button variant="ghost" label={signedIn ? t('circles.join.backToMada') : t('circles.join.lookAround')} onPress={leave} testID="join-back" />
        </View>
      </Screen>
    );
  }

  const join = async () => {
    if (!signedIn) { await holdJoin(code); router.replace('/welcome'); return; }
    accept.mutate(undefined, {
      onSuccess: (r) => {
        buzz('success');
        if (r.circleId) { toast(r.already ? t('circles.join.already', { name: p.circle?.name ?? '' }) : t('circles.join.joined', { name: p.from.short })); router.replace(`/circle/${r.circleId}`); }
        else if (r.friendId) { toast(t('circles.people.friendsNow', { name: p.from.short })); router.replace(`/friend/${r.friendId}`); }
      },
      onError: (e) => toast(e instanceof ApiError ? e.message : t('error.internal')),
    });
  };
  const members = p.circle?.members ?? [p.from];
  const names = members.map((m) => m.short);
  const areIn = names.length === 1 ? t('circles.join.isIn', { names: names[0]! }) : t('circles.join.areIn', { names: `${names.slice(0, -1).join(', ')} ${t('circles.and')} ${names[names.length - 1]}` });

  return (
    <Screen background={colors.night}>
      {p.circle?.cover ? <Image source={COVERS[p.circle.cover]} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      <VGradient id="join-veil" stops={[[0, 'rgba(15,26,22,0.55)'], [0.24, 'rgba(15,26,22,0.05)'], [0.42, 'rgba(15,26,22,0.2)'], [0.66, 'rgba(15,26,22,0.92)'], [1, '#0f1a16']]} />
      <View style={{ marginTop: 'auto', paddingHorizontal: 24, paddingBottom: 24 + bottom, gap: 12 }}>
        <Faces people={members} size={40} ring={colors.night} />
        <T v="eyebrow" color={colors.gold}>{t('circles.join.invitedYou', { name: p.from.short })}</T>
        <T style={[font('displayXL', colors.paper), { fontSize: 46, lineHeight: 46 }]} accessibilityRole="header" balance={false}>{p.circle ? p.circle.name : t('circles.join.madaTitle', { name: p.from.short })}</T>
        <T v="small" color="rgba(255,253,249,0.85)">{p.circle ? [p.circle.trip, areIn].filter(Boolean).join(' · ') : t('circles.join.madaBody')}</T>
        <View style={st.panel}>
          <T v="small" style={{ fontFamily: ff.ui600 }} color={colors.paper}>{t('circles.join.theySee')}</T>
          <T v="small" color="rgba(255,253,249,0.8)">{t('circles.join.theySeeBody')}</T>
        </View>
        <Button variant="gold" busy={accept.isPending} label={signedIn ? (p.circle ? t('circles.join.join') : t('circles.join.addFriend', { name: p.from.short })) : t('circles.join.joinWithMada')} onPress={join} testID="join-go" />
        <Button variant="onDark" label={t('common.notNow')} onPress={leave} />
        {!signedIn ? <T v="tiny" color="rgba(255,253,249,0.6)" style={{ textAlign: 'center' }}>{t('circles.join.takesAMinute')}</T> : null}
      </View>
    </Screen>
  );
}

const st = StyleSheet.create({ panel: { backgroundColor: 'rgba(255,253,249,0.08)', borderRadius: 24, padding: 16, gap: 6, borderWidth: 1, borderColor: 'rgba(255,253,249,0.12)' } });
