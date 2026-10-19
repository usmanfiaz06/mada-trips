import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { t } from '@/lib/i18n';
import { colors, ff } from '@/theme';
import { T } from '../Text';

/*
 * A Hotelbeds hotel's photo, or an honest tile when there is none: the hotel's initial and name on a soft tone and
 * "No photo from the hotel yet". Never a stock room photo standing in for the hotel (a list of hotels without photos
 * looked like one hotel repeated). A photo that fails to load (404, offline) turns into the same tile.
 */

const TONES = [colors.goldWash, colors.mist, colors.warnWash, colors.grab, colors.sand] as const;

/** The same hotel always gets the same tone; neighbours in a list usually differ. */
export function toneOf(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length]!;
}

/** The first letter of the name (Arabic or Latin), skipping "The" and punctuation. */
export function initialOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => !/^(the|hotel)$/i.test(w));
  const ch = (words[0] ?? name).match(/[\p{L}\p{N}]/u)?.[0] ?? '·';
  return ch.toLocaleUpperCase();
}

export function HotelPhoto({ uri, name, seed, compact, style, testID, recyclingKey }: {
  uri: string | null | undefined; name: string; seed?: string | number; compact?: boolean; style?: StyleProp<ViewStyle>; testID?: string; recyclingKey?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (uri && failed !== uri) {
    return <ExpoImage source={{ uri }} style={[StyleSheet.absoluteFill, style as object]} contentFit="cover" transition={200} recyclingKey={recyclingKey} accessible={false} onError={() => setFailed(uri)} testID={testID ? `${testID}-img` : undefined} />;
  }
  return (
    <View style={[StyleSheet.absoluteFill, s.tile, { backgroundColor: toneOf(String(seed ?? name)) }, style]} testID={testID ? `${testID}-none` : undefined}
      accessible accessibilityLabel={`${name}. ${t('stay.noPhoto')}`}>
      <T style={[s.initial, compact ? { fontSize: 26, lineHeight: 30 } : null]} accessible={false}>{initialOf(name)}</T>
      {compact ? null : <T v="small" color={colors.green} numberOfLines={1} style={s.name} accessible={false}>{name}</T>}
      <T v="tiny" color={colors.ink2} numberOfLines={2} style={s.note} accessible={false}>{t('stay.noPhoto')}</T>
    </View>
  );
}

const s = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, gap: 2 },
  initial: { fontFamily: ff.ui600, fontSize: 34, lineHeight: 40, color: colors.goldInk },
  name: { fontFamily: ff.ui600, textAlign: 'center', maxWidth: '100%' },
  note: { textAlign: 'center' },
});
