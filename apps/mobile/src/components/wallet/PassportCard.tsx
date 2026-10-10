import { useId } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { fontFamilies, makeTd3, type Person } from '@mada/shared';
import { t } from '@/lib/i18n';
import { fullDay, fullNameOf, monthYear, type Validity } from '@/lib/wallet-model';
import { colors, font, shadow } from '@/theme';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Sun } from '../Sun';
import { T } from '../Text';

/*
 * The passport card (prototype Wallet .passport): green, a sheen that follows your finger, a few degrees of tilt,
 * the photo slot, number, birth year and expiry, and the two machine-readable lines. Waiting state when there's no
 * passport yet. The number is only ever the masked one.
 */

export type Chip = { text: string; bg: string; fg: string };

export function chipFor(p: Person | undefined, v: Validity): Chip {
  if (!p?.passport) return { text: t('wallet.passport.notAdded'), bg: 'rgba(233,226,216,0.14)', fg: colors.onDark };
  switch (v.kind) {
    case 'blocked': return { text: t('wallet.chip.notValid', { city: v.trip.city }), bg: 'rgba(217,183,122,0.22)', fg: '#e6c88f' };
    case 'expired': return { text: t('wallet.chip.expired'), bg: 'rgba(217,183,122,0.22)', fg: '#e6c88f' };
    case 'spare': return { text: t('wallet.chip.spare', { days: v.left - v.need }), bg: 'rgba(217,183,122,0.18)', fg: '#e6c88f' };
    case 'ready': return { text: t('wallet.chip.ready', { city: v.trip.city }), bg: 'rgba(63,154,99,0.22)', fg: '#9fd5b2' };
    default: return { text: t('wallet.chip.valid'), bg: 'rgba(63,154,99,0.22)', fg: '#9fd5b2' };
  }
}

const COUNTRY: Record<string, string> = { SAU: 'Kingdom of Saudi Arabia', PHL: 'Republic of the Philippines', IND: 'Republic of India', PAK: 'Islamic Republic of Pakistan', EGY: 'Arab Republic of Egypt', ARE: 'United Arab Emirates', JOR: 'Hashemite Kingdom of Jordan' };

export function PassportCard({ person, validity, isSelf, name, onScan }: { person: Person | undefined; validity: Validity; isSelf: boolean; name: string; onScan: () => void }) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const rx = useSharedValue(0);
  const ry = useSharedValue(0);
  const sheen = useSharedValue(0.5);
  const missing = !person?.passport;
  const chip = chipFor(person, validity);
  const reset = () => { rx.set(withTiming(0, { duration: 600 })); ry.set(withTiming(0, { duration: 600 })); sheen.set(withTiming(0.5, { duration: 600 })); };
  const tilt = Gesture.Pan().minDistance(0).shouldCancelWhenOutside(false)
    .onBegin((e) => { 'worklet'; rx.set(-((e.y / 214) - 0.5) * 10); })
    .onUpdate((e) => {
      'worklet';
      const x = Math.min(1, Math.max(0, e.x / 350));
      const y = Math.min(1, Math.max(0, e.y / 214));
      ry.set((x - 0.5) * 14); rx.set(-(y - 0.5) * 10); sheen.set(x);
    })
    .onFinalize(() => { 'worklet'; rx.set(withTiming(0, { duration: 600 })); ry.set(withTiming(0, { duration: 600 })); sheen.set(withTiming(0.5, { duration: 600 })); });
  const card = useAnimatedStyle(() => ({ transform: [{ perspective: 1000 }, { rotateX: `${rx.get()}deg` }, { rotateY: `${ry.get()}deg` }] }));
  const sheenStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (0.5 - sheen.get()) * 260 }] }));
  const issuer = person?.passport?.issuingCountry ?? 'SAU';
  // The two lines as printed, with the number masked the way the Wallet always shows it.
  const td3 = person?.passport && person.dateOfBirth
    ? makeTd3({ surname: person.surname, given: person.givenNames, number: person.passport.numberMasked.replace(/•/g, '0'), nationality: person.passport.nationality, dob: person.dateOfBirth, sex: person.sex ?? undefined, expiry: person.passport.expiry, issuer })
    : null;
  const mrz = td3 ? [td3[0], person!.passport!.numberMasked.padEnd(9, '<') + td3[1].slice(9)] : null;
  const expires = person?.passport ? (validity.kind === 'blocked' || validity.kind === 'expired' ? fullDay(person.passport.expiry) : monthYear(person.passport.expiry)) : '';

  return (
    <View style={{ height: 214 }}>
    <GestureDetector gesture={tilt}>
      <Animated.View style={[styles.passport, shadow('focal'), card]} onPointerLeave={Platform.OS === 'web' ? reset : undefined} testID="passport-card">
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id={`ppg${gid}`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={colors.green2} /><Stop offset="0.5" stopColor={colors.green} /><Stop offset="1" stopColor={colors.green3} /></LinearGradient>
            <LinearGradient id={`pps${gid}`} x1="0" y1="0" x2="1" y2="0.4"><Stop offset="0.3" stopColor="#ffffff" stopOpacity={0} /><Stop offset="0.48" stopColor="#e9d2a0" stopOpacity={0.3} /><Stop offset="0.54" stopColor="#aadcd2" stopOpacity={0.12} /><Stop offset="0.7" stopColor="#ffffff" stopOpacity={0} /></LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#ppg${gid})`} />
        </Svg>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { start: -130, end: -130 }, sheenStyle]}>
          <Svg width="100%" height="100%" preserveAspectRatio="none"><Rect width="100%" height="100%" fill={`url(#pps${gid})`} /></Svg>
        </Animated.View>
        <View style={styles.sunMark} pointerEvents="none"><Sun width={150} color="rgba(217,183,122,0.07)" /></View>

        <View style={styles.inner}>
          <View style={styles.head}>
            <View>
              <T v="eyebrow" color={colors.gold} style={{ fontSize: 11 }}>{t('wallet.passport.eyebrow')}</T>
              <T v="tiny" color={colors.onDark3} style={{ fontSize: 11 }}>{COUNTRY[issuer] ?? t('wallet.passport.issuedBy', { country: issuer })}</T>
            </View>
            <View style={[styles.chip, { backgroundColor: chip.bg }]} testID="passport-chip">
              <View style={[styles.dot, { backgroundColor: chip.fg }]} />
              <T v="caption" color={chip.fg} style={{ fontFamily: fontFamilies.ui600 }} numberOfLines={1}>{chip.text}</T>
            </View>
          </View>

          {missing ? (
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                <View style={styles.waitPhoto}><Icon name="user" size={26} color="rgba(217,183,122,0.55)" /></View>
                <View style={{ flex: 1, gap: 6 }}>
                  <T style={[font('display', colors.mist), { fontSize: 26, lineHeight: 27 }]}>{isSelf ? t('wallet.passport.emptyTitle') : t('wallet.passport.waitingOther', { name })}</T>
                  <T v="tiny" color={colors.onDark2}>{t('wallet.passport.emptyBody')}</T>
                </View>
              </View>
              <T style={styles.waitMrz} numberOfLines={1}>{'P<SAU<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<'}</T>
              <Button variant="gold" size="small" block={false} label={t('wallet.passport.scan')} onPress={onScan} style={{ alignSelf: 'flex-start' }} testID="passport-scan" />
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                <View style={styles.photoSlot}><T style={[font('display', colors.green), { fontSize: 32, lineHeight: 36 }]}>{(person.firstName || name).charAt(0)}</T></View>
                <View style={{ flex: 1, gap: 8 }}>
                  <T style={[font('display', colors.mist), { fontSize: 26, lineHeight: 28 }]} numberOfLines={1}>{fullNameOf(person)}</T>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {[[t('wallet.passport.number'), person.passport!.numberMasked], [t('wallet.passport.born'), person.dateOfBirth?.slice(0, 4) ?? ''], [t('wallet.passport.expires'), expires]].map(([k, v], i) => (
                      <View key={k} style={{ flex: 1, gap: 1 }}>
                        <T style={{ fontSize: 10, lineHeight: 13, color: colors.onDark3 }}>{k}</T>
                        <T style={{ fontSize: 13, lineHeight: 17, fontFamily: fontFamilies.ui600, fontVariant: ['tabular-nums'], color: i === 2 && (validity.kind === 'blocked' || validity.kind === 'spare' || validity.kind === 'expired') ? '#e6c88f' : '#e9e2d8' }} numberOfLines={1}>{v}</T>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
              {mrz ? <T style={styles.mrz} numberOfLines={2}>{`${mrz[0]}\n${mrz[1]}`}</T> : null}
            </>
          )}
        </View>
      </Animated.View>
    </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  passport: { height: 214, borderRadius: 22, overflow: 'hidden' },
  inner: { flex: 1, paddingTop: 16, paddingHorizontal: 18, paddingBottom: 12, justifyContent: 'space-between' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  chip: { height: 26, paddingHorizontal: 10, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 9 },
  sunMark: { position: 'absolute', end: -18, top: 48 },
  photoSlot: { width: 60, height: 76, borderRadius: 12, backgroundColor: '#ddd3c4', alignItems: 'center', justifyContent: 'center' },
  waitPhoto: { width: 58, height: 72, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(217,183,122,0.55)', alignItems: 'center', justifyContent: 'center' },
  waitMrz: { fontFamily: fontFamilies.mono, fontSize: 11, letterSpacing: 1.3, color: 'rgba(233,226,216,0.28)' },
  mrz: { fontFamily: fontFamilies.mono, fontSize: 10.5, lineHeight: 15, color: 'rgba(233,226,216,0.55)' },
});
