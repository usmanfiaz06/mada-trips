import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { buzz } from '@/lib/haptics';
import { colors, font, sizes } from '@/theme';
import { T } from './Text';

/** Chips: the one question that changes the outcome, answered with a tap (EXPERIENCE.md §5). */
export function Chip({ label, icon, on, onPress, background }: { label: string; icon?: (color: string) => ReactNode; on?: boolean; onPress?: () => void; background?: string }) {
  const fg = on ? colors.mist : colors.green;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!on }} onPress={() => { buzz('select'); onPress?.(); }}
      style={({ pressed }) => [styles.chip, { backgroundColor: on ? colors.green : background ?? colors.mist }, pressed ? { transform: [{ scale: 0.97 }] } : null]}>
      <View style={styles.row}>
        {icon?.(fg)}
        <T style={font('h3', fg)} numberOfLines={1}>{label}</T>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { height: sizes.chip, borderRadius: 999, paddingHorizontal: 14, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 7 },
});
