import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView } from 'expo-camera';
import { Image } from 'expo-image';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { COUNTRIES, checkUpload, fontFamilies, type MrzResult } from '@mada/shared';
import { Button } from '@/components/Button';
import { PermissionDenied } from '@/components/states';
import { Icon } from '@/components/Icon';
import { TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { readPassport, warmUp } from '@/lib/ocr';
import { chooseFile, choosePhoto, takePhoto } from '@/lib/pick';
import { BLANK, DEMO_FIELDS, SAMPLE_MRZ, isPdf, usePassportScan } from '@/lib/passport-scan';
import type { PickedFile } from '@/lib/wallet';
import { demo } from '@/lib/wallet-demo';
import { colors } from '@/theme';

type Stage = 'choose' | 'demo' | 'reading' | 'failed';

/**
 * The camera (prototype Onboarding camera step): photograph the photo page, choose a photo, upload a photo or PDF
 * from files, or the demo passport. The two lines at the bottom are always read on the phone. The picture stays on
 * the phone with the details for the traveller to compare; it's sent (encrypted at rest) only if they choose to keep
 * a copy when they confirm. A PDF can't be read here, so it goes straight to typing the details beside it.
 * Wrong file, unreadable page and a reader that won't load each get their own words, then "Try again" or "Enter it
 * by hand" (which keeps the photo to compare with).
 */
export default function PassportCamera() {
  const router = useRouter();
  const set = usePassportScan((s) => s.set);
  const [stage, setStage] = useState<Stage>('choose');
  const picked = useRef<PickedFile | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [failWhy, setFailWhy] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [ready, setReady] = useState(false);
  const cam = useRef<CameraView>(null);
  const run = useRef(0);
  const live = Platform.OS !== 'web';
  useEffect(() => { warmUp(); return () => { run.current += 1; }; }, []);

  // The demo passport: a simulated scan of the sample page.
  useEffect(() => {
    if (stage !== 'demo') return undefined;
    const tm = setTimeout(() => {
      if (demo('scanFails')) { setFailWhy(null); setStage('failed'); buzz('soft'); return; }
      buzz('success');
      set({ fields: DEMO_FIELDS, doubt: [], fromPhoto: false, manual: false, copy: null });
      router.replace('/passport/confirm');
    }, 2200);
    return () => clearTimeout(tm);
  }, [stage, router, set]);

  const found = (r: MrzResult) => {
    const f = r.fields!;
    set({ fields: { given: f.given, surname: f.surname, number: f.number, nationality: f.nationality, dob: f.dob, expiry: f.expiry, sex: f.sex, issuer: COUNTRIES[f.issuer] ?? f.issuer, issued: '' }, doubt: r.doubtful, fromPhoto: true, manual: false, copy: picked.current, keepCopy: true });
    buzz(r.doubtful.length ? 'soft' : 'success');
    router.replace('/passport/confirm');
  };

  const read = async (uri: string, meta?: PickedFile, opts: { pdfOk?: boolean } = {}) => {
    setFileErr(null);
    if (meta) {
      const bad = checkUpload(meta, { photosOnly: !opts.pdfOk });
      if (bad) { setFileErr(t(bad === 'wallet.upload.tooBig' ? 'passport.camera.tooBig' : bad === 'wallet.upload.photoOnly' ? 'wallet.upload.photoOnly' : 'passport.camera.notPhoto')); buzz('soft'); return; }
      // A PDF of the page: typed beside it, and kept as the copy if they say so.
      if (isPdf(meta)) { set({ manual: true, fromPhoto: false, doubt: [], fields: BLANK, copy: meta, keepCopy: true }); router.replace('/passport/confirm'); return; }
    }
    picked.current = meta ?? { uri, name: 'passport.jpg', type: 'image/jpeg', size: 0 };
    const mine = ++run.current;
    setPhoto(uri); setProgress(0); setStage('reading');
    try {
      const r = demo('scanFails') ? { ...(await new Promise<MrzResult>((res) => setTimeout(() => res({ ok: false, format: null, lines: [], fields: null, checks: {}, errors: [], doubtful: [] }), 1200))) } : await readPassport(uri, (n) => { if (run.current === mine) setProgress(n); });
      if (run.current !== mine) return;
      if (!r.fields) { setFailWhy(null); setStage('failed'); buzz('soft'); return; }
      found(r);
    } catch (e) {
      if (run.current !== mine) return;
      setFailWhy(String((e as Error).message) === 'open' ? t('passport.camera.cantOpen') : t('passport.camera.readerMissing'));
      setStage('failed');
      buzz('soft');
    }
  };

  const shoot = async () => {
    if (live && cam.current && ready) {
      try { const p = await cam.current.takePictureAsync({ quality: 0.9, skipProcessing: false }); if (p?.uri) { read(p.uri); return; } } catch { /* fall back to the system camera */ }
    }
    const f = await takePhoto();
    if (f === 'denied') { buzz('soft'); setDenied(true); return; }
    if (f) read(f.uri, f);
  };
  const choose = async () => { const f = await choosePhoto(); if (f) read(f.uri, f); };
  const fromFiles = async () => { const f = await chooseFile(); if (f) read(f.uri, f, { pdfOk: true }); };
  // A file chosen on the intro: read it as this screen opens.
  useEffect(() => {
    const f = usePassportScan.getState().incoming;
    if (!f) return undefined;
    set({ incoming: null });
    const tm = setTimeout(() => { void read(f.uri, f, { pdfOk: true }); }, 0);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // By hand after a photo that wouldn't read: the photo stays beside the fields to copy from.
  const byHand = () => { set({ manual: true, fromPhoto: false, doubt: [], fields: BLANK, copy: picked.current, keepCopy: true }); router.replace('/passport/confirm'); };

  return (
    <View style={styles.camera} testID="passport-camera">
      <TopBar onBack={() => router.back()} backLabel={t('passport.camera.cancel')} dark />
      <ScrollView contentContainerStyle={{ paddingTop: 30, paddingBottom: 32, gap: 24 }}>
        <View style={styles.viewfinder}>
          {live && stage !== 'reading' ? <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setReady(true)} /> : null}
          {photo && stage === 'reading' ? <Image source={{ uri: photo }} style={[StyleSheet.absoluteFill, { opacity: 0.9 }]} contentFit="cover" contentPosition={{ top: '85%', left: '50%' }} /> : null}
          {stage === 'demo' || stage === 'reading' ? <ScanLine /> : null}
          {stage !== 'reading' && !live ? <T style={styles.sampleMrz} numberOfLines={2}>{`${SAMPLE_MRZ[0]}\n${SAMPLE_MRZ[1]}`}</T> : null}
        </View>

        {stage === 'choose' ? (
          <View style={{ paddingHorizontal: 24, gap: 12 }}>
            <View style={{ gap: 8, paddingHorizontal: 4, paddingBottom: 4 }}>
              <T v="h3" color={colors.mist} style={{ textAlign: 'center' }}>{t('passport.camera.hold')}</T>
              <T v="small" color={colors.onDark3} style={{ textAlign: 'center' }}>{t('passport.camera.holdBody')}</T>
            </View>
            <Button variant="gold" icon={<Icon name="scan" color={colors.green} />} label={t('passport.camera.take')} onPress={shoot} testID="camera-take" />
            <Button variant="onDark" label={t('passport.camera.choose')} onPress={choose} testID="camera-choose" />
            <Button variant="onDark" label={t('passport.camera.file')} onPress={fromFiles} testID="camera-file" />
            {denied ? <PermissionDenied kind="camera" onSkip={() => { setDenied(false); choose(); }} skipLabel={t('passport.camera.choose')} /> : null}
            {fileErr ? <T v="small" color="#e6c88f" style={{ textAlign: 'center' }} accessibilityRole="alert" testID="camera-file-problem">{fileErr}</T> : null}
            <Button variant="ghost" color="#d6cfc3" label={t('passport.camera.useDemo')} onPress={() => { setFileErr(null); setStage('demo'); }} testID="camera-demo" />
            <T v="tiny" color="#8f887c" style={{ textAlign: 'center' }}>{t('passport.camera.private')}</T>
          </View>
        ) : null}
        {stage === 'demo' ? (
          <View style={{ paddingHorizontal: 28, gap: 8 }}>
            <T v="h3" color={colors.mist} style={{ textAlign: 'center' }}>{t('passport.camera.demoTitle')}</T>
            <T v="small" color={colors.onDark3} style={{ textAlign: 'center' }}>{t('passport.camera.demoBody')}</T>
          </View>
        ) : null}
        {stage === 'reading' ? (
          <View style={{ paddingHorizontal: 28, gap: 10 }} accessibilityLiveRegion="polite">
            <T v="h3" color={colors.mist} style={{ textAlign: 'center' }}>{t('passport.camera.reading')}</T>
            <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={styles.bar}><View style={[styles.fill, { width: `${progress}%` }]} /></View>
            <T v="small" color={colors.onDark3} style={{ textAlign: 'center', fontVariant: ['tabular-nums'] }}>{`${progress < 30 ? t('passport.camera.warming') : t('passport.camera.looking')} ${progress}%`}</T>
          </View>
        ) : null}
        {stage === 'failed' ? (
          <View style={{ paddingHorizontal: 24, gap: 12 }} accessibilityRole="alert" testID="camera-failed">
            <T v="h2" color={colors.mist}>{t('passport.camera.failed')}</T>
            {failWhy ? <T v="body" color="#d6cfc3">{failWhy}</T> : (
              <View style={{ gap: 6 }}>
                {[t('passport.camera.tip1'), t('passport.camera.tip2'), t('passport.camera.tip3')].map((x) => <T key={x} v="body" color="#d6cfc3">{`•  ${x}`}</T>)}
              </View>
            )}
            <Button variant="gold" label={t('common.tryAgain')} onPress={() => { setFailWhy(null); setPhoto(null); picked.current = null; setStage('choose'); }} testID="camera-retry" />
            <Button variant="onDark" label={t('passport.byHand')} onPress={byHand} testID="camera-by-hand" />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ScanLine() {
  const y = useSharedValue(0);
  useEffect(() => { y.set(withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1, true)); }, [y]);
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() * 224 }] }));
  return <Animated.View style={[styles.scanline, st]} />;
}

const styles = StyleSheet.create({
  camera: { flex: 1, backgroundColor: '#0b100d' },
  viewfinder: { marginHorizontal: 24, height: 230, borderRadius: 22, borderWidth: 2, borderColor: 'rgba(233,226,216,0.5)', overflow: 'hidden', backgroundColor: '#0b100d' },
  scanline: { position: 'absolute', start: 0, end: 0, top: 0, height: 2, backgroundColor: colors.gold, boxShadow: '0px 0px 18px rgba(217,183,122,1)' },
  sampleMrz: { position: 'absolute', start: 16, end: 16, bottom: 16, fontFamily: fontFamilies.mono, fontSize: 10, lineHeight: 14, color: 'rgba(233,226,216,0.35)' },
  bar: { height: 6, borderRadius: 999, backgroundColor: 'rgba(233,226,216,0.14)', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.gold, borderRadius: 999 },
});
