import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useRouter } from 'expo-router';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { colors, ff, shadow, sizes } from '@/theme';
import { Icon, type IconName } from './Icon';
import { useBottomInset } from './Layout';
import { Sun } from './Sun';
import { T } from './Text';

const TABS: Record<string, { label: () => string; icon: IconName }> = {
  today: { label: () => t('tabs.today'), icon: 'home' },
  trips: { label: () => t('tabs.trips'), icon: 'trips' },
  circles: { label: () => t('tabs.circles'), icon: 'circles' },
  wallet: { label: () => t('tabs.wallet'), icon: 'wallet' },
};

/** The dock is never wider than this, and keeps 12 points from each edge on a small phone (320 points wide). */
const MAX_WIDTH = 372;

/**
 * The floating dock (EXPERIENCE.md §4.1): four tabs around the gold sun orb, each with its name under the icon, so
 * "where am I, where's home" never needs a guess. The tab you're on is the green one. Today is home: tapping it while
 * you're there takes Today back to the top (today.tsx listens for the tab press). The orb opens Ask over anything.
 */
export function Dock({ state, navigation }: BottomTabBarProps) {
  const router = useRouter();
  const bottom = useBottomInset();
  const { width } = useWindowDimensions();
  const routes = state.routes.filter((r) => TABS[r.name]);
  const items = [...routes.slice(0, 2).map((r) => ({ r })), { orb: true as const }, ...routes.slice(2).map((r) => ({ r }))];
  const dockWidth = Math.min(MAX_WIDTH, width - 24);
  // A 320-point phone: a little tighter, so "المجموعات" still fits whole.
  const narrow = width < 360;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: 18 + bottom }]}>
      <View style={[styles.dock, shadow('dock'), { width: dockWidth }, narrow ? styles.dockNarrow : null]} accessibilityRole="tablist">
        {items.map((it) => {
          if ('orb' in it) {
            return (
              <Pressable key="ask" accessibilityRole="button" accessibilityLabel={t('tabs.ask')} onPress={() => { buzz('tap'); router.push({ pathname: '/ask', params: { from: 'orb' } }); }}
                style={({ pressed }) => [styles.orb, narrow ? styles.orbNarrow : null, pressed ? { transform: [{ scale: 0.96 }] } : null]} testID="dock-ask">
                <Sun width={26} />
                <T style={[styles.label, narrow ? styles.labelNarrow : null, { color: colors.mist }]} numberOfLines={1}>{t('tabs.askShort')}</T>
              </Pressable>
            );
          }
          const { r } = it;
          const meta = TABS[r.name]!;
          const focused = state.routes[state.index]?.key === r.key;
          return (
            <Pressable key={r.key} accessibilityRole="tab" accessibilityLabel={meta.label()} accessibilityState={{ selected: focused }} testID={`dock-${r.name}`}
              onPress={() => {
                buzz('tap');
                // Tapping the tab you're on is heard by its screen (useScrollToTop): back to the top.
                const e = navigation.emit({ type: 'tabPress', target: r.key, canPreventDefault: true });
                if (!focused && !e.defaultPrevented) navigation.navigate(r.name);
              }}
              style={({ pressed }) => [styles.item, narrow ? { paddingHorizontal: 0 } : null, focused ? styles.on : null, pressed && !focused ? { backgroundColor: colors.mist } : null]}>
              <Icon name={meta.icon} size={22} color={focused ? colors.mist : colors.green} />
              <T style={[styles.label, narrow ? styles.labelNarrow : null, { color: focused ? colors.mist : colors.ink2 }]} numberOfLines={1}>{meta.label()}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', start: 0, end: 0, alignItems: 'center', zIndex: 20 },
  dock: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6, borderRadius: 34, backgroundColor: 'rgba(255,253,249,0.94)', borderWidth: 1, borderColor: 'rgba(30,53,45,0.08)' },
  item: { flex: 1, minWidth: 0, height: sizes.dockOrb, borderRadius: 24, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 2 },
  on: { backgroundColor: colors.green },
  label: { fontFamily: ff.ui600, fontSize: 11, lineHeight: 14, letterSpacing: 0.1, textAlign: 'center' },
  dockNarrow: { gap: 2, padding: 5 },
  labelNarrow: { fontSize: 10, letterSpacing: -0.1 },
  orbNarrow: { width: 56, height: 56 },
  orb: { width: sizes.dockOrb, height: sizes.dockOrb, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', gap: 1 },
});
