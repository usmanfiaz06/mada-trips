import { Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useRouter } from 'expo-router';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { colors, font, shadow, sizes } from '@/theme';
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

/**
 * The floating dock (EXPERIENCE.md §4.1): four tabs around the gold sun orb. The active tab grows into a labelled
 * green pill. The orb opens Ask over whatever you're looking at.
 */
export function Dock({ state, navigation }: BottomTabBarProps) {
  const router = useRouter();
  const bottom = useBottomInset();
  const routes = state.routes.filter((r) => TABS[r.name]);
  const items = [...routes.slice(0, 2).map((r) => ({ r })), { orb: true as const }, ...routes.slice(2).map((r) => ({ r }))];

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: 22 + bottom }]}>
      <View style={[styles.dock, shadow('dock')]} accessibilityRole="tablist">
        {items.map((it) => {
          if ('orb' in it) {
            return (
              <Pressable key="ask" accessibilityRole="button" accessibilityLabel={t('tabs.ask')} onPress={() => { buzz('tap'); router.push('/ask'); }}
                style={({ pressed }) => [styles.orb, pressed ? { transform: [{ scale: 0.96 }] } : null]} testID="dock-ask">
                <Sun width={32} />
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
                const e = navigation.emit({ type: 'tabPress', target: r.key, canPreventDefault: true });
                if (!focused && !e.defaultPrevented) navigation.navigate(r.name);
              }}
              style={[styles.item, focused ? styles.on : null]}>
              <Icon name={meta.icon} color={focused ? colors.mist : colors.green} />
              {focused ? <T style={[font('h3', colors.mist), { fontSize: 14 }]}>{meta.label()}</T> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', start: 0, end: 0, alignItems: 'center', zIndex: 20 },
  dock: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6, borderRadius: 999, backgroundColor: 'rgba(255,253,249,0.9)', borderWidth: 1, borderColor: 'rgba(30,53,45,0.08)' },
  item: { width: sizes.dockItem, height: sizes.dockItem, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  on: { width: 'auto', paddingStart: 14, paddingEnd: 18, backgroundColor: colors.green },
  orb: { width: sizes.dockOrb, height: sizes.dockOrb, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
});
