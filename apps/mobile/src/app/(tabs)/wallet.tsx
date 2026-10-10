import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';
import { fontFamilies } from '@mada/shared';
import { ArtCardSlot, ArtPass } from '@/components/art/Arts';
import { Button, LinkButton } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { VGradient } from '@/components/Gradient';
import { Icon } from '@/components/Icon';
import { Scroll, Screen, useTopInset } from '@/components/Layout';
import { Sun } from '@/components/Sun';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { rise } from '@/lib/motion';
import { toast } from '@/lib/toast';
import { colors, font, shadow } from '@/theme';

/** The Wallet before anything is in it: your passport card waiting, other documents, passes (prototype Wallet). */
export default function Wallet() {
  const router = useRouter();
  const top = useTopInset();
  // Passport scanning arrives in M1 (on-device MRZ). Until then the button says what will happen, honestly.
  const scan = () => toast(t('ask.soon'));

  return (
    <Screen>
      <Scroll top={top + 10}>
        <View style={styles.header}>
          <View style={{ gap: 2 }}>
            <T v="h1" style={{ fontSize: 34, lineHeight: 38 }} accessibilityRole="header">{t('wallet.title')}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="lock" size={14} color={colors.ink3} /><T v="tiny">{t('wallet.locked')}</T></View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('wallet.passport.scan')} onPress={() => { buzz('tap'); scan(); }} style={styles.plus}><Icon name="plus" color={colors.mist} /></Pressable>
        </View>
        <View style={{ flexDirection: 'row' }}>
          <Chip on label={t('wallet.you')} icon={() => <View style={styles.dot} />} />
        </View>

        <Animated.View entering={rise(0)} style={[styles.passport, shadow('focal')]}>
          <VGradient id="pp" stops={[[0, colors.green2], [0.5, colors.green], [1, colors.green3]]} />
          <View style={styles.sunMark} pointerEvents="none"><Sun width={150} color="rgba(217,183,122,0.07)" /></View>
          <View style={styles.ppHead}>
            <View>
              <T v="eyebrow" color={colors.gold} style={{ fontSize: 11 }}>{t('wallet.passport.eyebrow')}</T>
              <T v="tiny" color={colors.onDark3} style={{ fontSize: 11 }}>{t('wallet.passport.country')}</T>
            </View>
            <View style={styles.chip}><View style={[styles.dot, { backgroundColor: colors.sand }]} /><T v="caption" color={colors.sand} style={{ fontFamily: fontFamilies.ui600 }}>{t('wallet.passport.notAdded')}</T></View>
          </View>
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            <View style={styles.photoSlot}><Icon name="user" size={26} color="rgba(217,183,122,0.55)" /></View>
            <View style={{ flex: 1, gap: 6 }}>
              <T style={[font('display', colors.mist), { fontSize: 26, lineHeight: 27 }]}>{t('wallet.passport.emptyTitle')}</T>
              <T v="tiny" color={colors.onDark2}>{t('wallet.passport.emptyBody')}</T>
            </View>
          </View>
          <T style={styles.mrz} numberOfLines={1}>{'P<SAU<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<'}</T>
          <Button variant="gold" size="small" block={false} label={t('wallet.passport.scan')} onPress={scan} style={{ alignSelf: 'flex-start' }} />
        </Animated.View>

        <T v="eyebrow">{t('wallet.docs.eyebrow')}</T>
        <EmptyState compact art={<ArtCardSlot kind="doc" width={100} height={75} />} title={t('wallet.docs.emptyTitle')} body={t('wallet.docs.emptyBody')} onPress={scan} />
        <T v="eyebrow">{t('wallet.passes.eyebrow')}</T>
        <EmptyState compact art={<ArtPass width={100} height={75} />} title={t('wallet.passes.emptyTitle')} body={t('wallet.passes.emptyBody')}
          action={<LinkButton label={t('wallet.passes.plan')} onPress={() => router.push('/ask')} />} />
      </Scroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  plus: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 99, backgroundColor: colors.onDark3 },
  passport: { borderRadius: 22, overflow: 'hidden', padding: 18, paddingBottom: 18, gap: 14 },
  sunMark: { position: 'absolute', end: -18, top: 48 },
  ppHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: { height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(233,226,216,0.14)', flexDirection: 'row', alignItems: 'center', gap: 6 },
  photoSlot: { width: 60, height: 76, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(217,183,122,0.45)', alignItems: 'center', justifyContent: 'center' },
  mrz: { fontFamily: fontFamilies.mono, fontSize: 10.5, lineHeight: 15, color: 'rgba(233,226,216,0.45)', letterSpacing: 1 },
});
