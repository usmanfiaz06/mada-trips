import { ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';
import { headerDay, hijriLabel } from '@mada/shared';
import { Avatar } from '@/components/Avatar';
import { ArtFriends } from '@/components/art/Arts';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { VGradient } from '@/components/Gradient';
import { Icon, type IconName } from '@/components/Icon';
import { Scroll, Screen, useTopInset } from '@/components/Layout';
import { T } from '@/components/Text';
import { eidLine } from '@/lib/days';
import { t } from '@/lib/i18n';
import { rise } from '@/lib/motion';
import { usePeople } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { colors, font, radii, shadow, ff } from '@/theme';

const SERVICES: [IconName, Parameters<typeof t>[0]][] = [
  ['flight', 'today.service.flight'], ['stay', 'today.service.stay'], ['visa', 'today.service.visa'], ['umrah', 'today.service.umrah'],
  ['car', 'today.service.car'], ['food', 'today.service.food'], ['star', 'today.service.todo'],
];

/** Today with nothing planned (EXPERIENCE.md §6.2): one timely line, Ask, the passport nudge, at most 4 tiles. */
export default function Today() {
  const router = useRouter();
  const top = useTopInset();
  const user = useSession((s) => s.user);
  const people = usePeople();
  const hasPassport = people.data?.some((p) => p.isSelf && p.passport);
  const now = new Date();
  const hijri = hijriLabel(now);
  const ask = () => router.push('/ask');

  return (
    <Screen>
      <Scroll top={top + 10}>
        <View style={styles.header}>
          <T v="small" style={{ fontFamily: ff.ui500 }}>{headerDay(now)}{hijri ? ` · ${hijri}` : ''}</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={styles.bell} accessibilityLabel={t('today.a11y.notifications')}><Icon name="bell" size={19} /></View>
            <View accessibilityLabel={t('today.a11y.profile')}>
              {user?.name ? <Avatar initial={user.name} tone="green" size={44} /> : <Avatar size={44} />}
            </View>
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <Animated.View entering={rise(0)}><T style={[font('display'), { fontSize: 46, lineHeight: 48 }]} accessibilityRole="header">{t('today.nothing.title')}</T></Animated.View>
          <Animated.View entering={rise(1)}><T v="body">{eidLine(now)}</T></Animated.View>
        </View>

        <Animated.View entering={rise(2)}>
          <Card padding={18} style={[{ gap: 14 }, shadow('card')]}>
            <Card onPress={ask} padding={0} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'transparent' }} accessibilityLabel={t('today.composer.title')}>
              <View style={{ flex: 1, gap: 4 }}>
                <T style={font('displaySmall')}>{t('today.composer.title')}</T>
                <T v="small">{t('today.composer.body')}</T>
              </View>
              <View style={styles.mic}><Icon name="mic" color={colors.mist} size={20} /></View>
            </Card>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 18 }}>
              {SERVICES.map(([icon, key]) => <Chip key={key} label={t(key)} icon={(c) => <Icon name={icon} size={18} color={c} />} onPress={ask} />)}
            </ScrollView>
          </Card>
        </Animated.View>

        {!hasPassport && (
          <Animated.View entering={rise(3)}>
            <Card variant="notice" onPress={() => router.push('/wallet')} accessibilityLabel={t('today.passport.title')}>
              <View style={styles.ppMini}><View style={styles.ppMiniRing} /></View>
              <View style={{ flex: 1, gap: 4 }}>
                <T v="h3">{t('today.passport.title')}</T>
                <T v="small">{t('today.passport.body')}</T>
              </View>
              <Icon name="chevron" />
            </Card>
          </Animated.View>
        )}

        <Animated.View entering={rise(4)} style={styles.bento}>
          <Card onPress={ask} padding={0} style={[styles.photoTile]} accessibilityLabel={t('today.tile.alula.title')}>
            <Image source={require('../../../assets/images/alula.jpg')} style={StyleSheet.absoluteFill} contentFit="cover" />
            <VGradient id="alula" stops={[[0, 'rgba(15,26,22,0.05)'], [0.25, 'rgba(15,26,22,0.05)'], [1, 'rgba(15,26,22,0.78)']]} />
            <View style={{ padding: 16, gap: 4 }}>
              <T style={[font('displaySmall', colors.paper), { fontSize: 28 }]}>{t('today.tile.alula.title')}</T>
              <T v="small" color="rgba(255,253,249,0.9)">{t('today.tile.alula.body')}</T>
            </View>
          </Card>
          <View style={{ flex: 1, gap: 12 }}>
            <Card variant="focal" onPress={ask} style={styles.smallTile} accessibilityLabel={t('today.tile.istanbul.title')}>
              <View style={styles.spread}>
                <Image source={require('../../../assets/images/istanbul.jpg')} style={styles.cityDot} contentFit="cover" />
                <Icon name="chevron" color={colors.gold} />
              </View>
              <View>
                <T v="h3" color={colors.mist}>{t('today.tile.istanbul.title')}</T>
                <T v="tiny" color={colors.onDark2}>{t('today.tile.istanbul.body')}</T>
              </View>
            </Card>
            <Card onPress={() => router.push('/wallet')} style={styles.smallTile} accessibilityLabel={t('today.tile.family.title')}>
              <View style={{ marginStart: -8, marginTop: -6 }}><ArtFriends width={66} height={50} /></View>
              <View>
                <T v="h3">{t('today.tile.family.title')}</T>
                <T v="tiny">{t('today.tile.family.body')}</T>
              </View>
            </Card>
          </View>
        </Animated.View>
      </Scroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bell: { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  mic: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  ppMini: { width: 28, height: 36, borderRadius: 5, backgroundColor: colors.green, alignItems: 'center', paddingTop: 8, borderWidth: 1, borderColor: 'rgba(217,183,122,0.35)' },
  ppMiniRing: { width: 14, height: 14, borderRadius: 99, borderWidth: 1.5, borderColor: colors.gold },
  bento: { flexDirection: 'row', gap: 12 },
  photoTile: { flex: 1, minHeight: 250, borderRadius: radii.card, overflow: 'hidden', justifyContent: 'flex-end' },
  smallTile: { flex: 1, minHeight: 119, justifyContent: 'space-between' },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cityDot: { width: 34, height: 34, borderRadius: 999, borderWidth: 2, borderColor: colors.gold },
});
