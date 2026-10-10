import { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { fontFamilies } from '@mada/shared';
import { Button, LinkButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Act, Scroll, Screen, TopBar } from '@/components/Layout';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { t } from '@/lib/i18n';
import { rise } from '@/lib/motion';
import { usePeople } from '@/lib/queries';
import { BLANK, SAMPLE_MRZ, usePassportScan } from '@/lib/passport-scan';
import { warmUp } from '@/lib/ocr';
import { colors, ff } from '@/theme';

/**
 * "Scan it once. Never type it again." (prototype Onboarding passport step, as "Add your passport"): a sample page
 * with a scan beam filling a booking form, then the camera, or typing it by hand. `?person=` scans for someone in
 * the household; without it, the account holder's own.
 */
export default function PassportIntro() {
  const router = useRouter();
  const { person } = useLocalSearchParams<{ person?: string }>();
  const people = usePeople();
  const start = usePassportScan((s) => s.start);
  const set = usePassportScan((s) => s.set);
  const [sheet, setSheet] = useState<null | 'camera' | 'denied'>(null);
  const [perm, ask] = useCameraPermissions();
  const who = person ? people.data?.find((p) => p.id === person) : null;
  useEffect(() => { start(person ?? null); }, [person, start]);

  const later = () => router.back();
  const byHand = () => { set({ manual: true, fromPhoto: false, doubt: [], fields: BLANK }); router.push('/passport/confirm'); };
  const toCamera = async () => {
    warmUp();
    if (perm?.granted) { router.push('/passport/camera'); return; }
    setSheet('camera');
  };
  const allow = async () => {
    // The web preview reads photos from files: there's no live camera to ask for.
    if (Platform.OS !== 'web') {
      const r = await ask().catch(() => null);
      if (!r?.granted) { setSheet('denied'); return; }
    }
    setSheet(null);
    router.push('/passport/camera');
  };

  return (
    <Screen>
      <TopBar onBack={later} right={<View style={{ paddingHorizontal: 4 }}><LinkButton label={t('passport.later')} size={15} onPress={later} /></View>} />
      <Scroll top={8} gutter={24} bottomPad={170}>
        <ScanStage />
        <T v="h1" accessibilityRole="header">{who && !who.isSelf ? t('passport.titleFor', { name: who.firstName }) : t('passport.title')}</T>
        <T v="body">{t('passport.body')}</T>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Icon name="lock" size={16} color={colors.inkSoft} /><T v="small" color={colors.inkSoft} style={{ flex: 1 }}>{t('passport.lock')}</T></View>
      </Scroll>
      <Act>
        <Button label={t('passport.scan')} icon={<Icon name="scan" color={colors.gold} />} onPress={toCamera} testID="passport-scan-start" />
        <Button variant="ghost" label={t('passport.byHand')} onPress={byHand} testID="passport-by-hand" />
      </Act>

      <Sheet visible={sheet === 'camera'} onClose={() => setSheet(null)} label={t('passport.camera.title')}>
        <T v="h2">{t('passport.camera.title')}</T>
        <T v="body">{t('passport.camera.body')}</T>
        <Button label={t('passport.camera.allow')} onPress={allow} testID="camera-allow" />
        <Button variant="ghost" label={t('passport.camera.deny')} onPress={() => setSheet('denied')} testID="camera-deny" />
      </Sheet>
      <Sheet visible={sheet === 'denied'} onClose={() => setSheet(null)} label={t('passport.camera.deniedTitle')}>
        <T v="h2">{t('passport.camera.deniedTitle')}</T>
        <T v="body">{t('passport.camera.deniedBody')}</T>
        <Button label={t('passport.byHand')} onPress={() => { setSheet(null); byHand(); }} testID="denied-by-hand" />
        {perm && !perm.canAskAgain ? <Button variant="secondary" label={t('passport.camera.settings')} onPress={() => Linking.openSettings().catch(() => {})} /> : null}
        <Button variant="ghost" label={t('passport.camera.doLater')} onPress={() => { setSheet(null); later(); }} />
      </Sheet>
    </Screen>
  );
}

/** The sample page, leaning a little, a gold beam reading it and the booking form filling itself in. */
function ScanStage() {
  const beam = useSharedValue(0);
  useEffect(() => { beam.set(withDelay(400, withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.ease) }), -1, true))); }, [beam]);
  const beamStyle = useAnimatedStyle(() => ({ transform: [{ translateY: beam.get() * 176 }] }));
  const rows: [string, string][] = [[t('passport.demo.nameOnTicket'), 'OMAR ALHARBI'], [t('passport.demo.passport'), 'A08•••41 · Saudi'], [t('passport.demo.valid'), 'Until June 2031']];
  return (
    <View style={styles.stage} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs><RadialGradient id="ppst" cx="20%" cy="0%" rx="120%" ry="80%"><Stop offset="0" stopColor="#2c4a40" /><Stop offset="0.55" stopColor="#1e352d" /><Stop offset="1" stopColor="#132620" /></RadialGradient></Defs>
        <Rect width="100%" height="100%" fill="url(#ppst)" />
      </Svg>
      <Animated.View entering={rise(0)} style={styles.page}>
        <View style={styles.ppHead}><T style={styles.ppHeadText}>{t('passport.demo.head')}</T><T style={styles.ppHeadText}>{t('passport.demo.type')}</T></View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={styles.ppPhoto}><Svg viewBox="0 0 60 76" width="100%" height="100%"><Circle cx={30} cy={30} r={13} fill="#b9ad98" /><Path d="M6 76c2-17 12-25 24-25s22 8 24 25z" fill="#b9ad98" /></Svg></View>
          <View style={{ gap: 5 }}>
            <Field k={t('passport.demo.surname')} v="ALHARBI" />
            <Field k={t('passport.demo.given')} v="OMAR" />
            <View style={{ flexDirection: 'row', gap: 16 }}><Field k={t('passport.demo.no')} v="A08•••41" /><Field k={t('passport.demo.expires')} v="22 JUN 2031" /></View>
          </View>
        </View>
        <T style={styles.ppMrz} numberOfLines={2}>{`${SAMPLE_MRZ[0]}\n${SAMPLE_MRZ[1]}`}</T>
        <Animated.View style={[styles.beam, beamStyle]} />
      </Animated.View>
      <Animated.View entering={rise(4)} style={styles.form}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={styles.sv}><T style={{ fontSize: 8, color: colors.mist, fontFamily: ff.ui600 }}>SV</T></View>
          <T style={{ fontSize: 12, fontFamily: ff.ui600, color: colors.green }}>{t('passport.demo.form')}</T>
          <T style={{ marginStart: 'auto', fontSize: 11, fontFamily: ff.ui600, color: colors.goldInk }}>{t('passport.demo.filled')}</T>
        </View>
        {rows.map(([k, v], i) => (
          <Animated.View key={k} entering={rise(8 + i * 10)} style={styles.row}>
            <T style={{ fontSize: 12.5, color: '#6b6a63', flex: 1 }}>{k}</T>
            <T style={{ fontSize: 12.5, fontFamily: ff.ui600, color: colors.green }}>{v}</T>
            <View style={styles.tick}><Icon name="check" size={12} color={colors.green} width={2.6} /></View>
          </Animated.View>
        ))}
      </Animated.View>
    </View>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return <View><T style={{ fontSize: 8.5, letterSpacing: 0.5, textTransform: 'uppercase', color: '#8a8173' }}>{k}</T><T style={{ fontSize: 12, fontFamily: ff.ui600, color: colors.green, letterSpacing: 0.2 }}>{v}</T></View>;
}

const styles = StyleSheet.create({
  stage: { height: 362, borderRadius: 32, overflow: 'hidden' },
  page: { position: 'absolute', start: 22, end: 22, top: 22, height: 178, borderRadius: 14, backgroundColor: '#f4ecdd', padding: 12, paddingHorizontal: 14, gap: 8, overflow: 'hidden', transform: [{ rotate: '-2.5deg' }], boxShadow: '0px 20px 36px -18px rgba(0,0,0,0.6)' },
  ppHead: { flexDirection: 'row', justifyContent: 'space-between' },
  ppHeadText: { fontSize: 9, fontFamily: ff.ui600, letterSpacing: 0.7, textTransform: 'uppercase', color: colors.goldInk },
  ppPhoto: { width: 52, height: 66, borderRadius: 8, backgroundColor: '#e2d7c4', overflow: 'hidden' },
  ppMrz: { marginTop: 'auto', fontFamily: fontFamilies.mono, fontSize: 8.6, lineHeight: 12, color: colors.inkSoft },
  beam: { position: 'absolute', start: 0, end: 0, top: 0, height: 2, backgroundColor: colors.gold, boxShadow: '0px 0px 18px 6px rgba(217,183,122,0.55)' },
  form: { position: 'absolute', start: 14, end: 14, bottom: 12, borderRadius: 20, backgroundColor: 'rgba(255,253,249,0.96)', paddingVertical: 12, paddingHorizontal: 14, gap: 8, boxShadow: '0px -10px 30px -12px rgba(0,0,0,0.45)' },
  sv: { height: 14, paddingHorizontal: 4, borderRadius: 3, backgroundColor: '#0b6b52', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tick: { width: 18, height: 18, borderRadius: 99, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
});
