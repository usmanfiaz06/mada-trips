import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { buzz } from '@/lib/haptics';
import { colors, radii, shadow } from '@/theme';

export type CardVariant = 'default' | 'focal' | 'well' | 'notice' | 'warn';

const BG: Record<CardVariant, string> = { default: colors.paper, focal: colors.green, well: colors.mist, notice: colors.paper, warn: colors.warnWash };

/** Cards: paper on sand. `focal` is the one green card that matters now. `onPress` makes the whole card the target. */
export function Card({ children, variant = 'default', selected, onPress, style, accessibilityLabel, padding = 16 }: {
  children: ReactNode; variant?: CardVariant; selected?: boolean; onPress?: () => void; style?: StyleProp<ViewStyle>; accessibilityLabel?: string; padding?: number;
}) {
  const s = [
    styles.card, { backgroundColor: BG[variant], padding },
    variant === 'focal' ? shadow('focal') : null,
    variant === 'notice' || variant === 'warn' ? styles.notice : null,
    selected ? styles.selected : null,
  ];
  if (!onPress) return <View style={[s, style]}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={() => { buzz('tap'); onPress(); }}
      style={({ pressed }) => [s, pressed ? { transform: [{ scale: 0.985 }] } : null, style]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.card, gap: 10 },
  notice: { borderRadius: radii.notice, flexDirection: 'row', alignItems: 'center', gap: 12 },
  selected: { borderWidth: 2, borderColor: colors.green },
});
