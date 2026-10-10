import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { buzz } from '@/lib/haptics';
import { dirSign, t, tn } from '@/lib/i18n';
import { SHOW_DEMO_HINTS } from '@/lib/config';
import { fmtDate } from '@/lib/wallet-model';
import { fileSource } from '@/lib/wallet';
import { colors, ff, radii } from '@/theme';
import { Button } from '../Button';
import { Field } from '../Field';
import { Icon, type IconName } from '../Icon';
import { T } from '../Text';

/* The account screens' kit (prototype css/account.css): grouped rows, sources, status pills, the toggle, avatars. */

/** iOS-style switch: gold when on (prototype .toggle). */
export function Toggle({ value, onChange, label, disabled, onDark, testID }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; onDark?: boolean; testID?: string }) {
  const x = useSharedValue(value ? 1 : 0);
  useEffect(() => { x.set(withSpring(value ? 1 : 0, { damping: 18, stiffness: 260 })); }, [value, x]);
  const dir = dirSign();
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() * 20 * dir }] }));
  return (
    <Pressable testID={testID} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled: !!disabled }} disabled={disabled}
      onPress={() => { buzz('select'); onChange(!value); }} hitSlop={6}
      style={[styles.toggle, { backgroundColor: value ? colors.gold : onDark ? 'rgba(233,226,216,0.24)' : 'rgba(30,53,45,0.2)' }, disabled ? { opacity: 0.4 } : null]}>
      <Animated.View style={[styles.knob, knob]} />
    </Pressable>
  );
}

export function Group({ label, children, well, style }: { label?: string; children: ReactNode; well?: boolean; style?: StyleProp<ViewStyle> }) {
  const items = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  return (
    <View style={[{ gap: 8 }, style]}>
      {label ? <T v="eyebrow" style={{ paddingHorizontal: 4 }}>{label}</T> : null}
      <View style={[styles.group, well ? { backgroundColor: colors.mist } : null]}>
        {items.map((c, i) => <View key={i} style={i ? styles.sep : null}>{c}</View>)}
      </View>
    </View>
  );
}

export function Row({ icon, lead, label, value, sub, src, onPress, right, danger, locked, accessibilityLabel, testID }: {
  icon?: IconName; lead?: ReactNode; label?: string; value: ReactNode; sub?: ReactNode; src?: ReactNode; onPress?: () => void; right?: ReactNode;
  danger?: boolean; locked?: boolean; accessibilityLabel?: string; testID?: string;
}) {
  const inner = (
    <>
      {lead ?? (icon ? <View style={styles.ic}><Icon name={icon} size={20} color={danger ? colors.badInk : colors.green} /></View> : null)}
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        {label ? <T v="caption" color={colors.ink3} style={{ fontFamily: ff.ui600 }}>{label}</T> : null}
        {typeof value === 'string' ? <T v="h3" style={{ fontSize: 15, lineHeight: 20 }} color={danger ? colors.badInk : colors.green}>{value}</T> : value}
        {sub ? (typeof sub === 'string' ? <T v="tiny">{sub}</T> : sub) : null}
        {src}
      </View>
      {right !== undefined ? right : locked ? <Icon name="lock" size={16} color={colors.muted} /> : onPress ? <Icon name="chevron" size={18} color={colors.muted} /> : null}
    </>
  );
  return onPress
    ? <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? (typeof value === 'string' ? (label ? `${label}, ${value}` : value) : label)} onPress={() => { buzz('tap'); onPress(); }} style={({ pressed }) => [styles.row, pressed ? { backgroundColor: 'rgba(30,53,45,0.05)' } : null]}>{inner}</Pressable>
    : <View testID={testID} style={styles.row}>{inner}</View>;
}

export type SourceKind = 'passport' | 'typed' | 'apple' | 'google' | 'signup' | 'verified' | 'default' | 'none' | 'added';
const SRC: Record<SourceKind, [IconName, Parameters<typeof t>[0]]> = {
  passport: ['scan', 'account.src.passport'], typed: ['user', 'account.src.typed'], apple: ['lock', 'account.src.apple'], google: ['lock', 'account.src.google'],
  signup: ['check', 'account.src.signup'], verified: ['check', 'account.src.verified'], default: ['gear', 'account.src.default'], none: ['scan', 'account.src.none'], added: ['user', 'account.src.added'],
};
/** Where a detail came from (Account.jsx Source). */
export function Source({ kind, at, warn }: { kind?: SourceKind; at?: string | null; warn?: string }) {
  if (warn) return <T v="caption" color={colors.goldInk} style={{ marginTop: 2 }}>{warn}</T>;
  const [icon, key] = SRC[kind ?? 'default'];
  const good = kind === 'verified' || kind === 'signup';
  const text = kind === 'verified' && at ? t('account.src.verifiedOn', { date: fmtDate(at) }) : `${t(key)}${at ? ` · ${fmtDate(at)}` : ''}`;
  const c = good ? colors.ok : colors.ink3;
  return <View style={styles.src}><Icon name={icon} size={12} width={2.2} color={c} /><T v="caption" color={c} style={{ fontSize: 12 }}>{text}</T></View>;
}

const PILL = { ok: [colors.ok, 'rgba(47,122,75,0.12)'], gold: [colors.goldInk, colors.warnWash], warn: [colors.badInk, '#f4ddd5'], muted: [colors.ink2, colors.mist] } as const;
export function StatusPill({ label, tone }: { label: string; tone: keyof typeof PILL }) {
  const [fg, bg] = PILL[tone];
  return <View style={[styles.pill, { backgroundColor: bg }]}><T v="caption" color={fg} style={{ fontFamily: ff.ui600 }} numberOfLines={1}>{label}</T></View>;
}

/** A notice card: quiet (paper), or warn (gold wash). */
export function Notice({ icon = 'lock', title, body, warn, children, testID }: { icon?: IconName; title?: string; body?: string; warn?: boolean; children?: ReactNode; testID?: string }) {
  return (
    <View testID={testID} accessibilityRole={warn ? 'alert' : undefined} style={[styles.notice, { backgroundColor: warn ? colors.warnWash : colors.mist }]}>
      <Icon name={icon} size={18} color={warn ? colors.goldInk : colors.green} />
      <View style={{ flex: 1, gap: 4 }}>
        {title ? <T v="h3" style={{ fontSize: 15 }}>{title}</T> : null}
        {body ? <T v="small">{body}</T> : null}
        {children}
      </View>
    </View>
  );
}

export function Spinner({ light }: { light?: boolean }) {
  return <ActivityIndicator size="small" color={light ? colors.mist : colors.green} />;
}

/** The account holder's photo, or their initial on green. */
export function UserAvatar({ size = 40, initial, hasPhoto, ring, photoKey }: { size?: number; initial?: string; hasPhoto?: boolean; ring?: string; photoKey?: string | null }) {
  const style = { width: size, height: size, borderRadius: 999, ...(ring ? { borderWidth: 2, borderColor: ring } : null) };
  if (hasPhoto) {
    const src = fileSource('/account/photo');
    return <Image source={{ uri: `${src.uri}?v=${photoKey ?? ''}`, headers: src.headers }} style={[style, { backgroundColor: colors.stage }]} contentFit="cover" accessibilityElementsHidden />;
  }
  return (
    <View style={[style, { backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {initial ? <T style={{ fontFamily: ff.ui600, fontSize: size * 0.4, lineHeight: size * 0.5, color: colors.sand }}>{initial.toUpperCase()}</T> : <Icon name="user" size={size * 0.45} color={colors.mist} />}
    </View>
  );
}

export function PersonAvatar({ initial, helper, size = 44 }: { initial: string; helper?: boolean; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: 999, backgroundColor: helper ? colors.goldWash : colors.mist, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden>
      <T style={{ fontFamily: ff.ui600, fontSize: size * 0.4, lineHeight: size * 0.5, color: colors.green }}>{(initial || '?').toUpperCase()}</T>
    </View>
  );
}

function Dot({ i, a, color }: { i: number; a: { get: () => number }; color: string }) {
  const st = useAnimatedStyle(() => ({ opacity: 0.3 + 0.7 * Math.max(0, Math.sin(Math.PI * (a.get() * 1.5 - i * 0.2))) }));
  return <Animated.View style={[{ width: 6, height: 6, borderRadius: 9, backgroundColor: color }, st]} />;
}

/** Three dots that pulse while someone types. */
export function TypingDots({ color = colors.ink3 }: { color?: string }) {
  const a = useSharedValue(0);
  useEffect(() => {
    let on = true;
    const loop = () => { if (!on) return; a.set(0); a.set(withTiming(1, { duration: 1200 })); setTimeout(loop, 1200); };
    loop();
    return () => { on = false; };
  }, [a]);
  return <View style={{ flexDirection: 'row', gap: 3, paddingVertical: 6 }}>{[0, 1, 2].map((i) => <Dot key={i} i={i} a={a} color={color} />)}</View>;
}

/**
 * Six digits sent by text or email (Account.jsx CodeStep): wrong tries count down to a lock, a new code after 30 s.
 * `check` returns null when the code was right, or the server's answer.
 */
export function CodeStep({ to, onBack, check, resend, testID = 'code' }: {
  to: string; onBack?: () => void; check: (code: string) => Promise<null | { triesLeft?: number; locked?: boolean; message?: string }>; resend?: () => Promise<void>; testID?: string;
}) {
  const [code, setCode] = useState('');
  const [left, setLeft] = useState(30);
  const [problem, setProblem] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => { timer.current = setInterval(() => setLeft((n) => (n > 0 ? n - 1 : 0)), 1000); return () => { if (timer.current) clearInterval(timer.current); }; }, []);
  const submit = async (v: string) => {
    setBusy(true);
    const r = await check(v);
    setBusy(false);
    if (!r) { buzz('success'); return; }
    buzz('soft');
    setCode('');
    if (r.locked) { setLocked(true); setProblem(t('account.code.locked')); return; }
    setProblem(r.message ?? (r.triesLeft !== undefined ? tn('account.code.wrong', r.triesLeft) : t('error.internal')));
  };
  return (
    <View style={{ gap: 16 }}>
      <T v="h2" accessibilityRole="header">{t('account.code.title')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <T v="body">{t('account.code.sentTo', { to })}</T>
        {onBack ? <Pressable accessibilityRole="button" onPress={onBack}><T v="h3" style={{ textDecorationLine: 'underline', fontSize: 15 }}>{t('account.code.change')}</T></Pressable> : null}
      </View>
      <Field label={t('account.code.label')} value={code} big bad={!!problem && !locked} error={problem} editable={!locked && !busy} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} testID={`${testID}-input`}
        onChangeText={(v) => { const d = v.replace(/\D/g, '').slice(0, 6); setCode(d); if (d.length === 6) submit(d); }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {left > 0 && !locked
          ? <T v="small" style={{ fontVariant: ['tabular-nums'] }}>{t('account.code.newIn', { seconds: String(left).padStart(2, '0') })}</T>
          : <Button variant="secondary" size="small" block={false} label={t('account.code.resend')} onPress={async () => { await resend?.(); setLocked(false); setProblem(null); setLeft(30); }} />}
        {SHOW_DEMO_HINTS ? <T v="tiny">{t('account.code.demo')}</T> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { width: 52, height: 32, borderRadius: 999, padding: 3, justifyContent: 'center' },
  knob: { width: 26, height: 26, borderRadius: 999, backgroundColor: colors.white, boxShadow: '0px 2px 6px rgba(0,0,0,0.25)' },
  group: { backgroundColor: colors.paper, borderRadius: radii.card, overflow: 'hidden' },
  sep: { borderTopWidth: 1, borderTopColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, minHeight: 56 },
  ic: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
  src: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  pill: { height: 26, paddingHorizontal: 10, borderRadius: 999, justifyContent: 'center', alignSelf: 'flex-start' },
  notice: { borderRadius: radii.notice, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
});
