import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { formatSar, nameIn, rangeLabel, type ChatCard, type ChatPlanRow } from '@mada/shared';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { Pill } from '@/components/Pill';
import { IconTile } from '@/components/trips/ui';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { getLocale, joinAnd, t } from '@/lib/i18n';
import { colors, ff, radii } from '@/theme';
import { enter } from './parts';
import { DemoFare } from './DemoFare';

/*
 * The living plan in a conversation (docs/app/ASK-INTEGRATED.md §3.3): "Here's your plan, review it" as one card with a
 * few rows a day, where it starts (and a way to change it), who goes and what's left to do; and, on later turns, what
 * changed. Places are written in the reader's language and direction («الرياض ← العلا»); a drive shows km and time only
 * when the drive interface measured them, never an estimate of ours. Numbers stay left-to-right inside Arabic.
 */

type PlanChatCard = Extract<ChatCard, { type: 'plan' }>;
type DiffChatCard = Extract<ChatCard, { type: 'plan_diff' }>;
type LinkChatCard = Extract<ChatCard, { type: 'link' }>;

const rtl = () => getLocale() === 'ar';
const place = (n: string | null) => (n ? nameIn(n, getLocale()) : '');
const arrow = () => (rtl() ? ' ← ' : ' → ');
/** Keeps "240 km · 3 h" left-to-right inside an Arabic line. */
const iso = (s: string) => (rtl() ? `⁦${s}⁩` : s);

/** "Riyadh → Singapore → Penang", in the reader's language and direction. */
export const routeTitle = (title: string) => title.split(' → ').map((p) => place(p.trim())).join(arrow());

function duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? t('chat.plan.hm', { h, m }) : h ? t('chat.plan.h', { h }) : t('chat.plan.min', { m });
}

const MODE_ICON: Record<string, IconName> = { flight: 'flight', drive: 'car', transfer: 'car', train: 'map', ferry: 'map', walk: 'pin' };
const KIND_ICON: Record<string, IconName> = { stay: 'stay', car: 'car', activity: 'star', meal: 'food', note: 'doc', check: 'check' };
const iconOf = (r: ChatPlanRow): IconName => (r.kind === 'leg' ? MODE_ICON[r.mode ?? ''] ?? 'map' : KIND_ICON[r.kind] ?? 'pin');

/** What the row says: the route, the stay and its nights, the activity; the drive's numbers below when there are any. */
function rowWords(r: ChatPlanRow): { main: string; sub: string | null } {
  if (r.kind === 'leg' && (r.from || r.to)) {
    const metrics = [r.km != null ? t('chat.plan.km', { km: r.km.toLocaleString('en-US') }) : null, r.minutes != null ? duration(r.minutes) : null].filter(Boolean).join(' · ');
    const border = r.borders.length ? t('chat.plan.border', { place: joinAnd(r.borders.map(place)) }) : null;
    return { main: `${place(r.from)}${arrow()}${place(r.to)}`, sub: [metrics ? iso(metrics) : null, border, r.booking].filter(Boolean).join(' · ') || null };
  }
  if (r.kind === 'stay') {
    const nights = r.nights ? (r.nights === 1 ? t('chat.plan.night') : t('chat.plan.nights', { n: r.nights })) : null;
    return { main: r.booking ?? (r.place ? t('chat.plan.stayIn', { place: place(r.place) }) : r.title), sub: nights };
  }
  return { main: r.title, sub: r.place && r.place !== r.title ? place(r.place) : null };
}

function Row({ r, testID }: { r: ChatPlanRow; testID?: string }) {
  const w = rowWords(r);
  const done = r.status === 'booked' || r.status === 'confirmed';
  return (
    <View style={s.item} testID={testID} accessible accessibilityLabel={[r.at, w.main, w.sub, t(`chat.plan.status.${r.status}`)].filter(Boolean).join(', ')}>
      <Icon name={iconOf(r)} size={16} color={done ? colors.ok : colors.ink3} />
      <View style={{ flex: 1, gap: 1 }}>
        <T v="small" color={colors.green} numberOfLines={2}>{r.at ? `${iso(r.at)}  ${w.main}` : w.main}</T>
        {w.sub ? <T v="tiny" color={colors.ink2} numberOfLines={1}>{w.sub}</T> : null}
      </View>
      {r.status !== 'idea' ? <T v="tiny" color={done ? colors.ok : colors.goldInk} style={{ fontFamily: ff.ui600 }}>{t(`chat.plan.status.${r.status}`)}</T> : null}
    </View>
  );
}

function who(list: { name: string; self: boolean }[]): string | null {
  if (!list.length) return null;
  const others = list.filter((w) => !w.self).map((w) => nameIn(w.name, getLocale()));
  if (!others.length) return t('chat.who.justYou');
  return list.some((w) => w.self) ? t('chat.who.youAnd', { names: joinAnd(others) }) : joinAnd(others);
}

/** "A car for days 3–6": what's left, from the plan's checks (days are 0-based on the wire). */
function todoWords(c: PlanChatCard['todo'][number]): string {
  const days = c.days.length ? c.days.map((d) => d + 1) : [];
  const range = days.length ? (days.length > 1 ? `${days[0]}–${days[days.length - 1]}` : String(days[0])) : '';
  if (c.key === 'car') return range ? t('chat.plan.check.car', { days: iso(range) }) : t('chat.plan.check.carAny');
  if (c.key === 'stays') return range ? t('chat.plan.check.stays', { days: iso(range) }) : t('chat.plan.check.staysAny');
  const key = `chat.plan.check.${c.key}` as const;
  return ['passports', 'visa', 'esim', 'insurance', 'money'].includes(c.key) ? t(key as 'chat.plan.check.visa') : c.key;
}

/** "Here's your plan, review it": the plan at the version the turn made, a few rows a day. */
export function PlanCard({ card, onReview, onSay }: { card: PlanChatCard; onReview: () => void; onSay?: (text: string) => void }) {
  const locale = getLocale();
  const dates = rangeLabel(card.start, card.end, locale);
  const people = who(card.travellers);
  const router = useRouter();
  const totals = card.totals ?? null;
  return (
    <Animated.View entering={enter(0)} style={s.box} testID="chat-plan-card" accessible={false}>
      <View style={[s.row, { alignItems: 'flex-start' }]}>
        <IconTile name="map" />
        <View style={{ flex: 1, gap: 4 }}>
          <T v="h3" style={{ fontSize: 16, lineHeight: 22 }} accessibilityRole="header" accessibilityLabel={t('chat.plan.a11y', { title: routeTitle(card.title), dates })} testID="chat-plan-title">{routeTitle(card.title)}</T>
          <T v="small" color={colors.ink2}>{[dates, people].filter(Boolean).join(' · ')}</T>
        </View>
      </View>
      {card.origin ? (
        <View style={s.line} testID="chat-plan-origin">
          <Icon name="pin" size={16} color={colors.ink3} />
          <T v="small" color={colors.ink2} style={{ flexShrink: 1 }}>{t('chat.plan.from', { place: place(card.origin.name) })}</T>
          {onSay ? (
            <Pressable onPress={() => { buzz('tap'); onSay(t('chat.plan.changeSay')); }} hitSlop={10} accessibilityRole="button" testID="chat-plan-change">
              <T v="small" color={colors.green} style={{ fontFamily: ff.ui600, textDecorationLine: 'underline' }}>{t('chat.plan.change')}</T>
            </Pressable>
          ) : null}
        </View>
      ) : card.originNeeded ? (
        <View style={s.line} testID="chat-plan-origin-needed">
          <Icon name="pin" size={16} color={colors.goldInk} />
          <T v="small" color={colors.goldInk} style={{ flex: 1, fontFamily: ff.ui600 }}>{t('chat.plan.startNeeded')}</T>
        </View>
      ) : null}
      <View style={s.days}>
        {card.days.map((d) => (
          <View key={d.day} style={s.day} testID={`chat-plan-day-${d.day + 1}`}>
            <T v="tiny" color={colors.ink3} style={s.dayLabel}>{t('chat.plan.day', { n: d.day + 1 })}</T>
            <View style={{ flex: 1, gap: 6 }}>
              {d.items.length ? d.items.map((r, i) => <Row key={i} r={r} testID={r.kind === 'leg' && r.mode === 'drive' ? 'chat-plan-drive' : undefined} />)
                : <T v="small" color={colors.ink3}>{t('chat.plan.empty')}</T>}
            </View>
          </View>
        ))}
        {card.more ? <T v="tiny" color={colors.ink2} testID="chat-plan-more">{t('chat.plan.more', { n: card.more })}</T> : null}
      </View>
      {card.todo.length ? (
        <View style={s.todo} testID="chat-plan-todo">
          <T v="tiny" color={colors.ink3} style={{ fontFamily: ff.ui600 }}>{t('chat.plan.todo')}</T>
          {card.todo.map((c, i) => (
            <View key={i} style={s.line}>
              <View style={[s.dot, { backgroundColor: c.state === 'warn' ? colors.goldInk : colors.gold }]} />
              <T v="small" color={colors.green} style={{ flex: 1 }}>{todoWords(c)}</T>
            </View>
          ))}
        </View>
      ) : null}
      {totals ? (
        // Only prices a tool, a quote or a booking gave (U7); a sample fare says so on the total too.
        <View style={{ gap: 6 }} testID="chat-plan-totals">
          {totals.ready ? <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{t('chat.plan.ready', { amount: formatSar(totals.priced) })}</T> : null}
          {totals.booked ? <T v="small" color={colors.ink2}>{t('chat.plan.bookedTotal', { amount: formatSar(totals.booked) })}</T> : null}
          {totals.demo ? <DemoFare testID="chat-plan-demo-fare" /> : null}
        </View>
      ) : null}
      {totals?.ready ? (
        <Button size="small" label={t('chat.plan.bookReady')} onPress={() => { buzz('tap'); router.push({ pathname: '/pay', params: { plan: card.tripId } }); }} style={s.button} testID="chat-plan-book-ready" />
      ) : null}
      <Button size="small" variant={totals?.ready ? 'secondary' : 'primary'} label={t('chat.plan.review')} onPress={() => { buzz('tap'); onReview(); }} style={totals?.ready ? [s.button, s.soft] : s.button} testID="chat-plan-review" />
    </Animated.View>
  );
}

/** What a later turn changed: each change in a line, booked items left as they are said once. */
export function PlanDiffCard({ card, onReview }: { card: DiffChatCard; onReview: () => void }) {
  return (
    <Animated.View entering={enter(0)} style={s.box} testID="chat-plan-diff">
      <View style={[s.row, { alignItems: 'flex-start' }]}>
        <IconTile name="edit" />
        <View style={{ flex: 1, gap: 4 }}>
          <T v="h3" style={{ fontSize: 16, lineHeight: 22 }} accessibilityRole="header">{t('chat.plan.diff.title')}</T>
          <T v="small" color={colors.ink2}>{routeTitle(card.title)}</T>
        </View>
      </View>
      <View style={{ gap: 10 }}>
        {card.changes.map((c, i) => {
          const w = c.op === 'origin' ? { main: place(c.row.place ?? c.row.title), sub: null } : rowWords(c.row);
          return (
            <View key={i} style={s.item} testID="chat-plan-change-row">
              <Pill label={t(`chat.plan.op.${c.op}`)} variant={c.op === 'remove' ? 'default' : c.op === 'origin' ? 'gold' : 'ok'} height={24} />
              <View style={{ flex: 1, gap: 1 }}>
                <T v="small" color={colors.green} style={c.op === 'remove' ? s.struck : null} numberOfLines={2}>{w.main}</T>
                {c.day != null || w.sub ? <T v="tiny" color={colors.ink2} numberOfLines={1}>{[c.day != null ? t('chat.plan.day', { n: c.day + 1 }) : null, w.sub].filter(Boolean).join(' · ')}</T> : null}
              </View>
            </View>
          );
        })}
      </View>
      {card.untouched.length ? (
        <View style={s.line} testID="chat-plan-untouched">
          <Icon name="lock" size={16} color={colors.goldInk} />
          <T v="small" color={colors.ink2} style={{ flex: 1 }}>{t('chat.plan.untouched', { items: joinAnd(card.untouched.map(routeTitle)) })}</T>
        </View>
      ) : null}
      <Button size="small" variant="secondary" label={t('chat.plan.review')} onPress={() => { buzz('tap'); onReview(); }} style={[s.button, s.soft]} testID="chat-plan-diff-review" />
    </Animated.View>
  );
}

/** open_in_app: one button to the place in the app. */
export function LinkCard({ card, onOpen }: { card: LinkChatCard; onOpen: () => void }) {
  return <Button size="small" variant="secondary" label={t(`chat.link.${card.screen}`)} onPress={() => { buzz('tap'); onOpen(); }} style={[s.button, s.soft]} testID={`chat-link-${card.screen}`} />;
}

/** Where a link card goes: the plan screen (U8), the trip, and the rest of the app. */
export function linkHref(screen: LinkChatCard['screen'], id: string | null): string {
  switch (screen) {
    case 'plan': return id ? `/trip/${id}/plan` : '/trips';
    case 'trip': return id ? `/trip/${id}` : '/trips';
    case 'money': return id ? `/trip/${id}/money` : '/trips';
    case 'change': return id ? `/trip/${id}/change` : '/trips';
    case 'refund': return id ? `/trip/${id}/refund` : '/trips';
    case 'documents': return '/wallet';
    case 'household': return '/household';
    case 'esim': return '/esims';
    case 'requests': return '/trips';
    case 'support': return '/support';
    default: return '/trips';
  }
}

const s = StyleSheet.create({
  box: { backgroundColor: colors.paper, borderRadius: radii.card, padding: 16, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  days: { gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line, paddingTop: 12 },
  day: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dayLabel: { width: 52, paddingTop: 2, fontFamily: ff.ui600 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  todo: { gap: 8, backgroundColor: colors.mist, borderRadius: 14, padding: 12 },
  dot: { width: 8, height: 8, borderRadius: 99 },
  struck: { textDecorationLine: 'line-through', color: colors.ink3 },
  button: { height: 44, alignSelf: 'stretch' },
  soft: { backgroundColor: colors.mist },
});
