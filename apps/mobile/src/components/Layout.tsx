import type { ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useSegments } from 'expo-router';
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

/** Sign-up and sign-in screens keep their own way out (they lead to Welcome, not Today). */
const NO_HOME = new Set(['(onboarding)', 'recover', 'verify-phone', 'invite-code', 'auth-callback']);

/**
 * Back on the start side (top-left, top-right in Arabic), an optional title, an optional action on the end side.
 * Back is also the iOS swipe; this is the visible way. A screen opened from a link with nothing behind it gets Home
 * (to Today) instead of a Back that has nowhere to go. `home={false}` for a Back that steps within the screen.
 */
export function TopBar({ onBack, backLabel, title, right, dark, home = true }: { onBack?: () => void; backLabel?: string; title?: string; right?: ReactNode; dark?: boolean; home?: boolean }) {
  const top = useTopInset();
  const router = useRouter();
  const segments = useSegments() as string[];
  const fg = dark ? colors.onDark : colors.green;
  let goHome = false;
  try { goHome = !!onBack && home && !router.canGoBack() && !NO_HOME.has(segments[0] ?? ''); } catch { goHome = false; }
  const label = goHome ? t('common.home') : backLabel ?? t('common.back');
  const press = goHome ? () => router.replace('/today') : onBack;
  return (
    <View style={[styles.topbar, { paddingTop: top + 10 }]}>
      {press ? (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { buzz('tap'); press(); }} style={styles.back} hitSlop={8} testID={goHome ? 'topbar-home' : 'topbar-back'}>
          <Icon name={goHome ? 'home' : 'back'} size={goHome ? 20 : undefined} color={fg} />
          <T v="callout" color={fg} style={{ fontFamily: ff.ui500, fontSize: 15, marginStart: goHome ? 4 : 0 }}>{label}</T>
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
