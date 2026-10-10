import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors, font, radii, shadow } from '@/theme';
import { ArtStage } from '../EmptyState';
import { T } from '../Text';

/*
 * The frame every "something's not right" state shares, in the empty-state family: a drawing on the soft stage, one
 * display line saying what happened, one sentence saying what still works, one action (and at most one quiet second).
 *   full    fills the screen below the TopBar (a whole screen couldn't load)
 *   card    sits inside a screen (one section couldn't load)
 */
export function StateView({ art, eyebrow, title, body, works, note, primary, secondary, variant = 'full', gutter = 20, testID }: {
  /** What still works, one short line with a gold dot ("Your trips and Wallet still work offline"). */
  works?: string | null;
  /** Side padding for 'full' (0 when the screen's own scroll already has its gutter). */
  gutter?: number;
  /** A small gold label over the title (the crash screen's "Holding pattern"). */
  eyebrow?: string;
  art?: ReactNode; title: string; body?: string; note?: string | null; primary?: ReactNode; secondary?: ReactNode; variant?: 'full' | 'card'; testID?: string;
}) {
  const inner = (
    <Animated.View entering={FadeIn.duration(300)} style={[styles.card, shadow('card')]} accessibilityRole="summary" testID={testID}>
      {art ? <ArtStage height={variant === 'full' ? 156 : 124}>{art}</ArtStage> : null}
      {eyebrow ? <T v="eyebrow" color={colors.goldInk} style={[styles.inset, { marginBottom: -6 }]}>{eyebrow}</T> : null}
      <T style={[font('displaySmall'), styles.inset]} accessibilityRole="header">{title}</T>
      {body ? <T v="body" style={[styles.inset, { marginTop: -4 }]}>{body}</T> : null}
      {works ? (
        <View style={[styles.inset, styles.works]}>
          <View style={styles.worksDot} />
          <T v="small" style={{ flex: 1 }}>{works}</T>
        </View>
      ) : null}
      {primary || secondary ? <View style={[styles.inset, { gap: 10, marginTop: 4 }]}>{primary}{secondary}</View> : null}
      {note ? <T v="tiny" style={[styles.inset, { textAlign: 'center' }]} selectable>{note}</T> : null}
    </Animated.View>
  );
  if (variant === 'card') return inner;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.full, { paddingHorizontal: gutter }]} showsVerticalScrollIndicator={false}>
      {inner}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  full: { flexGrow: 1, justifyContent: 'center', paddingVertical: 24 },
  card: { gap: 12, paddingTop: 14, paddingHorizontal: 14, paddingBottom: 18, borderRadius: radii.hero, backgroundColor: colors.paper },
  inset: { marginHorizontal: 4 },
  works: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 14, backgroundColor: colors.mist },
  worksDot: { width: 7, height: 7, borderRadius: 4, marginTop: 6, backgroundColor: colors.goldDeep },
});
