import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image, type ImageSource } from 'expo-image';
import { colors, font } from '@/theme';
import { T } from '../Text';

/*
 * A photo that never leaves a hole. Until it arrives (and if it never does) the space holds a warm tone with the
 * place's or person's initials, the same tone every time for the same name. A small `preview` (a thumbnail or a
 * blurhash) shows first when given, then the full photo fades in: slow connections see something at once.
 */

const TONES = [['#d9c9a8', '#7d5d27'], ['#c9d2c4', '#1e352d'], ['#e3cfc0', '#8a3524'], ['#d6cdbf', '#3f4f48'], ['#efe3c9', '#7d5d27']] as const;

export function toneFor(name: string): readonly [string, string] {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length]!;
}

export const initialsOf = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');

export function SafeImage({ source, preview, name, style, contentPosition, radius = 0, testID }: {
  source: ImageSource | string | number | null | undefined;
  /** A tiny version or a blurhash ("blurhash:…"), shown first. */
  preview?: ImageSource | string;
  /** For the initials and tone if the photo doesn't come. */
  name: string;
  style?: StyleProp<ViewStyle>;
  contentPosition?: { top?: string; left?: string } | string;
  radius?: number;
  testID?: string;
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>(source ? 'loading' : 'failed');
  const [bg, fg] = toneFor(name);
  const placeholder = typeof preview === 'string' && preview.startsWith('blurhash:') ? { blurhash: preview.slice(9) } : preview;
  return (
    <View style={[styles.box, { backgroundColor: bg, borderRadius: radius }, style]} testID={testID ?? 'safe-image'} accessibilityIgnoresInvertColors>
      {state !== 'ok' ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <T style={[font('displaySmall', fg), { opacity: state === 'failed' ? 0.9 : 0.5 }]}>{initialsOf(name)}</T>
        </View>
      ) : null}
      {source && state !== 'failed' ? (
        <Image
          source={source as ImageSource}
          placeholder={placeholder as ImageSource | undefined}
          contentFit="cover"
          contentPosition={contentPosition as never}
          transition={250}
          style={StyleSheet.absoluteFill}
          onLoad={() => setState('ok')}
          onError={() => setState('failed')}
          accessibilityLabel={name}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: colors.stage },
  center: { alignItems: 'center', justifyContent: 'center' },
});
