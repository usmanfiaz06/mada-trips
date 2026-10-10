import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image, type ImageSource } from 'expo-image';
import Animated from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { durationLabel, formatSar } from '@mada/shared';
import { buzz } from '@/lib/haptics';
import { isRTL, t } from '@/lib/i18n';
import { rise } from '@/lib/motion';
import { colors, font, radii, ff } from '@/theme';
import { Chip } from '../Chip';
import { Icon, type IconName } from '../Icon';
import { Sun } from '../Sun';
import { T } from '../Text';

/* Pieces the booking screens share: photos, the working steps, one-question chips, notices, the route row. */

const PHOTOS: Record<string, ImageSource> = {
  'istanbul-galata': require('../../../assets/photos/istanbul-galata.jpg'),
  'riyadh-kingdom-centre': require('../../../assets/photos/riyadh-kingdom-centre.jpg'),
  'istanbul-bosphorus': require('../../../assets/photos/istanbul-bosphorus.jpg'),
  'istanbul-sultanahmet': require('../../../assets/photos/istanbul-sultanahmet.jpg'),
  'dubai-skyline': require('../../../assets/photos/dubai-skyline.jpg'),
  'cairo-pyramids': require('../../../assets/photos/cairo-pyramids.jpg'),
  'london-kensington': require('../../../assets/photos/london-kensington.jpg'),
  'baku-old-city': require('../../../assets/photos/baku-old-city.jpg'),
  'jeddah-al-balad': require('../../../assets/photos/jeddah-al-balad.jpg'),
  'alula-elephant-rock': require('../../../assets/photos/alula-elephant-rock.jpg'),
  'alula-hegra': require('../../../assets/photos/alula-hegra.jpg'),
  'abha-mountains': require('../../../assets/photos/abha-mountains.jpg'),
  'tbilisi-old-town': require('../../../assets/photos/tbilisi-old-town.jpg'),
  'maldives-overwater': require('../../../assets/photos/maldives-overwater.jpg'),
  'makkah-clock-tower': require('../../../assets/photos/makkah-clock-tower.jpg'),
  'madinah-green-dome': require('../../../assets/photos/madinah-green-dome.jpg'),
  'passport-boarding-pass': require('../../../assets/photos/passport-boarding-pass.jpg'),
  'inflight-window': require('../../../assets/photos/inflight-window.jpg'),
  'inflight-wing': require('../../../assets/photos/inflight-wing.jpg'),
  'hotel-room': require('../../../assets/photos/hotel-room.jpg'),
};

/** A photo from the shared library, cropped on its focal point. */
export function Photo({ name, focal, style }: { name: string; focal?: string; style?: StyleProp<ViewStyle> }) {
  const [x = '50%', y = '50%'] = (focal ?? '50% 50%').split(' ');
  return <Image source={PHOTOS[name] ?? PHOTOS['istanbul-galata']} style={[StyleSheet.absoluteFill, style as object]} contentFit="cover" contentPosition={{ left: x, top: y }} transition={200} accessible={false} />;
}

export const sar = (amount: number) => formatSar(amount);

/**
 * The prototype's rise, on native. On the web, Reanimated's entering animations inside a scroll view leave elements
 * absolutely positioned (they overlap the next ones), so the web export shows them still.
 */
export const enter = (step = 0) => (Platform.OS === 'web' ? undefined : rise(step));

/** The ticking clock for holds and waits. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

/** Mada shows its work: the sun thinks, the steps tick off one by one. */
export function Working({ lines, step }: { lines: string[]; step: number }) {
  return (
    <Animated.View entering={enter(0)} style={styles.working}>
      <View style={{ marginTop: 2 }}><Sun width={34} color={colors.goldDeep} /></View>
      <View style={{ flex: 1, gap: 14 }}>
        {lines.map((text, i) => (i > step ? null : (
          <View key={text} style={styles.step}>
            <View style={styles.mark}>
              {i < step ? <Icon name="check" color={colors.ok} width={2.4} size={20} /> : <ActivityIndicator size="small" color={colors.goldDeep} />}
            </View>
            <T v="body" color={colors.green}>{text}</T>
          </View>
        )))}
      </View>
    </Animated.View>
  );
}

/** Runs n steps, ms apart, whenever `run` changes. */
export function useSequence(n: number, ms: number, run: string | null) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (run === null) return undefined;
    const ts = [setTimeout(() => setStep(0), 0)];
    ts.push(...Array.from({ length: n }, (_, i) => setTimeout(() => setStep(i + 1), ms * (i + 1))));
    return () => ts.forEach(clearTimeout);
  }, [run, n, ms]);
  return step;
}

/** Chips that wrap onto lines. */
export function ChipWrap({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.wrap, style]}>{children}</View>;
}

/** One question, answered with a tap (EXPERIENCE.md §5). */
export function Ask1({ q, options, onPick }: { q: string; options: [string, string][]; onPick: (v: string) => void }) {
  return (
    <Animated.View entering={enter(0)} style={{ gap: 12 }}>
      <T v="h2" accessibilityRole="header">{q}</T>
      <ChipWrap>{options.map(([label, v]) => <Chip key={label} label={label} background={colors.paper} onPress={() => onPick(v)} />)}</ChipWrap>
    </Animated.View>
  );
}

/** A choice that can be on: the prototype's aria-pressed chip, green when chosen. */
export function Toggle({ label, on, onPress, small, hint, accessibilityLabel }: { label: string; on: boolean; onPress: () => void; small?: boolean; hint?: boolean; accessibilityLabel?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected: on }} onPress={() => { buzz('select'); onPress(); }}
      style={({ pressed }) => [styles.toggle, small ? styles.toggleSmall : null, { backgroundColor: on ? colors.green : colors.paper }, hint && !on ? styles.hint : null, pressed ? { transform: [{ scale: 0.97 }] } : null]}>
      <T style={[font('h3', on ? colors.mist : colors.green), small ? { fontSize: 13 } : { fontSize: 15 }]} numberOfLines={1}>{label}</T>
    </Pressable>
  );
}

export function Notice({ icon = 'doc', warn, title, children, iconColor }: { icon?: IconName; warn?: boolean; title?: string; children?: ReactNode; iconColor?: string }) {
  return (
    <View style={[styles.notice, { backgroundColor: warn ? colors.warnWash : colors.paper }]} accessibilityRole={warn ? 'alert' : undefined}>
      <Icon name={icon} color={iconColor ?? (warn ? colors.goldInk : colors.green)} />
      <View style={{ flex: 1, gap: 4 }}>
        {title ? <T v="h3">{title}</T> : null}
        {children}
      </View>
    </View>
  );
}

/** Two or three options in a pill (Return / One way; Economy / Premium / Business). */
export function Seg<V extends string>({ value, options, onChange, label }: { value: V; options: [V, string][]; onChange: (v: V) => void; label: string }) {
  return (
    <View style={styles.seg} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map(([v, l]) => (
        <Pressable key={v} accessibilityRole="radio" accessibilityState={{ checked: v === value }} onPress={() => { buzz('select'); onChange(v); }} style={[styles.segBtn, v === value ? styles.segOn : null]}>
          <T style={[font('h3', v === value ? colors.green : '#5d6a64'), { fontSize: 14 }]}>{l}</T>
        </Pressable>
      ))}
    </View>
  );
}

/** The flight as a line: times, codes, the duration and whether it stops. */
export function Leg({ dep, arr, from, to, durationMin, stop, onDark }: { dep: string; arr: string; from: string; to: string; durationMin: number; stop?: string | null; onDark?: boolean }) {
  const fg = onDark ? colors.onDark : colors.green;
  return (
    <View style={styles.route}>
      <View><T style={[styles.time, { color: fg }]}>{dep}</T><T style={styles.code}>{from}</T></View>
      <View style={styles.mid}>
        <View style={styles.line}><View style={styles.dash} /><View style={{ transform: isRTL() ? [{ scaleX: -1 }, { rotate: '45deg' }] : [{ rotate: '45deg' }] }}><Icon name="flight" size={16} color={fg} /></View><View style={styles.dash} /></View>
        <T v="tiny">{stop ? t('search.oneStop', { duration: durationLabel(durationMin) }) : t('search.direct', { duration: durationLabel(durationMin) })}</T>
      </View>
      <View style={{ alignItems: 'flex-end' }}><T style={[styles.time, { color: fg }]}>{arr}</T><T style={styles.code}>{to}</T></View>
    </View>
  );
}

/** An agent's initial on a green disc, for presence and replies. */
export function AgentDot({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden>
      <T style={[font('h3', colors.sand), { fontSize: size * 0.4, lineHeight: size * 0.5 }]}>{name.charAt(0).toUpperCase()}</T>
    </View>
  );
}

/** Mada itself (not a person): the sun on a green disc. */
export function MadaDot({ size = 32 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden>
      <Sun width={size * 0.62} color={colors.gold} />
    </View>
  );
}

/* ───────────── empty-state drawings (prototype ui.jsx) ───────────── */

function Board({ children }: { children: ReactNode }) {
  return <Svg width={176} height={132} viewBox="0 0 160 120" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{children}</Svg>;
}

export function ArtCalendar({ day = '9' }: { day?: string }) {
  return (
    <Board>
      <Rect x={48} y={30} width={64} height={66} rx={10} fill="#fffdf9" stroke="#1e352d" strokeWidth={2} />
      <Path d="M49 49 h62 v37 a9 9 0 0 1 -9 9 h-44 a9 9 0 0 1 -9 -9 z" fill="#fffdf9" stroke="#e3d6bf" strokeWidth={1} />
      <Circle cx={80} cy={72} r={15} fill="#f4e9d3" />
      <SvgText x={80} y={82} textAnchor="middle" fontSize={28} fill="#7d5d27" fontFamily={ff.display}>{day}</SvgText>
      <Rect x={48} y={30} width={64} height={18} rx={10} fill="#1e352d" />
      <Rect x={48} y={40} width={64} height={8} fill="#1e352d" />
      <Path d="M62 24 v12 M98 24 v12" stroke="#d9b77a" strokeWidth={3} strokeLinecap="round" />
    </Board>
  );
}

export function ArtSuitcase() {
  return (
    <Board>
      <Path d="M68 40 v-8 a5 5 0 0 1 5-5 h14 a5 5 0 0 1 5 5 v8" fill="none" stroke="#1e352d" strokeWidth={2.4} strokeLinejoin="round" />
      <Rect x={46} y={40} width={68} height={56} rx={11} fill="#fffdf9" stroke="#1e352d" strokeWidth={2.4} />
      <Path d="M62 40 v56 M98 40 v56" stroke="#d9b77a" strokeWidth={5} />
      <Path d="M46 62 h68" stroke="#e3d6bf" strokeWidth={1.5} />
      <Circle cx={58} cy={100} r={3.2} fill="#1e352d" /><Circle cx={102} cy={100} r={3.2} fill="#1e352d" />
      <Path d="M88 34 C 96 40, 104 44, 110 50" fill="none" stroke="#7d5d27" strokeWidth={1.5} />
      <G transform="rotate(14 116 60)"><Rect x={106} y={50} width={20} height={30} rx={4} fill="#d9b77a" stroke="#7d5d27" strokeWidth={1.5} /><Circle cx={116} cy={56} r={2} fill="#fffdf9" /><Path d="M110 66 h12 M110 72 h8" stroke="#7d5d27" strokeWidth={1.5} strokeLinecap="round" /></G>
    </Board>
  );
}

export function ArtMap() {
  return (
    <Board>
      <Path d="M30 32 L64 24 L64 94 L30 102 Z" fill="#fffdf9" stroke="#e3d6bf" strokeWidth={1.5} strokeLinejoin="round" />
      <Path d="M64 24 L98 32 L98 102 L64 94 Z" fill="#f4ecdd" stroke="#e3d6bf" strokeWidth={1.5} strokeLinejoin="round" />
      <Path d="M98 32 L132 24 L132 94 L98 102 Z" fill="#fffdf9" stroke="#e3d6bf" strokeWidth={1.5} strokeLinejoin="round" />
      <Path d="M36 50 h14 M36 58 h20 M104 74 h18 M104 82 h12" stroke="#e9dcc4" strokeWidth={2} strokeLinecap="round" />
      <Path d="M44 84 C 56 64, 70 82, 82 62 S 106 40, 118 46" fill="none" stroke="#b98f4a" strokeWidth={2.2} strokeDasharray="0.1 6" strokeLinecap="round" />
      <Circle cx={44} cy={84} r={4} fill="#1e352d" />
      <Path d="M118 47 c-6-7-9-11-9-15 a9 9 0 0 1 18 0 c0 4-3 8-9 15z" fill="#d9b77a" stroke="#7d5d27" strokeWidth={1.5} strokeLinejoin="round" />
      <Circle cx={118} cy={32} r={3} fill="#fffdf9" />
      <Ellipse cx={118} cy={50} rx={5} ry={1.6} fill="#1e352d" opacity={0.15} />
    </Board>
  );
}

const styles = StyleSheet.create({
  working: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mark: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toggle: { height: 40, borderRadius: 999, paddingHorizontal: 14, justifyContent: 'center' },
  toggleSmall: { height: 34, paddingHorizontal: 12 },
  hint: { borderWidth: 1.5, borderColor: colors.goldDeep },
  notice: { borderRadius: radii.notice, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  seg: { flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: colors.mist, gap: 4 },
  segBtn: { flex: 1, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.paper, boxShadow: '0px 2px 8px -4px rgba(15,26,22,0.35)' },
  route: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  time: { fontFamily: ff.ui600, fontSize: 24, letterSpacing: -0.7, lineHeight: 27, fontVariant: ['tabular-nums'] },
  code: { fontFamily: ff.ui600, fontSize: 12, letterSpacing: 1, color: colors.ink3 },
  mid: { flex: 1, alignItems: 'center', gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  dash: { flex: 1, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(30,53,45,0.3)' },
});
