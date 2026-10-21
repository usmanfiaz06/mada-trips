import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Icon, type IconName } from '@/components/Icon';
import { IconTile } from '@/components/trips/ui';
import { T } from '@/components/Text';
import { enter } from './parts';
import { colors, ff, radii } from '@/theme';

/*
 * The frame the companion cards share (ChoiceCard, InviteCard, ChangeRequestCard, ASK-INTEGRATED.md §5): the same
 * paper box, icon tile and title as the other chat cards in ChatThread, and a person's initial in a round mark.
 */

export function Frame({ icon, title, sub, pill, children, testID }: { icon: IconName; title: string; sub?: string | null; pill?: ReactNode; children?: ReactNode; testID?: string }) {
  return (
    <Animated.View entering={enter(0)} style={s.box} testID={testID}>
      <View style={[s.row, { alignItems: 'flex-start' }]}>
        <IconTile name={icon} />
        <View style={{ flex: 1, gap: 6 }}>
          <T v="h3" style={{ fontSize: 16, lineHeight: 22 }} accessibilityRole="header">{title}</T>
          {sub ? <T v="small" color={colors.ink2}>{sub}</T> : null}
          {pill ?? null}
        </View>
      </View>
      {children}
    </Animated.View>
  );
}

export function Initial({ letter, size = 36, gold }: { letter: string; size?: number; gold?: boolean }) {
  return (
    <View style={[s.initial, { width: size, height: size, backgroundColor: gold ? colors.goldWash : colors.mist }]}>
      <T style={{ fontFamily: ff.ui600, fontSize: Math.round(size * 0.42), color: colors.green }}>{letter}</T>
    </View>
  );
}

/** One quiet line with an icon (what it costs, what they'll see). */
export function Line({ icon, text, testID }: { icon: IconName; text: string; testID?: string }) {
  return (
    <View style={s.line} testID={testID}>
      <Icon name={icon} size={16} color={colors.ink3} />
      <T v="small" color={colors.ink2} style={{ flex: 1 }}>{text}</T>
    </View>
  );
}

export const s = StyleSheet.create({
  box: { backgroundColor: colors.paper, borderRadius: radii.card, padding: 16, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  initial: { borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 14, backgroundColor: colors.sand },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
