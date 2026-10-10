import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { fontFamilies } from '@mada/shared';
import { colors, sizes } from '@/theme';
import { T } from './Text';

export type PillVariant = 'default' | 'gold' | 'glass' | 'ok' | 'dark';
const BG: Record<PillVariant, string> = { default: colors.mist, gold: colors.gold, glass: 'rgba(15,26,22,0.5)', ok: 'rgba(47,122,75,0.12)', dark: colors.green };
const FG: Record<PillVariant, string> = { default: colors.green, gold: colors.green, glass: colors.paper, ok: colors.ok, dark: colors.onDark };

/** Small status labels: "Not added yet", "Live · airline", "Confirmed by Faisal at Mada". */
export function Pill({ label, variant = 'default', icon, style, height = sizes.pill }: { label: string; variant?: PillVariant; icon?: ReactNode; style?: StyleProp<ViewStyle>; height?: number }) {
  return (
    <View style={[styles.pill, { backgroundColor: BG[variant], height }, variant === 'glass' ? styles.glass : null, style]}>
      {icon}
      <T v="caption" color={FG[variant]} style={{ fontFamily: fontFamilies.ui600 }} numberOfLines={1}>{label}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: 10, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  glass: { borderWidth: 1, borderColor: 'rgba(255,253,249,0.18)' },
});
