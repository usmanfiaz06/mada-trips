import { StyleSheet, View } from 'react-native';
import { colors, font } from '@/theme';
import { Icon } from './Icon';
import { T } from './Text';

/** A person's initial on a disc. Faces belong to people, never to software (COPY.md §6). */
export function Avatar({ initial, tone = 'default', size = 40, ring }: { initial?: string; tone?: 'default' | 'green' | 'gold'; size?: number; ring?: string }) {
  const bg = tone === 'green' ? colors.green : tone === 'gold' ? colors.gold : colors.mist;
  const fg = tone === 'green' ? colors.sand : colors.green;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.a, { width: size, height: size, backgroundColor: bg }, ring ? { borderWidth: 2, borderColor: ring } : null]}>
      {initial ? <T style={[font('h3', fg), { fontSize: size * 0.38, lineHeight: size * 0.5 }]}>{initial.charAt(0).toUpperCase()}</T> : <Icon name="user" size={size * 0.45} />}
    </View>
  );
}

/** Overlapping faces: the people in a trip or a circle. */
export function AvatarStack({ people, size = 32 }: { people: { initial: string; tone?: 'default' | 'green' | 'gold' }[]; size?: number }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {people.map((p, i) => (
        <View key={i} style={{ marginStart: i ? -10 : 0 }}><Avatar initial={p.initial} tone={p.tone} size={size} ring={colors.sand} /></View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ a: { borderRadius: 999, alignItems: 'center', justifyContent: 'center' } });
