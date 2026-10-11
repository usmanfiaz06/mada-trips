import { memo, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SvgXml } from 'react-native-svg';
import {
  COVER_COLORS, COVER_COLOR_INFO, COVER_ICONS, COVER_PHOTOS, COVER_PHOTO_IDS, checkUpload, coverArtSvg,
  type CircleCover, type CoverColor, type CoverIcon,
} from '@mada/shared';
import { ApiError } from '@/lib/api';
import { COVER_PHOTO_SRC, uploadCover, uploadSource } from '@/lib/circle-covers';
import { buzz } from '@/lib/haptics';
import { isRTL, t } from '@/lib/i18n';
import type { PickedFile } from '@/lib/wallet';
import { colors, ff } from '@/theme';
import { Button } from '../Button';
import { VGradient } from '../Gradient';
import { Icon } from '../Icon';
import { T } from '../Text';
import { Segmented } from './ui';

/*
 * A circle's cover, wherever it shows (the circles rail, the chat's header, invites, the new-circle preview), and the
 * picker: Mada's drawings on a colour (the default), the photos we ship, or your own photo, checked before the rest
 * of the circle sees it. Drawings come from @mada/shared cover-art.ts, the same SVG the invite page draws.
 */

/** Paper words over a photo or the green; ink words on a light colour. */
export function coverInk(c: CircleCover | null | undefined): { text: string; soft: string; light: boolean } {
  const light = c?.kind === 'icon' && COVER_COLOR_INFO[c.color]?.text === 'ink';
  return light ? { text: colors.green, soft: 'rgba(30,53,45,0.72)', light } : { text: colors.paper, soft: 'rgba(255,253,249,0.86)', light };
}

const Drawing = memo(function Drawing({ cover, w, h, layout }: { cover: Extract<CircleCover, { kind: 'icon' }>; w: number; h: number; layout: 'banner' | 'badge' | 'poster' | 'header' }) {
  const xml = useMemo(() => coverArtSvg(cover, { width: w, height: h, layout, side: isRTL() ? 'left' : 'right' }), [cover.icon, cover.color, w, h, layout]); // eslint-disable-line react-hooks/exhaustive-deps
  return <SvgXml xml={xml} width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none" />;
});

/**
 * The cover as a background layer. `veil` darkens the bottom of a photo for words laid on it (the prototype's
 * .nc-veil); drawings keep their own calm corner, so they get a lighter one in their own colour.
 */
export function CoverArt({ cover, layout = 'banner', style, veil, children, testID }: {
  cover: CircleCover | null | undefined; layout?: 'banner' | 'badge' | 'poster' | 'header'; style?: StyleProp<ViewStyle>; veil?: boolean; children?: ReactNode; testID?: string;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const w = Math.round(width); const h = Math.round(height);
    if (w > 0 && h > 0 && (w !== size?.w || h !== size?.h)) setSize({ w, h });
  };
  const bg = cover?.kind === 'icon' ? COVER_COLOR_INFO[cover.color]?.bg ?? colors.green : colors.green;
  const src = cover?.kind === 'photo' ? COVER_PHOTO_SRC[cover.id] : cover?.kind === 'upload' ? uploadSource(cover.url) : null;
  const light = coverInk(cover).light;
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: bg }, style]} onLayout={onLayout} testID={testID}>
      {cover?.kind === 'icon' && size ? <Drawing cover={cover} w={size.w} h={size.h} layout={layout} /> : null}
      {src ? <Image source={src} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={cover?.kind === 'photo' ? COVER_PHOTOS[cover.id].focal as never : undefined} transition={200} /> : null}
      {veil ? (cover?.kind === 'icon'
        ? <VGradient id={`cv-${light ? 'l' : 'd'}`} stops={light ? [[0, 'rgba(255,253,249,0)'], [0.55, 'rgba(255,253,249,0)'], [1, 'rgba(255,253,249,0.55)']] : [[0, 'rgba(15,26,22,0)'], [0.55, 'rgba(15,26,22,0)'], [1, 'rgba(15,26,22,0.45)']]} />
        : <VGradient id="cv-photo" stops={[[0, 'rgba(15,26,22,0.05)'], [0.3, 'rgba(15,26,22,0.05)'], [1, 'rgba(15,26,22,0.78)']]} />) : null}
      {children}
    </View>
  );
}

/** A small square of the cover: list rows, invites, the picker. Rounded like an app icon. */
export function CoverBadge({ cover, size = 44, radius, style }: { cover: CircleCover | null | undefined; size?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  return <CoverArt cover={cover} layout="badge" style={[{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.28) }, style]} />;
}

/** "Only you see this until it's checked" / turned down: said to the person who added the photo. */
export function CoverStatus({ cover, onDark }: { cover: CircleCover | null | undefined; onDark?: boolean }) {
  if (cover?.kind !== 'upload' || cover.status === 'approved') return null;
  const bad = cover.status === 'rejected';
  return (
    <View style={[s.status, onDark ? s.statusDark : null, bad ? s.statusBad : null]} accessibilityRole={bad ? 'alert' : undefined} testID="cover-status">
      <Icon name={bad ? 'close' : 'lock'} size={14} color={bad ? colors.badInk : onDark ? colors.paper : colors.goldInk} />
      <T style={{ flexShrink: 1, fontSize: 12, lineHeight: 16, fontFamily: ff.ui600, color: bad ? colors.badInk : onDark ? colors.paper : colors.goldInk }}>
        {bad ? t('circles.cover.rejected') : t('circles.cover.pending')}
      </T>
    </View>
  );
}

type Tab = 'icons' | 'photos' | 'upload';

/**
 * The cover picker: three segments. Drawings first, each on the colour picked below; photos we ship (with their
 * credit); your own photo from the camera roll, cropped to the cover's shape and uploaded straight away.
 */
export function CoverPicker({ value, onChange, upload, onUpload }: {
  value: CircleCover | null; onChange: (c: CircleCover | null) => void;
  /** The photo you uploaded in this picker, kept so switching tabs doesn't lose it. */
  upload: Extract<CircleCover, { kind: 'upload' }> | null; onUpload: (c: Extract<CircleCover, { kind: 'upload' }> | null) => void;
}) {
  const [tab, setTab] = useState<Tab>(value?.kind === 'photo' ? 'photos' : value?.kind === 'upload' ? 'upload' : 'icons');
  const [color, setColor] = useState<CoverColor>(value?.kind === 'icon' ? value.color : 'green');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const icon: CoverIcon | null = value?.kind === 'icon' ? value.icon : null;

  const pick = async () => {
    setProblem(null);
    let r: ImagePicker.ImagePickerResult;
    try {
      r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [16, 10], quality: 0.85, exif: false });
    } catch { setProblem(t('account.photo.notPhoto')); return; }
    const a = r.canceled ? null : r.assets[0];
    if (!a) return;
    const name = a.fileName ?? a.file?.name ?? 'cover.jpg';
    const f: PickedFile = { uri: a.uri, name, type: a.mimeType ?? a.file?.type ?? 'image/jpeg', size: a.fileSize ?? a.file?.size ?? 0, file: a.file ?? null };
    const bad = checkUpload(f, { photosOnly: true });
    if (bad) { setProblem(bad === 'wallet.upload.tooBig' ? t('account.photo.tooBig') : t('account.photo.notPhoto')); buzz('soft'); return; }
    setBusy(true);
    try {
      const { fileId } = await uploadCover(f);
      const c = { kind: 'upload' as const, fileId, status: 'pending' as const, url: a.uri };
      onUpload(c); onChange(c); buzz('success');
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : t('error.internal'));
    } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 14 }}>
      <Segmented label={t('circles.cover.a11y')} value={tab} testID="cover-tab"
        onChange={(k) => { setTab(k); if (k === 'upload' && upload) onChange(upload); }}
        options={[['icons', t('circles.cover.tab.icons')], ['photos', t('circles.cover.tab.photos')], ['upload', t('circles.cover.tab.upload')]]} />

      {tab === 'icons' ? (<>
        <View style={s.grid} accessibilityRole="radiogroup" accessibilityLabel={t('circles.cover.icons')}>
          {COVER_ICONS.map((k) => {
            const on = icon === k;
            return (
              <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={t(`circles.cover.icon.${k}`)} testID={`cover-icon-${k}`}
                onPress={() => { buzz('select'); onChange({ kind: 'icon', icon: k, color }); }} style={[s.cell, on ? s.cellOn : null]}>
                <CoverBadge cover={{ kind: 'icon', icon: k, color }} size={42} radius={13} />
              </Pressable>
            );
          })}
        </View>
        <View style={{ gap: 8 }}>
          <T v="small" style={{ fontFamily: ff.ui600 }}>{t('circles.cover.colours')}</T>
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }} accessibilityRole="radiogroup" accessibilityLabel={t('circles.cover.colours')}>
            {COVER_COLORS.map((c) => (
              <Pressable key={c} accessibilityRole="radio" accessibilityState={{ checked: color === c }} accessibilityLabel={t('circles.cover.colourA11y', { colour: t(`circles.cover.color.${c}`) })} testID={`cover-color-${c}`}
                onPress={() => { buzz('select'); setColor(c); onChange({ kind: 'icon', icon: icon ?? 'plane', color: c }); }}
                style={[s.dot, { backgroundColor: COVER_COLOR_INFO[c].bg }, color === c ? s.dotOn : null]} />
            ))}
          </View>
        </View>
      </>) : null}

      {tab === 'photos' ? (
        <View style={{ gap: 8 }}>
          <View style={s.grid} accessibilityRole="radiogroup" accessibilityLabel={t('circles.cover.tab.photos')}>
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: value === null }} accessibilityLabel={t('circles.newCircle.plain')} testID="cover-photo-plain"
              onPress={() => { buzz('select'); onChange(null); }} style={[s.photo, value === null ? s.photoOn : null]}>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.green, borderRadius: 14 }]} />
            </Pressable>
            {COVER_PHOTO_IDS.map((id) => {
              const on = value?.kind === 'photo' && value.id === id;
              return (
                <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={t(`circles.cover.photo.${id}`)} testID={`cover-photo-${id}`}
                  onPress={() => { buzz('select'); onChange({ kind: 'photo', id }); }} style={[s.photo, on ? s.photoOn : null]}>
                  <Image source={COVER_PHOTO_SRC[id]} style={[StyleSheet.absoluteFill, { borderRadius: 14 }]} contentFit="cover" />
                  <View style={s.photoName}><T style={{ fontSize: 11, fontFamily: ff.ui600, color: colors.paper }} numberOfLines={1}>{t(`circles.cover.photo.${id}`)}</T></View>
                </Pressable>
              );
            })}
          </View>
          {value?.kind === 'photo' && COVER_PHOTOS[value.id].credit ? <T v="tiny">{t('circles.cover.credit', { credit: COVER_PHOTOS[value.id].credit! })}</T> : null}
        </View>
      ) : null}

      {tab === 'upload' ? (
        <View style={s.well}>
          {upload ? (
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <CoverArt cover={upload} style={{ width: 96, height: 60, borderRadius: 14 }} />
              <T v="small" style={{ flex: 1 }}>{t('circles.cover.uploadBody')}</T>
            </View>
          ) : <T v="small">{t('circles.cover.uploadBody')}</T>}
          <Button size="small" block={false} variant={upload ? 'secondary' : 'primary'} style={{ alignSelf: 'flex-start' }} busy={busy}
            label={busy ? t('circles.cover.uploading') : upload ? t('circles.cover.another') : t('circles.cover.choose')} icon={<Icon name="scan" size={18} color={upload ? colors.green : colors.gold} />}
            onPress={pick} testID="cover-upload" />
          {problem ? <T v="small" color={colors.badInk} accessibilityRole="alert">{problem}</T> : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, columnGap: 6 },
  cell: { width: '15%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 2, borderColor: 'transparent' },
  cellOn: { borderColor: colors.goldDeep },
  dot: { width: 36, height: 36, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(30,53,45,0.12)' },
  dotOn: { borderWidth: 2, borderColor: colors.goldDeep, transform: [{ scale: 1.08 }], boxShadow: `0px 0px 0px 3px ${colors.sand}` },
  photo: { width: '31.6%', aspectRatio: 1.56, borderRadius: 16, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden', justifyContent: 'flex-end' },
  photoOn: { borderColor: colors.goldDeep },
  photoName: { paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(15,26,22,0.45)' },
  well: { backgroundColor: colors.mist, borderRadius: 24, padding: 16, gap: 10 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.goldWash },
  statusDark: { backgroundColor: 'rgba(15,26,22,0.55)' },
  statusBad: { backgroundColor: colors.warnWash },
});

