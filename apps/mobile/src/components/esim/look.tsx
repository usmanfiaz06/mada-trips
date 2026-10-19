import { useEffect, useId } from 'react';
import { Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { DESTINATIONS, formatSar, type CopyKey, type EsimPlan, type EsimView } from '@mada/shared';
import { Photo } from '@/components/booking/parts';
import { VGradient } from '@/components/Gradient';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { BigCheck, Num, Rise, Row, Tag } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useReduceMotion } from '@/lib/motion';
import { colors, ff, font, radii, shadow } from '@/theme';
import { PopIn } from '../PopIn';

/*
 * How an eSIM looks: the place it's for as a photo, each plan as a size you can see, the eSIM itself as a card in Mada
 * green with what's left as a big ring, the same small in a list, and the three steps to get online.
 */

/** Credits for the photos the eSIM screens use (docs/app/photos/photos.json). */
const CREDIT: Record<string, string> = {
  'istanbul-galata': 'Anna Berdnik / Unsplash', 'dubai-skyline': 'Pratiksha Singh / Unsplash', 'cairo-pyramids': 'Andrés Dallimonti / Unsplash',
  'london-kensington': 'Igor Sporynin / Unsplash', 'baku-old-city': 'Azar Kazimli / Unsplash', 'tbilisi-old-town': 'Nikoloz Gachechiladze / Unsplash',
  'inflight-window': 'Leonardo Yip / Unsplash', 'maldives-overwater': 'Matheen Faiz / Unsplash', 'inflight-wing': 'Johny Goerend / Unsplash',
};

/** The flag of a country as its emoji ("TR" → 🇹🇷); empty for a region. */
export const flagOf = (code: string | null | undefined) =>
  code && /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '';

/** The one country of a coverage, or null for a region. */
export const countryOf = (countries: string[] | null | undefined) => (countries?.length === 1 ? countries[0]! : null);

/** Our photo of the place (the first city we sell there), with its credit; a window seat for regions. */
export function placePhotoOf(country: string | null) {
  const d = country ? Object.values(DESTINATIONS).find((x) => x.country === country) : null;
  const photo = d?.photo ?? 'inflight-wing';
  return { photo, credit: CREDIT[photo] ?? null };
}

/** "3.1 GB" / "620 MB" in the reader's words. */
export const sizeText = (mb: number) =>
  mb >= 1000 ? t('es.big.gb', { gb: Math.round((mb / 1024) * 10) / 10 }) : t('es.big.mb', { mb: Math.max(0, Math.round(mb)) });

/** The flag on a round, or a globe for a region. */
export function FlagDisc({ country, size = 40, light }: { country: string | null; size?: number; light?: boolean }) {
  const f = flagOf(country);
  return (
    <View style={[styles.disc, { width: size, height: size, backgroundColor: light ? 'rgba(255,253,249,0.16)' : colors.mist }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {f ? <T style={{ fontSize: size * 0.55, lineHeight: size * 0.72, textAlign: 'center' }}>{f}</T> : <Icon name="globe" size={size * 0.5} color={light ? colors.paper : colors.green} />}
    </View>
  );
}

/* ───────── the plans ───────── */

/** The place as a photo with room: the flag and the country on glass, the screen's serif line, the photo's credit. */
export function EsimHero({ country, where, title, testID }: { country: string | null; where: string; title: string; testID?: string }) {
  const { photo, credit } = placePhotoOf(country);
  const gid = `esim-hero-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View style={styles.hero} testID={testID}>
      <Photo name={photo} />
      <VGradient id={gid} stops={[[0, 'rgba(15,26,22,0.3)'], [0.32, 'rgba(15,26,22,0)'], [0.5, 'rgba(15,26,22,0.08)'], [1, 'rgba(15,26,22,0.84)']]} />
      <View style={styles.heroTop}>
        <View style={styles.glass}>
          {flagOf(country) ? <T style={{ fontSize: 15, lineHeight: 20 }}>{flagOf(country)}</T> : <Icon name="globe" size={16} color={colors.paper} />}
          <T style={{ fontFamily: ff.ui600, fontSize: 13, lineHeight: 18, color: colors.paper }} numberOfLines={1}>{where}</T>
        </View>
      </View>
      <View style={styles.heroFoot}>
        <T style={[font('displaySmall', colors.paper), { fontSize: 31, lineHeight: 34 }]} accessibilityRole="header">{title}</T>
        {credit ? <T style={{ fontSize: 10, lineHeight: 13, color: 'rgba(255,253,249,0.62)', fontFamily: ff.ui500 }} numberOfLines={1}>{t('things.photoBy', { credit })}</T> : null}
      </View>
    </View>
  );
}

/**
 * A plan as a size you can see: the data as the big number, a bar against the biggest plan shown, what it is a day
 * over the trip (never which apps: the data works for everything), whether it covers the trip, and the price each.
 */
export function PlanCard({ p, on, best, max, days, onPress, testID }: { p: EsimPlan; on: boolean; best: boolean; max: number; days: number; onPress: () => void; testID?: string }) {
  const unlimited = p.gb === null;
  const share = unlimited ? 1 : Math.max(0.08, Math.min(1, (p.daily ? p.gb! * p.days : p.gb!) / Math.max(1, max)));
  const perDay = unlimited ? t('es.perDay.unlimited') : p.daily ? t('es.perDay.daily', { gb: p.gb! }) : t('es.perDay', { gb: Math.round((p.gb! / Math.max(1, Math.min(days, p.days))) * 10) / 10 });
  const size = t(`es.size.${p.size}` as CopyKey);
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${size}, ${unlimited ? t('es.big.unlimited') : t('es.big.gb', { gb: p.gb! })}, ${t('es.days.n', { n: p.days })}, ${t('es.plan.each', { price: formatSar(p.price.amount) })}`}
      onPress={() => { buzz('select'); onPress(); }}
      style={({ pressed }) => [styles.plan, on ? styles.planOn : null, pressed ? { transform: [{ scale: 0.985 }] } : null]}>
      <Row style={{ justifyContent: 'space-between' }}>
        {best ? <Tag tone="gold" label={size} icon={<Icon name="star" size={12} width={2.2} />} /> : <T v="eyebrow">{size}</T>}
        <View style={[styles.radio, on ? styles.radioOn : null]}>{on ? <Icon name="check" size={14} color={colors.mist} width={2.6} /> : null}</View>
      </Row>
      <Row align="flex-end" style={{ justifyContent: 'space-between' }}>
        <Row align="baseline" gap={8} style={{ flexShrink: 1, flexWrap: 'wrap' }}>
          <Num size={unlimited ? 30 : 38}>{unlimited ? t('es.big.unlimited') : t('es.big.gb', { gb: p.gb! })}</Num>
          <T v="small">{p.daily ? `${t('es.big.aDay')} · ${t('es.days.n', { n: p.days })}` : t('es.days.n', { n: p.days })}</T>
        </Row>
        <View style={{ alignItems: 'flex-end' }}>
          <Num size={19}>{formatSar(p.price.amount)}</Num>
          <T v="tiny">{t('es.each')}</T>
        </View>
      </Row>
      <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(share * 100)}%`, backgroundColor: on ? colors.green : colors.goldDeep }]} /></View>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }} gap={6}>
        <T v="tiny" color={colors.ink2}>{perDay}</T>
        {p.fits
          ? <Row gap={4}><Icon name="check" size={14} color={colors.ok} width={2.4} /><T v="tiny" color={colors.ok} style={{ fontFamily: ff.ui600 }}>{t('es.plan.covers', { days })}</T></Row>
          : <T v="tiny" color={colors.goldInk} style={{ flexShrink: 1 }}>{t('es.plan.short', { days: p.days })}</T>}
      </Row>
    </Pressable>
  );
}

/** A person who could have an eSIM: their initial on a disc and their first name; on when it's theirs to get. */
export function PersonChip({ name, on, has, onPress, testID }: { name: string; on: boolean; has: boolean; onPress: () => void; testID?: string }) {
  const first = name.split(' ')[0] ?? name;
  return (
    <Pressable testID={testID} disabled={has} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: has }} accessibilityLabel={has ? `${name}, ${t('es.who.has')}` : name}
      onPress={() => { buzz('select'); onPress(); }}
      style={({ pressed }) => [styles.person, { backgroundColor: on ? colors.green : colors.paper, opacity: has ? 0.6 : 1 }, pressed ? { transform: [{ scale: 0.97 }] } : null]}>
      <View style={[styles.face, { backgroundColor: on ? colors.gold : colors.mist }]}>
        <T style={[font('h3', colors.green), { fontSize: 14, lineHeight: 18 }]}>{first.charAt(0).toUpperCase()}</T>
        {on ? <View style={styles.faceTick}><Icon name="check" size={9} color={colors.paper} width={3} /></View> : null}
      </View>
      <View>
        <T style={[font('h3', on ? colors.mist : colors.green), { fontSize: 14, lineHeight: 18 }]} numberOfLines={1}>{first}</T>
        {has ? <T v="tiny" style={{ fontSize: 11, lineHeight: 14 }}>{t('es.who.has')}</T> : null}
      </View>
    </Pressable>
  );
}

/** A phone with an eSIM inside; a green tick once we know it takes one. */
export function PhoneArt({ ok, size = 64 }: { ok: boolean; size?: number }) {
  const h = size * 1.5;
  return (
    <View style={{ width: size + 14, height: h + 6 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={h} viewBox="0 0 64 96">
        <Rect x={3} y={2} width={58} height={92} rx={13} fill={colors.paper} stroke={colors.green} strokeWidth={3} />
        <Rect x={24} y={8} width={16} height={4} rx={2} fill={colors.green} opacity={0.85} />
        <Path d="M22 38h14l6 6v20a2 2 0 0 1-2 2H22a2 2 0 0 1-2-2V40a2 2 0 0 1 2-2z" fill={colors.goldWash} stroke={colors.goldDeep} strokeWidth={2} />
        <Rect x={25} y={47} width={12} height={12} rx={2} fill={colors.gold} />
        <Path d="M31 47v12M25 53h12" stroke={colors.goldDeep} strokeWidth={1.4} />
      </Svg>
      <View style={[styles.tick, { backgroundColor: ok ? colors.ok : colors.mist, borderColor: colors.paper }]}>
        {ok ? <Icon name="check" size={14} color={colors.paper} width={2.8} /> : <T style={{ fontFamily: ff.ui600, fontSize: 13, lineHeight: 16, color: colors.ink3 }}>?</T>}
      </View>
    </View>
  );
}

/* ───────── the eSIM ───────── */

const DOT: Record<EsimView['status'], string> = {
  ordering: colors.gold, ready: colors.gold, installed: colors.live, active: colors.live, used_up: '#e0a35c', expired: colors.onDark3, refunded: '#e0a35c', stuck: '#e0a35c',
};

const TONE: Record<EsimView['status'], 'default' | 'ok' | 'warn' | 'gold'> = {
  ordering: 'default', ready: 'gold', installed: 'ok', active: 'ok', used_up: 'warn', expired: 'default', refunded: 'warn', stuck: 'warn',
};

type Sim = Pick<EsimView, 'status' | 'where' | 'iccid' | 'travellerName' | 'plan' | 'usage'>;
const planText = (p: Sim['plan']) => (p.gb === null ? t('es.plan.unlimited', { days: p.days }) : p.daily ? t('es.plan.daily', { gb: p.gb, days: p.days }) : t('es.plan.gb', { gb: p.gb, days: p.days }));
/** The plan's whole size in MB, for a ring before the eSIM is on. */
const planMb = (p: Sim['plan']) => (p.gb === null ? 0 : p.gb * 1024 * (p.daily ? p.days : 1));
const live = (u: Sim['usage']) => !!u && u.state !== 'not_active' && (u.unlimited || !!u.totalMb);
/** "Until 25 Oct" and how many days are left, from the end of the eSIM; null before it starts. */
export function daysLeftOf(u: Sim['usage']): number | null {
  if (!u?.expiresAt) return null;
  const n = Math.ceil((Date.parse(u.expiresAt) - Date.now()) / 86_400_000);
  return n > 0 ? n : null;
}

/** The status as a pill on a photo: a dot in its colour, on glass. */
function GlassStatus({ status }: { status: EsimView['status'] }) {
  return (
    <View style={styles.status}>
      <View style={{ width: 7, height: 7, borderRadius: 9, backgroundColor: DOT[status] }} />
      <T style={{ fontFamily: ff.ui600, fontSize: 12, lineHeight: 16, color: colors.paper }} numberOfLines={1}>{t(`es.st.${status}` as CopyKey)}</T>
    </View>
  );
}

/**
 * The eSIM's own page, at the top: the place as a photo under Mada green, days left, what's left as a big ring
 * ("3.1 GB, left of 5 GB"), until when, and Top up on glass. Before it's on: the plan's size in the ring.
 */
export function EsimPass({ e, until, onTopup, testID }: { e: Sim; until?: string | null; onTopup?: (() => void) | null; testID?: string }) {
  const country = countryOf(e.plan.coverage.countries);
  const { photo, credit } = placePhotoOf(country);
  const u = e.usage;
  const left = daysLeftOf(u);
  // Unique per mount: the same eSIM can be open twice in the stack, and a shared gradient id draws no veil.
  const gid = `esim-pass-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View style={[styles.pass, shadow('card')]} testID={testID}>
      <Photo name={photo} />
      <VGradient id={gid} stops={[[0, 'rgba(20,39,32,0.62)'], [0.45, 'rgba(20,39,32,0.8)'], [1, 'rgba(15,26,22,0.94)']]} />
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={styles.glass}>
          {flagOf(country) ? <T style={{ fontSize: 15, lineHeight: 20 }}>{flagOf(country)}</T> : <Icon name="globe" size={16} color={colors.paper} />}
          <T style={{ fontFamily: ff.ui600, fontSize: 13, lineHeight: 18, color: colors.paper }} numberOfLines={1}>{e.where}</T>
        </View>
        <GlassStatus status={e.status} />
      </Row>
      <View style={{ alignItems: 'center', gap: 10 }}>
        <T style={{ fontFamily: ff.ui600, fontSize: 13, lineHeight: 18, color: colors.onDark2 }}>
          {left ? (left === 1 ? t('es.lastDay') : t('es.daysLeft', { n: left })) : planText(e.plan)}
        </T>
        {live(u)
          ? <DataRing leftMb={u!.leftMb ?? 0} totalMb={u!.totalMb ?? 0} unlimited={u!.unlimited} size={184} light />
          : <DataRing leftMb={planMb(e.plan)} totalMb={planMb(e.plan)} unlimited={e.plan.gb === null} size={184} light idle note={e.status === 'ready' ? t('es.st.ready') : t('es.notOn')} />}
      </View>
      <Row align="flex-end" style={{ justifyContent: 'space-between' }}>
        <View style={{ gap: 2, flexShrink: 1 }}>
          {until ? <T v="tiny" color={colors.onDark3}>{t('es.until')}</T> : null}
          <T style={{ fontFamily: ff.ui600, fontSize: 15, lineHeight: 20, color: colors.paper }} numberOfLines={1}>
            {until ?? [e.travellerName?.split(' ')[0], e.iccid ? `•••• ${e.iccid.slice(-4)}` : null].filter(Boolean).join(' · ')}
          </T>
          {credit ? <T style={{ fontSize: 10, lineHeight: 13, color: 'rgba(255,253,249,0.5)' }} numberOfLines={1}>{t('things.photoBy', { credit })}</T> : null}
        </View>
        {onTopup ? (
          <Pressable testID="esim-topup" accessibilityRole="button" onPress={() => { buzz('tap'); onTopup(); }} style={({ pressed }) => [styles.topup, pressed ? { transform: [{ scale: 0.97 }] } : null]}>
            <Icon name="plus" size={16} color={colors.green} width={2.4} />
            <T style={{ fontFamily: ff.ui600, fontSize: 14, lineHeight: 18, color: colors.green }}>{t('es.topup')}</T>
          </Pressable>
        ) : null}
      </Row>
    </View>
  );
}

/**
 * The eSIM in a list (the wallet, the trip, after paying): its state and place as tags, the place's photo with its
 * flag, the plan and who it's for, until when; what's left on a ring at the side.
 */
export function EsimSummary({ e, who, testID }: { e: Sim; who?: string; testID?: string }) {
  const country = countryOf(e.plan.coverage.countries);
  const u = e.usage;
  const left = daysLeftOf(u);
  return (
    <View style={styles.summary} testID={testID}>
      <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
        <Row gap={6} style={{ flexWrap: 'wrap' }}>
          <Tag tone={TONE[e.status]} label={t(`es.st.${e.status}` as CopyKey)} />
          {left ? <Tag label={left === 1 ? t('es.lastDay') : t('es.daysLeft', { n: left })} /> : null}
        </Row>
        <Row gap={12}>
          <View style={styles.thumb}>
            <Photo name={placePhotoOf(country).photo} />
            <View style={styles.thumbFlag}><FlagDisc country={country} size={22} /></View>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T v="h3" numberOfLines={1}>{t('es.card.title', { where: e.where })}</T>
            <T v="tiny" numberOfLines={1}>{[planText(e.plan), who ?? e.travellerName?.split(' ')[0]].filter(Boolean).join(' · ')}</T>
          </View>
        </Row>
      </View>
      {live(u)
        ? <DataRing leftMb={u!.leftMb ?? 0} totalMb={u!.totalMb ?? 0} unlimited={u!.unlimited} size={88} />
        : <DataRing leftMb={planMb(e.plan)} totalMb={planMb(e.plan)} unlimited={e.plan.gb === null} size={88} idle />}
    </View>
  );
}

/**
 * What's left, as a ring: the GB inside, "left of 5 GB" under them (just "of 5 GB" on a small ring). Unlimited: a full
 * ring. `idle`: not on yet, the plan's size in a quiet ring, with an optional note under it.
 */
export function DataRing({ leftMb, totalMb, unlimited, size = 168, light, idle, note }: { leftMb: number; totalMb: number; unlimited?: boolean; size?: number; light?: boolean; idle?: boolean; note?: string }) {
  const stroke = Math.round(size * (size > 120 ? 0.07 : 0.085));
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const share = idle ? 0 : unlimited ? 1 : Math.max(0, Math.min(1, leftMb / Math.max(1, totalMb)));
  const low = !idle && !unlimited && share < 0.2;
  const ink = light ? colors.paper : colors.green;
  const big = size > 120;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessible accessibilityLabel={unlimited ? t('es.unlimited') : idle ? sizeText(totalMb) : t('es.left', { left: sizeText(leftMb), total: sizeText(totalMb) })}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={light ? 'rgba(255,253,249,0.16)' : colors.mist} strokeWidth={stroke} />
        {idle ? <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={light ? 'rgba(217,183,122,0.35)' : colors.goldWash} strokeWidth={stroke} strokeDasharray="2 7" /> : (
          <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={low ? '#d98a4a' : colors.gold} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${C}`} strokeDashoffset={C * (1 - share)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        )}
      </Svg>
      {unlimited ? <Num size={size * 0.14} color={ink}>{t('es.unlimited')}</Num> : (
        <>
          <Num size={size * (big ? 0.2 : 0.19)} color={ink}>{sizeText(idle ? totalMb : leftMb)}</Num>
          {idle ? (note ? <T v="tiny" color={light ? colors.onDark2 : colors.ink3} style={{ marginTop: 3, textAlign: 'center', maxWidth: size * 0.62 }} numberOfLines={2}>{note}</T> : null)
            : <T v="tiny" color={light ? colors.onDark2 : colors.ink3} style={{ marginTop: big ? 3 : 0, fontSize: big ? 12 : 10.5, lineHeight: big ? 16 : 13 }}>{big ? t('es.ring.of', { total: sizeText(totalMb) }) : t('es.ring.short', { total: sizeText(totalMb) })}</T>}
        </>
      )}
    </View>
  );
}

/** Install on Wi-Fi → Land → Turn it on, with where they are now. */
export function FlowSteps({ now }: { now: 0 | 1 | 2 | 3 }) {
  const keys = ['es.flow.1', 'es.flow.2', 'es.flow.3'] as const;
  return (
    <View style={styles.flow} testID="esim-flow">
      {keys.map((k, i) => {
        const done = i < now;
        const cur = i === now;
        return (
          <View key={k} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' }}>
              <View style={[styles.flowLine, { opacity: i === 0 ? 0 : 1, backgroundColor: done || cur ? colors.green : colors.grab }]} />
              <View style={[styles.flowDot, done ? { backgroundColor: colors.ok } : cur ? { backgroundColor: colors.green } : { backgroundColor: colors.mist, borderWidth: 1.5, borderColor: colors.grab }]}>
                {done ? <Icon name="check" size={15} color={colors.paper} width={2.6} />
                  : <T style={{ fontFamily: ff.ui600, fontSize: 14, lineHeight: 18, color: cur ? colors.paper : colors.ink3 }}>{String(i + 1)}</T>}
              </View>
              <View style={[styles.flowLine, { opacity: i === 2 ? 0 : 1, backgroundColor: done ? colors.green : colors.grab }]} />
            </View>
            <T v="tiny" color={cur ? colors.green : colors.ink3} style={[{ textAlign: 'center' }, cur ? { fontFamily: ff.ui600 } : null]} numberOfLines={2}>{t(k)}</T>
          </View>
        );
      })}
    </View>
  );
}

/** The moment it's installed: a tick that lands (still, with Reduce Motion) and "You're set for Türkiye." */
export function SetMoment({ where }: { where: string }) {
  const still = useReduceMotion();
  useEffect(() => { buzz('success'); }, []);
  const pop: ViewStyle | null = Platform.OS === 'web' && !still ? ({
    animationKeyframes: [{ '0%': { opacity: 0, transform: 'scale(0.6)' }, '70%': { opacity: 1, transform: 'scale(1.08)' }, '100%': { opacity: 1, transform: 'scale(1)' } }],
    animationDuration: '520ms', animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)', animationFillMode: 'both',
  } as unknown as ViewStyle) : null;
  return (
    <Rise>
      <View style={styles.set} testID="esim-set" accessibilityRole="alert">
        <PopIn still={still} style={pop}><BigCheck size={52} /></PopIn>
        <View style={{ flex: 1 }}><T style={[font('displaySmall'), { fontSize: 26, lineHeight: 30 }]}>{t('es.set', { where })}</T></View>
      </View>
    </Rise>
  );
}

const styles = StyleSheet.create({
  disc: { borderRadius: 999, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  hero: { height: 268, borderRadius: radii.card, overflow: 'hidden', backgroundColor: colors.stage, justifyContent: 'space-between' },
  heroTop: { padding: 14, flexDirection: 'row' },
  heroFoot: { padding: 18, paddingTop: 0, gap: 6 },
  glass: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(15,26,22,0.45)', borderWidth: 1, borderColor: 'rgba(255,253,249,0.18)' },
  plan: { backgroundColor: colors.paper, borderRadius: radii.card, padding: 16, gap: 10, borderWidth: 2, borderColor: 'transparent' },
  planOn: { borderColor: colors.green },
  radio: { width: 24, height: 24, borderRadius: 99, borderWidth: 1.5, borderColor: '#c9c1b4', alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: colors.green, borderColor: colors.green },
  track: { height: 6, borderRadius: 99, backgroundColor: colors.mist, overflow: 'hidden', flexDirection: 'row' },
  fill: { height: 6, borderRadius: 99 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingStart: 5, paddingEnd: 14, height: 46, borderRadius: 999 },
  faceTick: { position: 'absolute', end: -3, bottom: -3, width: 16, height: 16, borderRadius: 99, backgroundColor: colors.ok, borderWidth: 1.5, borderColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  face: { width: 34, height: 34, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  tick: { position: 'absolute', end: 0, bottom: 0, width: 26, height: 26, borderRadius: 99, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  pass: { borderRadius: 26, padding: 18, gap: 16, overflow: 'hidden', backgroundColor: colors.green, justifyContent: 'space-between' },
  topup: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.gold },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.paper, borderRadius: radii.card, padding: 16 },
  thumb: { width: 48, height: 48, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.stage },
  thumbFlag: { position: 'absolute', end: 2, bottom: 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(255,253,249,0.12)', borderWidth: 1, borderColor: 'rgba(255,253,249,0.16)' },
  flow: { flexDirection: 'row', backgroundColor: colors.paper, borderRadius: radii.card, paddingVertical: 16, paddingHorizontal: 6 },
  flowLine: { flex: 1, height: 2 },
  flowDot: { width: 32, height: 32, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  set: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.paper, borderRadius: radii.card, padding: 18 },
});
