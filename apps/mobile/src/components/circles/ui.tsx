import { forwardRef, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { Image, type ImageSource } from 'expo-image';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import type { PersonRef } from '@mada/shared';
import { Avatar } from '@/components/Avatar';
import { VGradient } from '@/components/Gradient';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { dirSign } from '@/lib/i18n';
import { colors, ff, font, radii, sizes } from '@/theme';

/* Small pieces every Circles screen shares, drawn after the prototype's classes (person-row, tickbox, toggle, tabs-text). */

export const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

/** A person's face: their initial on their colour. */
export function Face({ p, size = 40, ring }: { p: Pick<PersonRef, 'initial' | 'tone'> | null | undefined; size?: number; ring?: string }) {
  return <Avatar initial={p?.initial || '?'} tone={p?.tone ?? 'default'} size={size} ring={ring} />;
}

/** Overlapping faces. */
export function Faces({ people, size = 30, ring = colors.paper, overlap = 10 }: { people: Pick<PersonRef, 'id' | 'initial' | 'tone'>[]; size?: number; ring?: string; overlap?: number }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {people.map((p, i) => <View key={p.id + i} style={{ marginStart: i ? -overlap : 0 }}><Face p={p} size={size} ring={ring} /></View>)}
    </View>
  );
}

/** A row for a person: face, name, one line, and an action at the end. */
export function PersonRow({ p, sub, right, onPress, on, style, testID, a11y }: { p: PersonRef; sub?: string | null; right?: ReactNode; onPress?: () => void; on?: boolean; style?: StyleProp<ViewStyle>; testID?: string; a11y?: string }) {
  const inner = (
    <>
      <Face p={p} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T v="h3" style={{ fontSize: 15 }} numberOfLines={1}>{p.name}</T>
        {sub ? <T v="tiny" numberOfLines={2}>{sub}</T> : null}
      </View>
      {right}
    </>
  );
  const s = [styles.personRow, on ? styles.personOn : null, style];
  if (!onPress) return <View style={s} testID={testID}>{inner}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={a11y ?? p.name} accessibilityState={on === undefined ? undefined : { selected: on }}
      onPress={() => { buzz('select'); onPress(); }} style={({ pressed }) => [s, pressed ? { transform: [{ scale: 0.985 }] } : null]}>
      {inner}
    </Pressable>
  );
}

export function Tick({ on }: { on: boolean }) {
  return <View style={[styles.tick, on ? styles.tickOn : null]}>{on ? <Icon name="check" size={14} color={colors.mist} width={2.6} /> : null}</View>;
}

/** The prototype's toggle: 52×32, gold when on. */
export function Toggle({ value, onChange, label, onDark }: { value: boolean; onChange: (v: boolean) => void; label: string; onDark?: boolean }) {
  const dir = dirSign();
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: withTiming(value ? 20 * dir : 0, { duration: 260 }) }] }));
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }} onPress={() => { buzz('select'); onChange(!value); }} hitSlop={6}
      style={[styles.toggle, { backgroundColor: value ? colors.gold : onDark ? 'rgba(233,226,216,0.24)' : 'rgba(30,53,45,0.2)' }]}>
      <Animated.View style={[styles.knob, knob]} />
    </Pressable>
  );
}

/** Text tabs: "Discover  Circles", the big way the prototype switches views. */
export function TabsText<K extends string>({ tabs, value, onChange, size = 30, label }: { tabs: [K, string, number?][]; value: K; onChange: (k: K) => void; size?: number; label: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 18, alignItems: 'baseline', flexWrap: 'wrap' }} accessibilityRole="tablist" accessibilityLabel={label}>
      {tabs.map(([k, l, n]) => (
        <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: value === k }} onPress={() => { buzz('select'); onChange(k); }} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <T style={[font('h1', value === k ? colors.green : colors.muted), { fontSize: size, lineHeight: size * 1.15 }]}>{l}</T>
          {n ? <T style={{ fontFamily: ff.ui700, fontSize: 11, color: colors.goldInk, marginStart: 3, marginTop: 2 }}>{n}</T> : null}
        </Pressable>
      ))}
    </View>
  );
}

/** A section heading with something on the end ("See all", a count). */
export function Head({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.spread}>
      <T v="h2" accessibilityRole="header">{title}</T>
      {typeof right === 'string' ? <T v="tiny">{right}</T> : right}
    </View>
  );
}

export function Eyebrow({ children, color }: { children: string; color?: string }) {
  return <T v="eyebrow" color={color}>{children}</T>;
}

/** An underlined text action. */
export function TextLink({ label, onPress, size = 14, color = colors.green, testID }: { label: string; onPress: () => void; size?: number; color?: string; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={() => { buzz('tap'); onPress(); }} hitSlop={8} style={{ paddingVertical: 4 }}>
      <T style={{ fontFamily: ff.ui600, fontSize: size, color, textDecorationLine: 'underline' }}>{label}</T>
    </Pressable>
  );
}

export const Input = forwardRef<TextInput, TextInputProps & { bad?: boolean }>(function Input({ style, bad, ...p }, ref) {
  return <TextInput ref={ref} placeholderTextColor={colors.muted} {...p} style={[styles.input, font('body', colors.green), { fontSize: 17 }, bad ? { borderColor: colors.bad } : null, webNoOutline, style]} />;
});

/** A card you tap in a sheet: a title and one line ("Don't show me Noor here · She isn't told."). */
export function ChoiceCard({ title, sub, danger, onPress, selected, testID }: { title: string; sub?: string; danger?: boolean; onPress: () => void; selected?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={() => { buzz('tap'); onPress(); }} style={({ pressed }) => [styles.choice, selected ? styles.choiceOn : null, pressed ? { transform: [{ scale: 0.985 }] } : null]}>
      <T v="h3" style={{ fontSize: 15 }} color={danger ? colors.badInk : colors.green}>{title}</T>
      {sub ? <T v="tiny">{sub}</T> : null}
    </Pressable>
  );
}

/** A photo filling its box, with the veil that keeps white text readable at any point of the image. */
export function PhotoFill({ source, veil = 'cx', position }: { source: ImageSource | number | null; veil?: 'cx' | 'story' | 'shade' | 'none'; position?: string }) {
  const id = useWindowDimensions().width; // gradients need distinct ids per size on web only cosmetically
  const stops: Record<string, [number, string][]> = {
    cx: [[0, 'rgba(15,26,22,0.28)'], [0.3, 'rgba(15,26,22,0.08)'], [0.58, 'rgba(15,26,22,0.45)'], [1, 'rgba(15,26,22,0.86)']],
    story: [[0, 'rgba(15,26,22,0.35)'], [0.28, 'rgba(15,26,22,0)'], [0.45, 'rgba(15,26,22,0.15)'], [1, 'rgba(15,26,22,0.88)']],
    shade: [[0, 'rgba(15,26,22,0.05)'], [0.25, 'rgba(15,26,22,0.05)'], [1, 'rgba(15,26,22,0.78)']],
    none: [],
  };
  return (
    <>
      {source ? <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={position as never} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.green }]} />}
      {veil !== 'none' ? <VGradient id={`v-${veil}-${id}`} stops={stops[veil]!} /> : null}
    </>
  );
}

/** Frosted buttons on photos ("Book with Mada", the bookmark). */
export function GlassButton({ label, onPress, on, icon, after, a11y, testID }: { label?: string; onPress?: () => void; on?: boolean; icon?: ReactNode; after?: ReactNode; a11y?: string; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={a11y ?? label} accessibilityState={on === undefined ? undefined : { selected: on }} disabled={!onPress}
      onPress={() => { buzz('select'); onPress?.(); }} style={({ pressed }) => [styles.glass, on ? styles.glassOn : null, pressed ? { transform: [{ scale: 0.97 }] } : null]}>
      {icon}
      {label ? <T style={{ fontFamily: ff.ui600, fontSize: 14, color: on ? colors.green : colors.paper }}>{label}</T> : null}
      {after}
    </Pressable>
  );
}

/** A sheet's content that can be longer than the screen. */
export function SheetScroll({ children }: { children: ReactNode }) {
  const { height } = useWindowDimensions();
  return (
    <ScrollView style={{ maxHeight: height * 0.78, marginHorizontal: -24 }} contentContainerStyle={{ paddingHorizontal: 24, gap: 14, paddingBottom: 4 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

export function Row({ children, gap = 10, wrap, style }: { children: ReactNode; gap?: number; wrap?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, wrap ? { flexWrap: 'wrap' } : null, style]}>{children}</View>;
}

/** Ghost chips for quick choices: gold outline. */
export function GhostChip({ label, onPress, on }: { label: string; onPress: () => void; on?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={on === undefined ? undefined : { selected: on }} onPress={() => { buzz('select'); onPress(); }}
      style={({ pressed }) => [styles.ghost, on ? { backgroundColor: colors.green, borderColor: colors.green } : null, pressed ? { transform: [{ scale: 0.97 }] } : null]}>
      <T style={{ fontFamily: ff.ui600, fontSize: 13, color: on ? colors.mist : colors.goldInk }}>{label}</T>
    </Pressable>
  );
}

/** A segmented control (Equally · By family · Custom). */
export function Segmented<K extends string>({ options, value, onChange, label }: { options: [K, string][]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <View style={styles.seg} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map(([k, l]) => (
        <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: value === k }} accessibilityLabel={l} onPress={() => { buzz('select'); onChange(k); }}
          style={[styles.segBtn, value === k ? styles.segOn : null]}>
          <T style={{ fontFamily: ff.ui600, fontSize: 14, color: value === k ? colors.green : colors.ink2 }}>{l}</T>
        </Pressable>
      ))}
    </View>
  );
}

/** A small round icon button (the "+" and people buttons in headers). */
export function RoundButton({ icon, onPress, dark, a11y, badge, size = 44, background, testID }: { icon: ReactNode; onPress: () => void; dark?: boolean; a11y: string; badge?: boolean; size?: number; background?: string; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={a11y} onPress={() => { buzz('tap'); onPress(); }} hitSlop={4}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: background ?? (dark ? colors.green : colors.paper) }, pressed ? { transform: [{ scale: 0.95 }] } : null]}>
      {icon}
      {badge ? <View style={styles.badge} /> : null}
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 18, backgroundColor: colors.paper },
  personOn: { backgroundColor: '#f3ead8', borderWidth: 1.5, borderColor: colors.gold, paddingVertical: 8.5, paddingHorizontal: 10.5 },
  tick: { width: 24, height: 24, borderRadius: 99, borderWidth: 1.5, borderColor: '#c9c1b4', alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: colors.green, borderColor: colors.green },
  toggle: { width: 52, height: 32, borderRadius: 999, padding: 3 },
  knob: { width: 26, height: 26, borderRadius: 999, backgroundColor: colors.white, boxShadow: '0px 2px 6px rgba(0,0,0,0.25)' },
  input: { height: sizes.input, borderRadius: radii.input, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, paddingHorizontal: 16 },
  choice: { borderRadius: radii.card, backgroundColor: colors.mist, padding: 16, gap: 2 },
  choiceOn: { borderWidth: 2, borderColor: colors.green, padding: 14 },
  glass: { height: 40, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,253,249,0.2)', backgroundColor: 'rgba(255,253,249,0.14)', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  glassOn: { backgroundColor: colors.gold, borderColor: 'transparent' },
  ghost: { height: 34, borderRadius: 999, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(185,143,74,0.45)' },
  seg: { flexDirection: 'row', backgroundColor: colors.mist, borderRadius: 14, padding: 4, gap: 4 },
  segBtn: { flex: 1, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.paper, boxShadow: '0px 2px 6px rgba(15,26,22,0.1)' },
  badge: { position: 'absolute', top: 6, end: 6, width: 9, height: 9, borderRadius: 99, backgroundColor: colors.goldDeep, borderWidth: 2, borderColor: colors.sand },
});
