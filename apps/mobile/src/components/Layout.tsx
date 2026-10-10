import type { ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { colors, space, ff } from '@/theme';
import { Icon } from './Icon';
import { T } from './Text';

/** Top inset: the real one on a phone; the prototype's status-bar height on the web preview. */
export function useTopInset() {
  const i = useSafeAreaInsets();
  return Math.max(i.top, Platform.OS === 'web' ? 44 : 20);
}
export function useBottomInset() {
  return Math.max(useSafeAreaInsets().bottom, 0);
}

/** A full screen on the sand canvas (or green-black for dark moments). */
export function Screen({ children, dark, background, style }: { children: ReactNode; dark?: boolean; background?: string; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.screen, { backgroundColor: background ?? (dark ? colors.green : colors.sand) }, style]}>{children}</View>;
}

/** Back on the start side, an optional title, an optional action on the end side. Back is also a swipe; this is the backup. */
export function TopBar({ onBack, backLabel, title, right, dark }: { onBack?: () => void; backLabel?: string; title?: string; right?: ReactNode; dark?: boolean }) {
  const top = useTopInset();
  const fg = dark ? colors.onDark : colors.green;
  return (
    <View style={[styles.topbar, { paddingTop: top + 10 }]}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel={backLabel ?? t('common.back')} onPress={() => { buzz('tap'); onBack(); }} style={styles.back} hitSlop={8}>
          <Icon name="back" color={fg} />
          <T v="callout" color={fg} style={{ fontFamily: ff.ui500, fontSize: 15 }}>{backLabel ?? t('common.back')}</T>
        </Pressable>
      ) : <View style={{ width: 44 }} />}
      {title ? <T v="h3" color={fg} style={{ fontSize: 17 }}>{title}</T> : null}
      {right ?? <View style={{ width: 44 }} />}
    </View>
  );
}

/** The Act zone: the one primary action, at the bottom where the thumb is (EXPERIENCE.md §3.1). */
export function Act({ children, aboveDock }: { children: ReactNode; aboveDock?: boolean }) {
  const bottom = useBottomInset();
  return <View style={[styles.act, { bottom: (aboveDock ? 102 : 28) + bottom }]}>{children}</View>;
}

/** Scrolling content with the 20-point gutter; leaves room for the dock or the Act zone. */
export function Scroll({ children, bottomPad = 140, gutter = space.gutter, contentStyle, top = 0 }: { children: ReactNode; bottomPad?: number; gutter?: number; contentStyle?: StyleProp<ViewStyle>; top?: number }) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={[{ paddingHorizontal: gutter, paddingBottom: bottomPad, paddingTop: top, gap: 16 }, contentStyle]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, overflow: 'hidden' },
  topbar: { paddingHorizontal: 16, paddingBottom: 8, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  back: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 2, paddingStart: 4, paddingEnd: 12, borderRadius: 999 },
  act: { position: 'absolute', start: 20, end: 20, gap: 10, zIndex: 5 },
});
