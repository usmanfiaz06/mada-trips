import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { buzz } from '@/lib/haptics';
import { colors, font, radii, shadow } from '@/theme';
import { Chip } from './Chip';
import { Icon } from './Icon';
import { T } from './Text';

/** The soft stage every drawing sits on: warm paper, a faint dot grid. */
export function ArtStage({ children, height = 132 }: { children: ReactNode; height?: number }) {
  return (
    <View style={[styles.stage, { height }]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <RadialGradient id="esbg" cx="50%" cy="0%" rx="80%" ry="100%"><Stop offset="0" stopColor="#fbf6ec" /><Stop offset="1" stopColor="#f3ebdd" /></RadialGradient>
          <Pattern id="esdots" width={14} height={14} patternUnits="userSpaceOnUse"><Circle cx={7} cy={7} r={1} fill="rgba(125,93,39,0.13)" /></Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#esbg)" />
        <Rect x="12%" y="8%" width="76%" height="84%" fill="url(#esdots)" opacity={0.8} />
      </Svg>
      <View style={{ zIndex: 1 }}>{children}</View>
    </View>
  );
}

/**
 * The empty-state wrapper (prototype EmptyState): a drawing on a soft stage, one display line of what lands here,
 * one sentence of why, one next step, and at most a few quiet ideas in a row. `compact` is the inline row version.
 */
export function EmptyState({ art, title, body, action, ideas, compact, onPress, stageHeight }: {
  art?: ReactNode; title: string; body?: string; action?: ReactNode; ideas?: [string, () => void][]; compact?: boolean; onPress?: () => void; stageHeight?: number;
}) {
  if (compact) {
    const inner = (
      <>
        <View style={styles.tile}>{art}</View>
        <View style={{ flex: 1, gap: 2 }}>
          <T v="h3" style={{ fontSize: 15 }}>{title}</T>
          {body ? <T v="tiny" color={colors.ink2}>{body}</T> : null}
          {action ? <View style={{ marginTop: 6, flexDirection: 'row' }}>{action}</View> : null}
        </View>
        {onPress ? <Icon name="chevron" size={18} /> : null}
      </>
    );
    return onPress
      ? <Pressable accessibilityRole="button" onPress={() => { buzz('tap'); onPress(); }} style={({ pressed }) => [styles.row, pressed ? { transform: [{ scale: 0.985 }] } : null]}>{inner}</Pressable>
      : <View style={styles.row}>{inner}</View>;
  }
  return (
    <View style={[styles.es, shadow('card')]} accessibilityLabel={title}>
      {art ? <ArtStage height={stageHeight}>{art}</ArtStage> : null}
      <T style={[font('displaySmall'), styles.inset]} accessibilityRole="header">{title}</T>
      {body ? <T v="small" style={[styles.inset, { marginTop: -4 }]}>{body}</T> : null}
      {action ? <View style={styles.inset}>{action}</View> : null}
      {ideas?.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}>
          {ideas.map(([label, fn]) => <Chip key={label} label={label} onPress={fn} />)}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  es: { gap: 12, paddingTop: 14, paddingHorizontal: 14, paddingBottom: 18, borderRadius: radii.hero, backgroundColor: colors.paper },
  inset: { marginHorizontal: 4 },
  stage: { borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(125,93,39,0.1)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingStart: 12, paddingEnd: 14, borderRadius: 22, backgroundColor: colors.paper },
  tile: { width: 80, height: 64, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f6efe2', borderWidth: 1, borderColor: 'rgba(125,93,39,0.1)' },
});
