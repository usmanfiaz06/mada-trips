import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View, Platform } from 'react-native';
import { addDays, dayLabel, daysBetween, formatSar, nameIn, rangeLabel, type Plan, type PlanCheck, type PlanItem, type PlanPlace } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon, type IconName } from '@/components/Icon';
import { T } from '@/components/Text';
import { Initial } from '@/components/booking/PeopleFrame';
import { routeTitle } from '@/components/booking/PlanCards';
import { TripHero } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { getLocale, joinAnd, t } from '@/lib/i18n';
import { carOn, isBooked } from '@/lib/plan-logic';
import { colors, ff, radii } from '@/theme';

/*
 * The pieces of the plan screen (docs/app/ASK-INTEGRATED.md §9.3): the header (route, dates, who, where it starts), the
 * to-do card from the plan's checks, a day with its legs, stays, car and stops, and one row per item. Places are written
 * in the reader's language and direction; numbers stay left-to-right inside Arabic. A drive's km and time are the
 * drive interface's own (never ours); a stay names its hotel only once it's booked.
 */

const rtl = () => getLocale() === 'ar';
const iso = (s: string) => (rtl() ? `⁦${s}⁩` : s);
export const placeName = (p: PlanPlace | null | undefined) => (p ? nameIn(p.city || p.name, getLocale()) : '');
const arrow = () => (rtl() ? ' ← ' : ' → ');

function duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? t('chat.plan.hm', { h, m }) : h ? t('chat.plan.h', { h }) : t('chat.plan.min', { m });
}

const MODE_ICON: Record<string, IconName> = { flight: 'flight', drive: 'car', transfer: 'car', train: 'map', ferry: 'map', walk: 'pin' };
const KIND_ICON: Record<string, IconName> = { stay: 'stay', car: 'car', activity: 'star', meal: 'food', note: 'doc', check: 'check' };
export const iconOf = (i: Pick<PlanItem, 'kind' | 'mode'>): IconName => (i.kind === 'leg' ? MODE_ICON[i.mode ?? ''] ?? 'map' : KIND_ICON[i.kind] ?? 'pin');

/** The drive's line: km and time as measured, an estimate without a time, no road, or (still measuring) checking. */
export function driveWords(i: Pick<PlanItem, 'kind' | 'mode' | 'drive' | 'from' | 'to'>): string | null {
  if (i.kind !== 'leg' || i.mode !== 'drive') return null;
  const d = i.drive;
  if (!d) return i.from?.lat != null && i.to?.lat != null ? t('plan.screen.drive.checking') : null;
  if (d.noRoute) return t('plan.screen.drive.noRoute');
  const km = d.km != null ? Math.round(d.km).toLocaleString('en-US') : null;
  if (d.estimate || d.minutes == null) return km ? t('plan.screen.drive.estimate', { km: iso(km) }) : null;
  const metrics = [km ? t('chat.plan.km', { km }) : null, duration(d.minutes)].filter(Boolean).join(' · ');
  const border = d.borders.length ? t('chat.plan.border', { place: joinAnd(d.borders.map((b) => nameIn(b, getLocale()))) }) : null;
  return [iso(metrics), border].filter(Boolean).join(' · ');
}

const nightsWords = (i: Pick<PlanItem, 'day' | 'nights'>) => {
  if (i.day == null) return null;
  const n = Math.max(1, i.nights ?? 1);
  return n === 1 ? t('plan.screen.nightOne', { n: i.day + 1 }) : t('plan.screen.nights', { from: i.day + 1, to: i.day + n });
};

/** What an item's row says: its main words and the line under them. */
export function itemWords(i: PlanItem, prices: boolean): { main: string; sub: string | null } {
  if (i.kind === 'leg' && (i.from || i.to)) {
    return { main: `${placeName(i.from)}${arrow()}${placeName(i.to)}`, sub: [driveWords(i), i.statusLine && !isBooked(i) ? i.statusLine : i.booking?.name ?? null].filter(Boolean).join(' · ') || null };
  }
  if (i.kind === 'stay') {
    // The hotel's own name only once it's booked or held; until then "Stay in Melaka".
    const name = i.booking?.name ?? (i.place && i.source !== 'booking' ? t('chat.plan.stayIn', { place: placeName(i.place) }) : i.title);
    const price = prices && i.price && i.status === 'priced' ? formatSar(i.price.amount) : null;
    return { main: name, sub: [nightsWords(i), price, !isBooked(i) ? i.statusLine : null].filter(Boolean).join(' · ') || null };
  }
  if (i.kind === 'car') return { main: i.title, sub: [nightsWords(i), i.statusLine].filter(Boolean).join(' · ') || null };
  const place = i.place ? placeName(i.place) : null;
  return { main: i.title, sub: [place && place !== i.title ? place : null, i.statusLine].filter(Boolean).join(' · ') || null };
}

const TONE: Record<string, { fg: string; bg: string }> = {
  priced: { fg: colors.goldInk, bg: colors.goldWash }, requested: { fg: colors.goldInk, bg: colors.goldWash }, held: { fg: colors.goldInk, bg: colors.goldWash },
  booked: { fg: colors.ok, bg: colors.mist }, confirmed: { fg: colors.ok, bg: colors.mist }, cancelled: { fg: colors.ink3, bg: colors.mist }, skipped: { fg: colors.ink3, bg: colors.mist },
};

export function StatusTag({ status, testID }: { status: PlanItem['status']; testID?: string }) {
  // A plain idea carries no label (design v3: the row's own action or nothing, never "Idea").
  if (status === 'idea') return null;
  const tone = TONE[status] ?? TONE.priced!;
  return (
    <View style={[st.tag, { backgroundColor: tone.bg }]} testID={testID}>
      {status === 'booked' || status === 'confirmed' ? <Icon name="check" size={12} color={tone.fg} width={2.4} /> : null}
      <T v="tiny" color={tone.fg} style={{ fontFamily: ff.ui600 }}>{t(`chat.plan.status.${status}`)}</T>
    </View>
  );
}

/**
 * The right side of a row (design v3): what the traveller can do, or where it stands. A flight to find, a stay to find,
 * an idea to look at, a price to pay, with the team, booked. Only from the item's own status, price and quote.
 */
export type RowAct = { label: string; tone?: 'link' | 'gold' | 'ok'; onPress?: () => void; testID?: string };
export type RowActKind = 'search' | 'findStay' | 'view' | 'price' | 'pending' | 'booked';
export function rowActKind(i: PlanItem, prices: boolean, owner: boolean): { kind: RowActKind; amount?: number } | null {
  if (i.status === 'skipped' || i.status === 'cancelled') return null;
  if (isBooked(i)) return { kind: 'booked' };
  const amount = i.quote?.amount ?? (i.status === 'priced' ? i.price?.amount : undefined);
  if (amount != null && prices) return { kind: 'price', amount };
  if (i.status === 'requested') return { kind: 'pending' };
  if (owner && i.status === 'idea' && !i.priceExpired && i.kind === 'leg' && i.mode === 'flight') return { kind: 'search' };
  if (owner && i.status === 'idea' && !i.priceExpired && i.kind === 'stay') return { kind: 'findStay' };
  return { kind: 'view' };
}
export const rowActLabel = (a: { kind: RowActKind; amount?: number }): Pick<RowAct, 'label' | 'tone'> =>
  a.kind === 'price' ? { label: formatSar(a.amount ?? 0), tone: 'gold' } : a.kind === 'pending' ? { label: t('plan.row.pending'), tone: 'gold' }
    : a.kind === 'booked' ? { label: t('plan.row.booked'), tone: 'ok' } : { label: t(`plan.row.${a.kind}`), tone: 'link' };

export function RowActTag({ act }: { act: RowAct }) {
  const tone = act.tone === 'gold' ? TONE.priced! : act.tone === 'ok' ? TONE.booked! : null;
  const inner = tone ? (
    <View style={[st.tag, { backgroundColor: tone.bg }]}>
      {act.tone === 'ok' ? <Icon name="check" size={12} color={tone.fg} width={2.4} /> : null}
      <T v="tiny" color={tone.fg} style={{ fontFamily: ff.ui600 }}>{act.label}</T>
    </View>
  ) : <T v="tiny" color={colors.green} style={{ fontFamily: ff.ui600 }}>{act.label}</T>;
  if (!act.onPress) return <View testID={act.testID ?? 'plan-item-status'}>{inner}</View>;
  return (
    <Pressable onPress={() => { buzz('tap'); act.onPress!(); }} hitSlop={10} accessibilityRole="button" accessibilityLabel={act.label} testID={act.testID ?? 'plan-item-act'}
      style={({ pressed }) => [{ minHeight: 32, justifyContent: 'center' }, pressed ? { opacity: 0.7 } : null]}>
      {inner}
    </Pressable>
  );
}

/** One item: its time, icon, words and status (or what to do). Tapping opens its sheet. `line`: the day's dotted thread. */
export function ItemRow({ item, prices, onPress, testID, act, line }: { item: PlanItem; prices: boolean; onPress?: () => void; testID?: string; act?: RowAct; line?: { up: boolean; down: boolean } }) {
  const w = itemWords(item, prices);
  const at = item.startsAt?.slice(11, 16) ?? null;
  const done = isBooked(item);
  const label = [at, w.main, w.sub, done ? t('plan.row.booked') : t(`chat.plan.status.${item.status}`)].filter(Boolean).join(', ');
  const iconTile = <View style={[st.icon, done ? { backgroundColor: colors.mist } : null]}><Icon name={iconOf(item)} size={16} color={done ? colors.ok : colors.ink2} /></View>;
  return (
    <Pressable onPress={onPress ? () => { buzz('tap'); onPress(); } : undefined} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={label} testID={testID ?? 'plan-item'}
      style={({ pressed }) => [st.item, item.status === 'skipped' || item.status === 'cancelled' ? { opacity: 0.55 } : null, pressed ? { opacity: 0.8 } : null]}>
      <T v="tiny" color={colors.ink3} style={st.time}>{at ? iso(at) : ''}</T>
      {line ? (
        <View style={st.thread}>
          <View style={[st.dots, line.up ? null : { borderColor: 'transparent' }]} />
          {iconTile}
          <View style={[st.dots, line.down ? null : { borderColor: 'transparent' }]} />
        </View>
      ) : iconTile}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T v="small" color={colors.green} style={[{ fontFamily: ff.ui600 }, item.status === 'cancelled' ? st.struck : null]} numberOfLines={2} testID="plan-item-title">{w.main}</T>
        {w.sub ? <T v="tiny" color={colors.ink2} numberOfLines={2} testID="plan-item-sub">{w.sub}</T> : null}
      </View>
      {act ? <RowActTag act={act} /> : done ? <RowActTag act={{ label: t('plan.row.booked'), tone: 'ok', testID: 'plan-item-status' }} /> : <StatusTag status={item.status} testID="plan-item-status" />}
    </Pressable>
  );
}

/** A quiet chip in the header: the app's chip (mist pill), a size smaller so the three sit on one line. */
function MetaChip({ label, icon, onPress, testID }: { label: string; icon: ReactNode; onPress?: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress ? () => { buzz('select'); onPress(); } : undefined} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={label} hitSlop={{ top: 6, bottom: 6 }} testID={testID}
      style={({ pressed }) => [st.chip, pressed ? { transform: [{ scale: 0.97 }] } : null]}>
      {icon}
      <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }} numberOfLines={1}>{label}</T>
    </Pressable>
  );
}

/**
 * The trip page's photo header for the plan: "Riyadh → AlUla" over the city's photo, and under it one row of quiet
 * chips (dates, who's going, where it starts), each opening its own edit.
 */
export function PlanHero({ plan, people, photo, onBack, onDates, onPeople, onOrigin }: {
  plan: Plan; people: { name: string; initial: string }[]; photo?: string | null; onBack: () => void; onDates?: () => void; onPeople?: () => void; onOrigin?: () => void;
}) {
  const locale = getLocale();
  const first = people[0] ? nameIn(people[0].name, locale) : null;
  const who = first ? (people.length > 1 ? t('plan.meta.people', { name: first, n: people.length - 1 }) : first) : null;
  return (
    <TripHero photo={photo} title={routeTitle(plan.title)} onBack={onBack} shadeId="plan-top" titleTestID="plan-title" height={250}>
      <View style={st.meta} testID="plan-meta">
        <MetaChip label={rangeLabel(plan.startDate, plan.endDate, locale)} icon={<Icon name="calendar" size={14} color={colors.green} />} onPress={onDates} testID="plan-dates" />
        {who ? (
          <MetaChip label={who} onPress={onPeople} testID="plan-people" icon={(
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Icon name="user" size={14} color={colors.green} />
              <View style={{ flexDirection: 'row' }}>
                {people.slice(0, 3).map((p, i) => <View key={`${p.name}-${i}`} style={i ? { marginStart: -5 } : null}><Initial letter={p.initial} size={16} gold={i === 0} /></View>)}
              </View>
            </View>
          )} />
        ) : null}
        <MetaChip label={plan.origin ? t('plan.screen.from', { place: placeName(plan.origin) }) : t('plan.screen.startNeeded')} onPress={onOrigin} testID="plan-origin"
          icon={<Icon name="pin" size={14} color={plan.origin ? colors.green : colors.goldInk} />} />
      </View>
    </TripHero>
  );
}

const CHECK_WORDS = (c: PlanCheck): string => {
  const days = (c.days.length ? c.days : c.nights).map((d) => d + 1);
  const range = days.length ? (days.length > 1 ? `${days[0]}–${days[days.length - 1]}` : String(days[0])) : '';
  if (c.key === 'car') return range ? t('chat.plan.check.car', { days: iso(range) }) : t('chat.plan.check.carAny');
  if (c.key === 'stays') return range ? t('chat.plan.check.stays', { days: iso(range) }) : t('chat.plan.check.staysAny');
  return t(`chat.plan.check.${c.key}` as 'chat.plan.check.visa');
};

/** What's left: the checks that aren't fine, each a dot and a line (§3.4). Nothing left says so once. */
export function TodoCard({ checks }: { checks: PlanCheck[] }) {
  const open = checks.filter((c) => c.state === 'todo' || c.state === 'warn');
  return (
    <View style={st.todo} testID="plan-todo">
      <T v="tiny" color={colors.ink3} style={{ fontFamily: ff.ui600 }}>{t('plan.screen.todo')}</T>
      {open.length ? open.map((c) => (
        <View key={c.key} style={st.line} testID={`plan-todo-${c.key}`}>
          <View style={[st.dot, { backgroundColor: c.state === 'warn' ? colors.goldInk : colors.gold }]} />
          <T v="small" color={colors.green} style={{ flex: 1 }}>{CHECK_WORDS(c)}</T>
        </View>
      )) : <T v="small" color={colors.ink2}>{t('plan.screen.allSet')}</T>}
    </View>
  );
}

/** One day: its date, the nights with no stay, the car, its items in order, and Add. */
export function DaySection({ plan, day, prices, canEdit, onItem, onAdd, showSkipped, actOf }: {
  plan: Plan; day: number; prices: boolean; canEdit: boolean; onItem: (i: PlanItem) => void; onAdd: () => void; showSkipped: boolean; actOf?: (i: PlanItem) => RowAct | undefined;
}) {
  const locale = getLocale();
  const items = plan.items.filter((i) => i.day === day && (showSkipped || i.status !== 'skipped')).sort((a, b) => a.sort - b.sort);
  const nights = daysBetween(plan.startDate, plan.endDate);
  const covered = day >= nights || plan.items.some((i) => i.kind === 'stay' && i.day != null && i.status !== 'skipped' && i.status !== 'cancelled' && day >= i.day && day < i.day + (i.nights ?? 1));
  const car = carOn(plan, day);
  return (
    <View style={st.day} testID={`plan-day-${day + 1}`}>
      <T v="h3" style={{ fontSize: 16 }} accessibilityRole="header">{t('plan.screen.dayDate', { n: day + 1, date: dayLabel(addDays(plan.startDate, day), { locale, today: plan.startDate }) })}</T>
      {items.length ? items.map((i, n) => <ItemRow key={i.id} item={i} prices={prices} onPress={() => onItem(i)} act={actOf?.(i)} line={{ up: n > 0, down: n < items.length - 1 }} />)
        : <T v="small" color={colors.ink3} testID="plan-day-free">{t('plan.screen.free')}</T>}
      {!covered ? (
        <View style={st.note} testID="plan-night-gap"><Icon name="stay" size={14} color={colors.goldInk} /><T v="tiny" color={colors.goldInk}>{t('plan.screen.nightGap', { n: day + 1 })}</T></View>
      ) : null}
      {car ? (
        <View style={st.note} testID={`plan-car-${car}`}><Icon name="car" size={14} color={car === 'booked' ? colors.ok : colors.ink3} /><T v="tiny" color={car === 'booked' ? colors.ok : colors.ink2}>{t(`plan.screen.car.${car}`)}</T></View>
      ) : null}
      {canEdit ? (
        <Pressable onPress={() => { buzz('tap'); onAdd(); }} accessibilityRole="button" style={st.add} testID={`plan-add-${day + 1}`}>
          <Icon name="plus" size={16} color={colors.green} />
          <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{t('plan.screen.add', { n: day + 1 })}</T>
        </Pressable>
      ) : null}
    </View>
  );
}

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

/** "+ Add to day 2": something to do, a meal or a note, with a time if there is one. */
export function AddForm({ day, onSave, busy }: { day: number; onSave: (x: { kind: 'activity' | 'meal' | 'note'; title: string; at: string | null }) => void; busy?: boolean }) {
  const [kind, setKind] = useState<'activity' | 'meal' | 'note'>('activity');
  const [title, setTitle] = useState('');
  const [at, setAt] = useState('');
  const bad = !!at && !/^([01]\d|2[0-3]):[0-5]\d$/.test(at);
  return (
    <View style={{ gap: 14 }} testID="plan-add-form">
      <T v="h2">{t('plan.add.title', { n: day + 1 })}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(['activity', 'meal', 'note'] as const).map((k) => <Chip key={k} label={t(`plan.add.kind.${k}`)} on={kind === k} onPress={() => setKind(k)} testID={`plan-add-kind-${k}`} />)}
      </View>
      <View style={{ gap: 6 }}>
        <T v="small" color={colors.ink2}>{t('plan.add.name')}</T>
        <TextInput value={title} onChangeText={setTitle} placeholder={t('plan.add.namePlaceholder')} placeholderTextColor={colors.muted} maxLength={120} style={[st.input, webNoOutline]} testID="plan-add-name" />
      </View>
      <View style={{ gap: 6 }}>
        <T v="small" color={colors.ink2}>{t('plan.add.time')}</T>
        <TextInput value={at} onChangeText={setAt} placeholder={t('plan.add.timePlaceholder')} placeholderTextColor={colors.muted} maxLength={5} style={[st.input, webNoOutline, { textAlign: 'left' }]} testID="plan-add-time" />
        {bad ? <T v="tiny" color={colors.badInk}>{t('plan.add.badTime')}</T> : null}
      </View>
      <Button label={t('plan.add.save')} disabled={!title.trim() || bad} busy={busy} onPress={() => onSave({ kind, title: title.trim(), at: at || null })} testID="plan-add-save" />
    </View>
  );
}

/** Where the trip starts (§3.8): the three main airports, or a place typed. */
export function OriginForm({ onSave, busy }: { onSave: (name: string) => void; busy?: boolean }) {
  const [other, setOther] = useState('');
  return (
    <View style={{ gap: 14 }} testID="plan-origin-form">
      <T v="h2">{t('plan.origin.title')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {['Riyadh', 'Jeddah', 'Dammam'].map((c) => <Chip key={c} label={nameIn(c, getLocale())} onPress={() => onSave(c)} testID={`plan-origin-${c.toLowerCase()}`} />)}
      </View>
      <T v="small" color={colors.ink2}>{t('plan.origin.other')}</T>
      <TextInput value={other} onChangeText={setOther} placeholder={t('plan.origin.placeholder')} placeholderTextColor={colors.muted} maxLength={80} style={[st.input, webNoOutline]} testID="plan-origin-input" />
      <Button label={t('plan.origin.save')} disabled={!other.trim()} busy={busy} onPress={() => onSave(other.trim())} testID="plan-origin-save" />
    </View>
  );
}

/** A thin line at the top: offline, edits waiting, changed elsewhere, couldn't refresh, or what a companion may do. */
export function Banner({ icon, text, tone = 'well', onClose, testID }: { icon: IconName; text: string; tone?: 'well' | 'gold'; onClose?: () => void; testID?: string }) {
  return (
    <View style={[st.banner, tone === 'gold' ? { backgroundColor: colors.goldWash } : null]} testID={testID} accessibilityLiveRegion="polite">
      <Icon name={icon} size={16} color={tone === 'gold' ? colors.goldInk : colors.ink2} />
      <T v="small" color={tone === 'gold' ? colors.goldInk : colors.ink2} style={{ flex: 1 }}>{text}</T>
      {onClose ? <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('chat.find.close')}><Icon name="close" size={14} color={colors.ink2} /></Pressable> : null}
    </View>
  );
}

export const st = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, minHeight: 48 },
  time: { width: 40, fontVariant: ['tabular-nums'] },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 11, borderRadius: 999, backgroundColor: colors.mist },
  // The day's dotted thread through the icons: it runs into the row's padding and half the gap so the rows join.
  thread: { alignSelf: 'stretch', alignItems: 'center', marginTop: -10, marginBottom: -10 },
  dots: { flex: 1, width: 0, minHeight: 10, borderWidth: 1, borderStyle: 'dotted', borderColor: 'rgba(30, 53, 45, 0.26)', borderRadius: 1 },
  icon: { width: 30, height: 30, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.sand },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 24, borderRadius: 99 },
  struck: { textDecorationLine: 'line-through', color: colors.ink3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 99 },
  todo: { gap: 8, backgroundColor: colors.paper, borderRadius: radii.card, padding: 16 },
  day: { gap: 4, backgroundColor: colors.paper, borderRadius: radii.card, paddingVertical: 14, paddingHorizontal: 14 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingStart: 50, paddingVertical: 2 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 4, minHeight: 44 },
  input: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, paddingHorizontal: 14, fontFamily: ff.ui400, fontSize: 16, color: colors.green },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: colors.mist },
});
