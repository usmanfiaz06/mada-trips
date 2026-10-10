import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { create } from 'zustand';
import { headerDay, hijriLabel, outSegment, rangeLong, todayIn, zonedToInstant, type TripDetail, type TripPhase } from '@mada/shared';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { useTopInset } from '@/components/Layout';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { Sun } from '@/components/Sun';
import { VGradient } from '@/components/Gradient';
import { Box, Grow, H3, Photo, Row, Small, Spread, Tag, Tiny, Veil, Display } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { DEMO_ALLOWED, useDemo, useTrips } from '@/lib/trips';
import { colors, ff, radii, shadow } from '@/theme';

/* Pieces Today shares across its moments: the header, the morning wash, the trip hero, banners and the demo panel. */

/** The header date follows the moment of the trip: on travel day it's the travel day, not the phone's calendar. */
export function dateLine(clock: TripDetail['clock'] | null): string {
  const live = clock && ['daybefore', 'travelday', 'delayed', 'cancelled', 'inair', 'landed', 'home'].includes(clock.phase);
  const at = live ? new Date(clock!.now) : new Date();
  const hijri = hijriLabel(at);
  return `${headerDay(at)}${hijri ? ` · ${hijri}` : ''}`;
}

/** A soft wash at the top that follows the hour. */
export function Wash({ hour }: { hour: number }) {
  const c = hour >= 5 && hour < 8 ? 'rgba(240,200,160,0.55)' : hour >= 15 && hour < 18 ? 'rgba(217,183,122,0.45)' : hour >= 18 || hour < 5 ? 'rgba(30,53,45,0.2)' : 'rgba(255,248,236,0.9)';
  return <View pointerEvents="none" style={{ position: 'absolute', top: 0, start: 0, end: 0, height: 360 }}><VGradient id="wash" stops={[[0, c], [1, 'rgba(233,226,216,0)']]} /></View>;
}

export function TodayHeader({ clock, unread }: { clock: TripDetail['clock'] | null; unread: number }) {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const guest = useSession((s) => s.status === 'guest');
  const demo = useDemo((s) => s.phase);
  const [, open] = useDemoSheet();
  return (
    <Spread>
      <Pressable onLongPress={() => DEMO_ALLOWED && open(true)} delayLongPress={500} accessibilityRole="text" testID="today-date">
        <T v="small" style={{ fontFamily: ff.ui500 }}>{dateLine(clock)}</T>
        {demo ? <Tiny color={colors.goldInk}>{t('td.demo.showing', { phase: t(`td.demo.phase.${demo}`) })}</Tiny> : null}
      </Pressable>
      <Row gap={8}>
        {!guest ? (
          <Pressable testID="bell" accessibilityRole="button" accessibilityLabel={t('today.a11y.notifications')} onPress={() => { buzz('tap'); router.push('/inbox' as Href); }} style={styles.bell}>
            <Icon name="bell" size={19} />
            {unread > 0 ? <View style={styles.bellDot} /> : null}
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel={t('today.a11y.profile')} onPress={() => { buzz('tap'); router.push((guest ? '/welcome' : '/profile') as Href); }}>
          {user?.name ? <Avatar initial={user.name} tone="green" size={44} /> : <View style={[styles.bell, { backgroundColor: colors.mist }]}><Icon name="user" size={18} /></View>}
        </Pressable>
      </Row>
    </Spread>
  );
}

/** The countdown follows the moment of the trip: the day before always reads "Tomorrow". */
export function tripWhen(trip: TripDetail): string {
  const out = outSegment(trip);
  const dep = out?.departLocal.slice(11, 16);
  const p = trip.clock.phase;
  if (p === 'daybefore') return dep ? t('td.when.tomorrowAt', { time: dep }) : t('td.when.tomorrow');
  if (p === 'travelday' || p === 'delayed' || p === 'cancelled') return dep ? t('td.when.todayAt', { time: dep }) : t('td.when.today');
  const start = out ? out.departLocal.slice(0, 10) : trip.startDate;
  const days = Math.round((zonedToInstant(`${start}T12:00`, 'Asia/Riyadh').getTime() - new Date(trip.clock.now).getTime()) / 86_400_000);
  if (days <= 0) return t('td.when.thisWeek');
  if (days < 14) return t('td.when.inDays', { n: days });
  return t('td.when.inWeeks', { n: Math.round(days / 7) });
}

/** The trip as a photo, with the countdown and the route on glass (.td-hero). */
export function TripHero({ trip, height = 230, children }: { trip: TripDetail; height?: number; children?: ReactNode }) {
  const router = useRouter();
  const out = outSegment(trip);
  const n = trip.travellers.length;
  const sub = [rangeLong(trip.startDate, trip.endDate), n === 1 ? t('td.justYou') : t('td.travellers', { n }), out ? out.carrierName + (out.cabin !== 'economy' ? ` ${t(`trip.cabin.${out.cabin}`)}` : '') : null].filter(Boolean).join(' · ');
  return (
    <Pressable testID="trip-hero" accessibilityRole="button" accessibilityLabel={`${trip.city}, ${tripWhen(trip)}. ${t('td.openTrip')}`} onPress={() => { buzz('tap'); router.push(`/trip/${trip.id}` as Href); }}
      style={({ pressed }) => [pressed ? { transform: [{ scale: 0.99 }] } : null]}>
      <Photo k={trip.imageUrl} style={[{ height, borderRadius: radii.card }, shadow('focal')]}>
        <Veil id={`hero-${height}`} />
        <View style={styles.heroTop}>
          <Tag label={tripWhen(trip)} tone="when" />
          {out ? <Tag label={`${out.from} → ${out.to}`} tone="glass" /> : null}
        </View>
        <View style={styles.heroOver}>
          <Display size={44} color={colors.paper}>{trip.city}</Display>
          <T style={styles.heroSub}>{sub}</T>
          {children}
        </View>
      </Photo>
    </Pressable>
  );
}

/** "Mada is working on your visa": the newest open request, on Today. */
export function RequestsCard() {
  const router = useRouter();
  const { data } = useTrips();
  const open = (data?.requests ?? []).filter((r) => !['done', 'confirmed', 'cancelled'].includes(r.status));
  const r = open[0];
  if (!r) return null;
  const priced = r.status === 'quoted' || r.status === 'awaiting_payment';
  return (
    <Box onPress={() => router.push('/trips?tab=requests' as Href)} label={r.title} testID="requests-card">
      <Row gap={12}>
        <Avatar initial="F" tone="green" />
        <Grow>
          <H3>{priced ? t('td.req.answer', { what: (r.short ?? r.title).toLowerCase() }) : t('td.req.working', { what: (r.short ?? r.title).toLowerCase() })}</H3>
          <Small>{priced ? t('td.req.tap') : r.status === 'queued' ? t('td.req.queued') : t('td.req.usually')}</Small>
        </Grow>
        <Icon name="chevron" />
      </Row>
    </Box>
  );
}

/* ───────── lock-screen-style banners (every one is also in the inbox) ───────── */

type BannerMsg = { id: number; title: string; body: string; href?: string };
export const useBanner = create<{ msg: BannerMsg | null; show: (m: Omit<BannerMsg, 'id'>) => void; hide: () => void }>((set) => ({
  msg: null,
  show(m) { buzz('warn'); set({ msg: { ...m, id: Date.now() } }); setTimeout(() => set((s) => (s.msg && Date.now() - s.msg.id >= 5000 ? { msg: null } : s)), 5200); },
  hide() { set({ msg: null }); },
}));

export function BannerHost() {
  const router = useRouter();
  const top = useTopInset();
  const { msg, hide } = useBanner();
  if (!msg) return null;
  return (
    <Animated.View key={msg.id} entering={FadeInUp.duration(450)} exiting={FadeOutUp.duration(250)} style={[styles.banner, shadow('focal'), { top: top + 4 }]}>
      <Pressable testID="banner" accessibilityRole="alert" onPress={() => { hide(); if (msg.href) router.push(msg.href as Href); }} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View style={styles.appIc}><Sun width={22} /></View>
        <Grow>
          <Spread><H3 size={15}>{msg.title}</H3><Tiny>{t('td.banner.now')}</Tiny></Spread>
          <Small color={colors.inkSoft}>{msg.body}</Small>
        </Grow>
      </Pressable>
    </Animated.View>
  );
}

/* ───────── the demo panel: pick a moment of the trip (mock mode and review builds only) ───────── */

const PHASES: TripPhase[] = ['none', 'booked', 'daybefore', 'travelday', 'delayed', 'cancelled', 'inair', 'landed', 'home'];
const useDemoSheetStore = create<{ open: boolean; set: (o: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));
export const useDemoSheet = (): [boolean, (o: boolean) => void] => [useDemoSheetStore((s) => s.open), useDemoSheetStore((s) => s.set)];

export function DemoSheet() {
  const [open, setOpen] = useDemoSheet();
  const { phase, setPhase, offline, setOffline } = useDemo();
  if (!DEMO_ALLOWED) return null;
  return (
    <Sheet visible={open} onClose={() => setOpen(false)} label={t('td.demo.title')}>
      <T v="h2">{t('td.demo.title')}</T>
      <Small style={{ marginTop: -8 }}>{t('td.demo.body')}</Small>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Pressable onPress={() => { setPhase(null); setOpen(false); }} style={[styles.demoChip, !phase ? styles.demoOn : null]}><T v="h3" color={!phase ? colors.mist : colors.green}>{t('td.demo.real')}</T></Pressable>
        {PHASES.map((p) => (
          <Pressable key={p} testID={`demo-${p}`} onPress={() => { setPhase(p); setOpen(false); }} style={[styles.demoChip, phase === p ? styles.demoOn : null]}>
            <T v="h3" color={phase === p ? colors.mist : colors.green}>{t(`td.demo.phase.${p}`)}</T>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={() => setOffline(!offline)} style={[styles.demoChip, offline ? styles.demoOn : null, { alignSelf: 'flex-start' }]}><T v="h3" color={offline ? colors.mist : colors.green}>{t('td.demo.offline')}</T></Pressable>
    </Sheet>
  );
}


export const todayHour = () => Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Riyadh' }).format(new Date()));
export const realToday = () => todayIn();

const styles = StyleSheet.create({
  bell: { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mist },
  bellDot: { position: 'absolute', top: 8, end: 9, width: 8, height: 8, borderRadius: 99, backgroundColor: colors.goldDeep, borderWidth: 2, borderColor: colors.mist },
  heroTop: { position: 'absolute', top: 14, start: 14, end: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, zIndex: 1 },
  heroOver: { flex: 1, justifyContent: 'flex-end', padding: 18, gap: 2 },
  heroSub: { fontSize: 14, lineHeight: 19, color: 'rgba(255,253,249,0.9)', fontFamily: ff.ui400 },
  banner: { position: 'absolute', start: 10, end: 10, zIndex: 70, backgroundColor: 'rgba(255,253,249,0.96)', borderRadius: 22, paddingVertical: 12, paddingHorizontal: 14 },
  appIc: { width: 36, height: 36, borderRadius: 9, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  demoChip: { height: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.mist, justifyContent: 'center' },
  demoOn: { backgroundColor: colors.green },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.green, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14 },
});
