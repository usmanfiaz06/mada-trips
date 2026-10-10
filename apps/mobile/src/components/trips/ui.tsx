import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image, type ImageSource } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import Animated from 'react-native-reanimated';
import { durationLabel } from '@mada/shared';
import { Icon, type IconName } from '@/components/Icon';
import { Act, Screen, Scroll, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { VGradient } from '@/components/Gradient';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useAgent as useAgentName } from '@/lib/trips';
import { rise } from '@/lib/motion';
import { colors, ff, font, radii, shadow } from '@/theme';

/* The trip companion's small pieces, drawn after the prototype's ui.jsx and css (today.css, trips.css, disruption.css). */

/* ───────── photos ───────── */

const PHOTOS: Record<string, ImageSource> = {
  'istanbul-galata': require('../../../assets/photos/istanbul-galata.jpg'),
  'istanbul-bosphorus': require('../../../assets/photos/istanbul-bosphorus.jpg'),
  'istanbul-sultanahmet': require('../../../assets/photos/istanbul-sultanahmet.jpg'),
  'turkish-breakfast': require('../../../assets/photos/turkish-breakfast.jpg'),
  'hotel-room': require('../../../assets/photos/hotel-room.jpg'),
  'inflight-window': require('../../../assets/photos/inflight-window.jpg'),
  'inflight-wing': require('../../../assets/photos/inflight-wing.jpg'),
  'riyadh-night': require('../../../assets/photos/riyadh-night.jpg'),
  'riyadh-kingdom-centre': require('../../../assets/photos/riyadh-kingdom-centre.jpg'),
  'airport-terminal': require('../../../assets/photos/airport-terminal.jpg'),
  'baku-old-city': require('../../../assets/photos/baku-old-city.jpg'),
  'abha-mountains': require('../../../assets/photos/abha-mountains.jpg'),
  'tbilisi-old-town': require('../../../assets/photos/tbilisi-old-town.jpg'),
  'alula-elephant-rock': require('../../../assets/photos/alula-elephant-rock.jpg'),
  'family-walking': require('../../../assets/photos/family-walking.jpg'),
  istanbul: require('../../../assets/images/istanbul.jpg'),
  alula: require('../../../assets/images/alula.jpg'),
  riyadh: require('../../../assets/images/riyadh.jpg'),
};
/** Focal points from docs/app/photos/photos.json, as "x% y%". */
const FOCAL: Record<string, string> = {
  'istanbul-galata': '35% 40%', 'istanbul-bosphorus': '55% 45%', 'turkish-breakfast': '50% 50%', 'hotel-room': '45% 55%', 'inflight-window': '50% 50%', 'riyadh-night': '45% 45%',
  'baku-old-city': '45% 55%', 'abha-mountains': '50% 50%', 'tbilisi-old-town': '50% 50%', 'alula-elephant-rock': '55% 55%', 'istanbul-sultanahmet': '50% 45%', 'riyadh-kingdom-centre': '45% 40%',
  'airport-terminal': '60% 35%', 'family-walking': '50% 60%', 'inflight-wing': '55% 50%',
};
export const photoOf = (key: string | null | undefined): ImageSource => PHOTOS[key ?? ''] ?? PHOTOS['istanbul-galata']!;
export const focalOf = (key: string | null | undefined, override?: string) => {
  const [left, top] = (override ?? FOCAL[key ?? ''] ?? '50% 50%').split(' ') as [`${number}%`, `${number}%`];
  return { left, top };
};

export function Photo({ k, uri, style, focal, children }: { k?: string | null; uri?: string; style?: StyleProp<ViewStyle>; focal?: string; children?: ReactNode }) {
  return (
    <View style={[{ overflow: 'hidden', borderRadius: radii.card, backgroundColor: colors.green2 }, style]}>
      <Image source={uri ? { uri } : photoOf(k)} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={focalOf(k, focal)} transition={200} />
      {children}
    </View>
  );
}

/** The prototype's .td-veil: dark at the top for the glass pills, darker at the bottom for the type. */
export const Veil = ({ id }: { id: string }) => <VGradient id={id} stops={[[0, 'rgba(15,26,22,0.38)'], [0.3, 'rgba(15,26,22,0)'], [0.48, 'rgba(15,26,22,0.1)'], [1, 'rgba(15,26,22,0.82)']]} />;
export const Shade = ({ id }: { id: string }) => <VGradient id={id} stops={[[0.25, 'rgba(15,26,22,0.05)'], [1, 'rgba(15,26,22,0.78)']]} />;

/* ───────── text bits ───────── */

export const Eyebrow = ({ children, color, style }: { children: ReactNode; color?: string; style?: StyleProp<object> }) => <T v="eyebrow" color={color} style={style}>{children}</T>;
export const Small = ({ children, color, style, lines }: { children: ReactNode; color?: string; style?: StyleProp<object>; lines?: number }) => <T v="small" color={color} style={style} numberOfLines={lines}>{children}</T>;
export const Tiny = ({ children, color, style, lines }: { children: ReactNode; color?: string; style?: StyleProp<object>; lines?: number }) => <T v="tiny" color={color} style={style} numberOfLines={lines}>{children}</T>;
export const H3 = ({ children, color, size, style, lines }: { children: ReactNode; color?: string; size?: number; style?: StyleProp<object>; lines?: number }) => <T v="h3" color={color} numberOfLines={lines} style={[size ? { fontSize: size, lineHeight: Math.round(size * 1.3) } : null, style]}>{children}</T>;
export const Num = ({ children, size = 15, color = colors.green, weight = 600, style }: { children: ReactNode; size?: number; color?: string; weight?: 500 | 600; style?: StyleProp<object> }) => (
  <T style={[{ fontFamily: weight === 600 ? ff.ui600 : ff.ui500, fontSize: size, lineHeight: Math.round(size * 1.15), color, fontVariant: ['tabular-nums'], letterSpacing: size > 30 ? -size * 0.03 : 0 }, style]}>{children}</T>
);
export const Display = ({ children, size = 40, color = colors.green, style, center }: { children: ReactNode; size?: number; color?: string; style?: StyleProp<object>; center?: boolean }) => (
  <T style={[font('display', color), { fontSize: size, lineHeight: Math.round(size * 1.05) }, center ? { textAlign: 'center' } : null, style]} accessibilityRole="header">{children}</T>
);

export const Dot = ({ color = colors.ok, size = 8 }: { color?: string; size?: number }) => <View style={{ width: size, height: size, borderRadius: 99, backgroundColor: color }} />;

/** A pill: default, ok, warn, gold, glass. */
export function Tag({ label, tone = 'default', icon, style }: { label: string; tone?: 'default' | 'ok' | 'warn' | 'gold' | 'glass' | 'when' | 'bad'; icon?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const bg = { default: colors.mist, ok: 'rgba(47,122,75,0.12)', warn: colors.warnWash, gold: colors.gold, glass: 'rgba(15,26,22,0.5)', when: 'rgba(217,183,122,0.92)', bad: colors.warnWash }[tone];
  const fg = { default: colors.green, ok: colors.ok, warn: '#7a3e12', gold: colors.green, glass: colors.paper, when: colors.green, bad: colors.badInk }[tone];
  return (
    <View style={[styles.tag, { backgroundColor: bg, height: tone === 'when' ? 28 : 26 }, tone === 'glass' ? styles.glass : null, style]}>
      {icon}
      <T style={{ fontFamily: ff.ui600, fontSize: tone === 'when' ? 13 : 12, lineHeight: 16, color: fg }} numberOfLines={1}>{label}</T>
    </View>
  );
}

/* ───────── cards and rows ───────── */

export function Box({ children, style, tone = 'paper', onPress, label, padding = 16, gap = 10, testID }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'paper' | 'well' | 'focal' | 'warn' | 'sand' | 'cream'; onPress?: () => void; label?: string; padding?: number; gap?: number; testID?: string;
}) {
  const bg = { paper: colors.paper, well: colors.mist, focal: colors.green, warn: colors.warnWash, sand: colors.sand, cream: '#f3ead8' }[tone];
  const s = [{ backgroundColor: bg, borderRadius: radii.card, padding, gap }, tone === 'focal' ? shadow('focal') : null, style];
  if (!onPress) return <View style={s} testID={testID}>{children}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={() => { buzz('tap'); onPress(); }} style={({ pressed }) => [s, pressed ? { transform: [{ scale: 0.985 }] } : null]}>
      {children}
    </Pressable>
  );
}

export const Row = ({ children, gap = 10, style, align = 'center' }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; align?: 'center' | 'flex-start' | 'flex-end' | 'baseline' }) => (
  <View style={[{ flexDirection: 'row', alignItems: align, gap }, style]}>{children}</View>
);
export const Spread = ({ children, style, align = 'center' }: { children: ReactNode; style?: StyleProp<ViewStyle>; align?: 'center' | 'flex-start' | 'flex-end' }) => (
  <View style={[{ flexDirection: 'row', alignItems: align, justifyContent: 'space-between', gap: 10 }, style]}>{children}</View>
);
export const Grow = ({ children, gap = 2, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) => <View style={[{ flex: 1, minWidth: 0, gap }, style]}>{children}</View>;
export const Divider = () => <View style={{ height: 1, backgroundColor: colors.line }} />;

/** A square icon tile (.tm-ic / .td-ic). */
export function IconTile({ name, tone = 'mist', size = 38, icon = 20, color }: { name: IconName; tone?: 'mist' | 'gold' | 'paper' | 'muted' | 'warn'; size?: number; icon?: number; color?: string }) {
  const bg = { mist: colors.mist, gold: colors.gold, paper: colors.paper, muted: colors.mist, warn: '#f3e6c9' }[tone];
  return <View style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: tone === 'muted' ? 0.5 : 1 }}><Icon name={name} size={icon} color={color ?? (tone === 'warn' ? colors.goldInk : colors.green)} /></View>;
}

/** A row in a grouped card (.tm-row). */
export function ListRow({ icon, title, sub, right, onPress, tone, first, testID }: { icon?: IconName; title: string; sub?: string | null; right?: ReactNode; onPress?: () => void; tone?: 'gold' | 'muted'; first?: boolean; testID?: string }) {
  const inner = (
    <>
      {icon ? <IconTile name={icon} tone={tone === 'gold' ? 'gold' : tone === 'muted' ? 'muted' : 'mist'} /> : null}
      <Grow gap={1} style={tone === 'muted' ? { opacity: 0.5 } : undefined}><H3 size={15}>{title}</H3>{sub ? <Tiny>{sub}</Tiny> : null}</Grow>
      {right}
      {onPress ? <Icon name="chevron" size={18} color={colors.ink3} /> : null}
    </>
  );
  const style = [styles.listRow, first ? null : styles.listRowLine];
  return onPress
    ? <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} onPress={() => { buzz('tap'); onPress(); }} style={({ pressed }) => [style, pressed ? { backgroundColor: colors.mist } : null]}>{inner}</Pressable>
    : <View style={style}>{inner}</View>;
}

/** A selectable card with a tick or a radio (.tm-pick). */
export function PickCard({ on, onPress, title, sub, right, disabled, note, radio, inSheet, testID }: {
  on: boolean; onPress: () => void; title: string; sub?: string | null; right?: string | null; disabled?: boolean; note?: ReactNode; radio?: boolean; inSheet?: boolean; testID?: string;
}) {
  return (
    <Pressable testID={testID} accessibilityRole={radio ? 'radio' : 'checkbox'} accessibilityState={{ checked: on, disabled: !!disabled }} accessibilityLabel={title} disabled={disabled}
      onPress={() => { buzz('select'); onPress(); }}
      style={({ pressed }) => [styles.pick, { backgroundColor: inSheet ? colors.mist : colors.paper }, on ? styles.pickOn : null, disabled ? { opacity: 0.55 } : null, pressed ? { transform: [{ scale: 0.985 }] } : null]}>
      <Spread align="flex-start">
        <Row align="flex-start" gap={12} style={{ flex: 1 }}>
          <View style={[styles.tick, radio ? { borderRadius: 99 } : null, on ? styles.tickOn : null]}>{on ? <Icon name="check" size={14} color={colors.mist} width={2.6} /> : null}</View>
          <Grow><H3 size={15}>{title}</H3>{sub ? <Tiny>{sub}</Tiny> : null}</Grow>
        </Row>
        {right ? <Num size={15}>{right}</Num> : null}
      </Spread>
      {note ? <View style={{ paddingStart: 36 }}>{typeof note === 'string' ? <Small color={colors.green}>{note}</Small> : note}</View> : null}
    </Pressable>
  );
}

/** A plain button-like text link (.td-link): underlined in gold. */
export function TextLink({ label, onPress, light, size = 14, testID }: { label: string; onPress: () => void; light?: boolean; size?: number; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={() => { buzz('tap'); onPress(); }} hitSlop={8} style={{ alignSelf: 'flex-start', paddingTop: light ? 0 : 4 }}>
      <T style={{ fontFamily: ff.ui600, fontSize: size, lineHeight: size + 6, color: light ? colors.gold : colors.green, textDecorationLine: 'underline', textDecorationColor: light ? 'rgba(217,183,122,0.5)' : 'rgba(185,143,74,0.6)' }}>{label}</T>
    </Pressable>
  );
}

/** A small pill button (.btn.small), for actions inside cards. */
export function SmallButton({ label, onPress, tone = 'secondary', icon, disabled, busy, testID, grow }: { label: string; onPress: () => void; tone?: 'primary' | 'secondary' | 'gold' | 'soft' | 'ghost' | 'paper'; icon?: IconName; disabled?: boolean; busy?: boolean; testID?: string; grow?: boolean }) {
  const bg = { primary: colors.green, secondary: colors.paper, gold: colors.gold, soft: colors.mist, ghost: 'transparent', paper: colors.paper }[tone];
  const fg = tone === 'primary' ? colors.mist : colors.green;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled || busy} onPress={() => { buzz('tap'); onPress(); }}
      style={({ pressed }) => [styles.small, { backgroundColor: bg }, grow ? { flex: 1 } : { alignSelf: 'flex-start' }, disabled ? { opacity: 0.45 } : null, pressed ? { transform: [{ scale: 0.97 }] } : null]}>
      {busy ? <ActivityIndicator color={fg} size="small" /> : (<>{icon ? <Icon name={icon} size={17} color={fg} /> : null}<T style={{ fontFamily: ff.ui600, fontSize: 14, lineHeight: 18, color: fg }} numberOfLines={1}>{label}</T></>)}
    </Pressable>
  );
}

/* ───────── flight bits ───────── */

/** "09:40 RUH ─ ✈ ─ 13:55 IST" with the duration under the plane (.route). */
export function RouteLine({ dep, arr, from, to, durationMin, big, direct = true, light }: { dep: string; arr: string; from: string; to: string; durationMin: number | null; big?: boolean; direct?: boolean; light?: boolean }) {
  const fg = light ? colors.paper : colors.green;
  return (
    <Row gap={10}>
      <View><Num size={big ? 26 : 24} color={fg}>{dep}</Num><T style={styles.code} >{from}</T></View>
      <View style={{ flex: 1, alignItems: 'center', gap: 3 }}>
        <Row gap={4} style={{ width: '100%' }}>
          <View style={[styles.dash, light ? { borderColor: 'rgba(255,253,249,0.4)' } : null]} />
          <Svg width={16} height={16} viewBox="0 0 24 24"><Path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" fill={fg} transform="rotate(90 12 12)" /></Svg>
          <View style={[styles.dash, light ? { borderColor: 'rgba(255,253,249,0.4)' } : null]} />
        </Row>
        {durationMin ? <Tiny color={light ? colors.onDark2 : undefined}>{durationLabel(durationMin)}{direct ? ` · ${t('trip.direct')}` : ''}</Tiny> : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}><Num size={big ? 26 : 24} color={fg}>{arr}</Num><T style={styles.code}>{to}</T></View>
    </Row>
  );
}

/** The airline's mark: its code on its colour (logos come from the content provider later). */
export function AirlineMark({ code, brand, size = 36, name }: { code: string; brand?: string | null; size?: number; name?: string }) {
  return (
    <View accessibilityLabel={name} style={{ width: size, height: size, borderRadius: size / 3, backgroundColor: brand ?? colors.green, alignItems: 'center', justifyContent: 'center' }}>
      <T style={{ color: '#fff', fontFamily: ff.ui700, fontSize: size * 0.36, lineHeight: size * 0.45 }}>{code}</T>
    </View>
  );
}

/** Grey cells with a key and a value (.cells): gate, boards, seats. */
export function Cells({ items }: { items: { k: string; v: string; flash?: boolean }[] }) {
  return (
    <Row gap={8}>
      {items.map((c) => (
        <View key={c.k} style={[styles.cell, c.flash ? { backgroundColor: colors.goldWash } : null]}>
          <T style={{ fontFamily: ff.ui500, fontSize: 12, lineHeight: 16, color: colors.ink3 }}>{c.k}</T>
          <Num size={20}>{c.v}</Num>
        </View>
      ))}
    </Row>
  );
}

/* ───────── progress ───────── */

/** A ring that fills on arrival. */
export function Ring({ done, total, size = 56, stroke = 6, dark }: { done: number; total: number; size?: number; stroke?: number; dark?: boolean }) {
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const full = done >= total;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessibilityLabel={`${done} of ${total}`}>
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={dark ? 'rgba(255,253,249,.14)' : '#efe9e0'} strokeWidth={stroke} />
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={full ? colors.okBright : colors.gold} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${C}`} strokeDashoffset={C * (1 - done / Math.max(1, total))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <SvgText x={size / 2} y={size / 2 + size * 0.1} textAnchor="middle" fontFamily={ff.ui600} fontSize={size * 0.27} fill={dark ? colors.paper : colors.green}>{full ? '✓' : `${done}/${total}`}</SvgText>
    </Svg>
  );
}

export type TrackerItem = { title: string; sub?: string | null; state: 'done' | 'now' | '' };
/** A vertical progress rail (.tracker). */
export function Tracker({ items }: { items: TrackerItem[] }) {
  return (
    <View>
      {items.map((it, i) => (
        <Row key={it.title} align="flex-start" gap={12}>
          <View style={{ width: 18, alignItems: 'center', alignSelf: 'stretch' }}>
            <View style={[styles.node, it.state === 'done' ? { backgroundColor: colors.ok } : it.state === 'now' ? { backgroundColor: colors.gold } : null]} />
            {i < items.length - 1 ? <View style={styles.bar} /> : null}
          </View>
          <View style={{ paddingBottom: 14, gap: 2, flex: 1 }}>
            <H3 size={15} color={it.state ? colors.green : colors.ink3}>{it.title}</H3>
            {it.sub ? <Tiny>{it.sub}</Tiny> : null}
          </View>
        </Row>
      ))}
    </View>
  );
}

/** A short list of what's happening (.steps): done, now (a spinner), to do. */
export function Steps({ items, light }: { items: { text: string; state: 'done' | 'now' | 'todo' }[]; light?: boolean }) {
  return (
    <View style={{ gap: 14 }}>
      {items.map((it) => (
        <Row key={it.text} gap={12}>
          <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
            {it.state === 'done' ? <Icon name="check" color={colors.ok} width={2.4} size={20} /> : it.state === 'now' ? <ActivityIndicator size="small" color={colors.goldDeep} /> : <Dot color="#d6cec2" />}
          </View>
          <T v="body" color={it.state === 'todo' ? colors.ink3 : light ? colors.paper : colors.green}>{it.text}</T>
        </Row>
      ))}
    </View>
  );
}

/* ───────── people ───────── */

/** The agent's face, with a green dot when online (.td-face). */
export function AgentFace({ initial, size = 36, online = true, ring = colors.sand }: { initial: string; size?: number; online?: boolean; ring?: string }) {
  return (
    <View style={{ width: size, height: size, borderRadius: 99, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden>
      <T style={{ color: colors.gold, fontFamily: ff.ui600, fontSize: size * 0.39, lineHeight: size * 0.5 }}>{initial}</T>
      {online ? <View style={{ position: 'absolute', end: -1, bottom: -1, width: 10, height: 10, borderRadius: 99, backgroundColor: colors.live, borderWidth: 2, borderColor: ring }} /> : null}
    </View>
  );
}

/**
 * "Faisal is with you today." / "Talk to Mada" (COPY.md §1: the action says Mada; the person is presence).
 * A quiet line with a face, not a big button. Opens the support thread (built in the Wallet area at /support).
 */
export function TalkLine({ note, agentInitial = 'F', dark, about }: { note: string; agentInitial?: string; dark?: boolean; about?: string }) {
  const router = useRouter();
  return (
    <Pressable testID="talk-line" accessibilityRole="button" accessibilityLabel={`${note} ${t('action.talk')}`} onPress={() => { buzz('tap'); router.push((about ? `/support?about=${encodeURIComponent(about)}` : '/support') as Href); }}
      style={({ pressed }) => [styles.talk, dark ? { borderTopColor: 'rgba(255,253,249,0.12)' } : null, pressed ? { opacity: 0.8 } : null]}>
      <AgentFace initial={agentInitial} ring={dark ? colors.green : colors.sand} />
      <Grow gap={0}>
        <T style={{ fontSize: 13, lineHeight: 17, color: dark ? colors.onDark2 : colors.ink2, fontFamily: ff.ui400 }}>{note}</T>
        <T style={{ fontSize: 15, lineHeight: 20, color: dark ? colors.paper : colors.green, fontFamily: ff.ui600 }}>{t('action.talk')}</T>
      </Grow>
      <Icon name="chevron" size={18} color={dark ? colors.onDark2 : colors.green} />
    </Pressable>
  );
}

/** "F · Faisal, your Mada agent" with a short line from him (.tm-faisal). */
export function AgentNote({ initial = 'F', children }: { initial?: string; children: ReactNode }) {
  return (
    <Row align="flex-start" gap={10}>
      <AgentFace initial={initial} size={32} online={false} />
      <View style={{ flex: 1, paddingTop: 6 }}><Small color={colors.green}>{children}</Small></View>
    </Row>
  );
}

/* ───────── screens ───────── */

/** A pushed trip screen: back bar with a title, scrolling content, and an optional Act zone at the bottom. */
export function TripScreen({ title, children, act, right, onBack, scrollRef }: { title?: string; children: ReactNode; act?: ReactNode; right?: ReactNode; onBack?: () => void; scrollRef?: never }) {
  const router = useRouter();
  void scrollRef;
  return (
    <Screen>
      <TopBar onBack={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/trips')))} title={title} right={right} />
      <Scroll top={4} bottomPad={act ? 220 : 60}>{children}</Scroll>
      {act ? (
        <View style={styles.actWrap} pointerEvents="box-none">
          <VGradient id="act-fade" stops={[[0, 'rgba(233,226,216,0)'], [0.26, colors.sand], [1, colors.sand]]} />
          <Act>{act}</Act>
        </View>
      ) : null}
    </Screen>
  );
}

/*
 * On the web, reanimated's entering animations stall on views that mount inside a hidden tab (they stay "running" and out
 * of the flow), so the web build rises with a plain CSS animation instead: same 12 points, 500 ms, 60 ms stagger.
 */
const webRise = (step: number) => ({
  animationKeyframes: [{ from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'translateY(0px)' } }],
  animationDuration: '500ms', animationDelay: `${step * 60}ms`, animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)', animationFillMode: 'both',
}) as unknown as ViewStyle;
/** The entering animation for an Animated.View: reanimated on phones, nothing on the web (use riseStyle there). */
export const riseOn = (step = 0) => (Platform.OS === 'web' ? undefined : rise(step));
/** The web's CSS rise, or nothing on phones. */
export const riseStyle = (step = 0): ViewStyle | null => (Platform.OS === 'web' ? webRise(step) : null);
export const Rise = ({ step = 0, children, style }: { step?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) => <Animated.View entering={riseOn(step)} style={[riseStyle(step), style]}>{children}</Animated.View>;

/** Re-renders every `ms`, for countdowns and live labels. */
export function useTicker(ms = 1000) {
  const [, setN] = useState(0);
  useEffect(() => { const id = setInterval(() => setN((n) => n + 1), ms); return () => clearInterval(id); }, [ms]);
}

/** A big round check (.tm-check / .dz-tick). */
export const BigCheck = ({ size = 60 }: { size?: number }) => (
  <View style={{ width: size, height: size, borderRadius: 99, backgroundColor: colors.ok, alignItems: 'center', justifyContent: 'center' }}><Icon name="check" color={colors.mist} size={size * 0.47} width={2.4} /></View>
);

const styles = StyleSheet.create({
  tag: { paddingHorizontal: 10, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  glass: { borderWidth: 1, borderColor: 'rgba(255,253,249,0.18)' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, padding: 10, borderRadius: 18 },
  listRowLine: { borderTopWidth: 1, borderTopColor: colors.line, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  pick: { borderRadius: radii.card, paddingVertical: 14, paddingHorizontal: 16, gap: 6 },
  pickOn: { borderWidth: 2, borderColor: colors.green, paddingVertical: 12, paddingHorizontal: 14 },
  tick: { width: 24, height: 24, borderRadius: 8, borderWidth: 1.5, borderColor: '#c9c1b4', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  tickOn: { backgroundColor: colors.green, borderColor: colors.green },
  small: { height: 40, paddingHorizontal: 16, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  code: { fontFamily: ff.ui600, fontSize: 12, lineHeight: 16, letterSpacing: 0.96, color: colors.ink3 },
  dash: { flex: 1, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(30,53,45,0.3)' },
  cell: { flex: 1, borderRadius: 16, backgroundColor: colors.sand, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  node: { width: 12, height: 12, borderRadius: 99, backgroundColor: '#d6cec2', marginTop: 4 },
  bar: { width: 2, flex: 1, backgroundColor: '#e3dcd1', minHeight: 20 },
  talk: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 14, paddingBottom: 8, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: colors.line, marginTop: 2 },
  actWrap: { position: 'absolute', start: 0, end: 0, bottom: 0, height: 210 },
});

/** "F · Faisal, your Mada agent": introducing the person on duty, once (COPY.md §1). */
export function AgentIntro() {
  const agent = useAgentName();
  return <Row><AgentFace initial={agent.initial} size={32} online={false} /><H3 size={14}>{t('actor.intro', { agent: agent.name })}</H3></Row>;
}
