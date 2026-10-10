import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { HapticName } from '@mada/shared';
import { buzz } from '@/lib/haptics';
import { colors, font, sizes } from '@/theme';
import { T } from './Text';

export type ButtonVariant = 'primary' | 'gold' | 'secondary' | 'ghost' | 'onDark' | 'glass';

const BG: Record<ButtonVariant, string> = {
  primary: colors.green, gold: colors.gold, secondary: colors.paper, ghost: 'transparent',
  onDark: 'rgba(233,226,216,0.14)', glass: 'rgba(255,253,249,0.14)',
};
const FG: Record<ButtonVariant, string> = {
  primary: colors.mist, gold: colors.green, secondary: colors.green, ghost: colors.green, onDark: colors.mist, glass: colors.onDark,
};

/**
 * Buttons say what happens ("Text me a code", "Allow alerts"), never "Submit" (COPY.md §2).
 * One primary per screen, in the Act zone at the bottom (EXPERIENCE.md §3.1).
 */
export function Button({
  label, onPress, variant = 'primary', size = 'md', block = true, disabled, busy, icon, haptic = 'tap', style, color, accessibilityLabel, testID,
}: {
  label: string; onPress?: () => void; variant?: ButtonVariant; size?: 'md' | 'small'; block?: boolean; disabled?: boolean; busy?: boolean;
  icon?: ReactNode; haptic?: HapticName | null; style?: StyleProp<ViewStyle>; color?: string; accessibilityLabel?: string; testID?: string;
}) {
  const fg = color ?? FG[variant];
  const off = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={() => { if (haptic) buzz(haptic); onPress?.(); }}
      style={({ pressed }) => [
        styles.base,
        size === 'small' ? styles.small : null,
        block ? styles.block : null,
        { backgroundColor: BG[variant] },
        variant === 'glass' ? styles.glass : null,
        off ? styles.off : null,
        pressed ? styles.pressed : null,
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : (
        <View style={styles.row}>
          {icon}
          <T style={[font('button', fg), size === 'small' ? { fontSize: 14, lineHeight: 18 } : null]} numberOfLines={1}>{label}</T>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { height: sizes.button, borderRadius: 999, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  small: { height: sizes.buttonSmall, paddingHorizontal: 16 },
  block: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  glass: { borderWidth: 1, borderColor: 'rgba(255,253,249,0.16)' },
  off: { opacity: 0.45 },
  pressed: { transform: [{ scale: 0.98 }] },
});

/** An inline text action ("Change number"). */
export function LinkButton({ label, onPress, color = colors.green, size = 14 }: { label: string; onPress: () => void; color?: string; size?: number }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => { buzz('tap'); onPress(); }} hitSlop={10}>
      <T v="h3" color={color} style={{ fontSize: size, textDecorationLine: 'underline' }}>{label}</T>
    </Pressable>
  );
}
