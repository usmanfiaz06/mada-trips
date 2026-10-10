import { useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Share, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { buildIcs, calendarLink, dayLabel, dayOfMonth, liveStay, weekdayOf, type CalendarEvent, type ItineraryDay, type ItineraryItem, type TripDetail } from '@mada/shared';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { StaleBadge } from '@/components/states/StaleBadge';
import { Icon, type IconName } from '@/components/Icon';
import { Screen, TopBar } from '@/components/Layout';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { ArtCalendar } from '@/components/trips/Arts';
import { MoveNotice, NoStayChoices } from '@/components/trips/MoveNotice';
import { Box, Cells, Display, Eyebrow, Grow, H3, ListRow, Rise, Row, SmallButton, Small, Spread, Tag, Tiny } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { listSep, t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { useItinerary, useTrip } from '@/lib/trips';
import { colors, radii, textEnd } from '@/theme';

type Picked = ItineraryItem & { day: string };
const dl = (d: string) => dayLabel(d, { today: d });

/** Itinerary (prototype TripManage Itinerary): the trip day by day, saved on the phone, with calendar and share. */
export default function Itinerary() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useItinerary(id);
  const trip = useTrip(id).data?.trip;
  const scroll = useRef<ScrollView>(null);
  const tops = useRef<Record<string, number>>({});
  const [dayIdx, setDayIdx] = useState(0);
  const [item, setItem] = useState<Picked | null>(null);
  const [sheet, setSheet] = useState<'share' | 'cal' | null>(null);
  const data = q.data;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/trips'));

  if (!data || !trip) {
    return (
      <Screen>
        <TopBar onBack={back} title={t('itin.title')} />
        {q.isError ? <EmptyState art={<ArtCalendar />} title={t('itin.offTitle')} body={t('itin.offBody')} action={<Button label={t('itin.retry')} onPress={() => void q.refetch()} />} /> : null}
      </Screen>
    );
  }
  const days = data.days;
  const jump = (i: number) => {
    setDayIdx(i);
    buzz('select');
    const y = tops.current[days[i]!.date];
    if (y != null) scroll.current?.scrollTo({ y: y - 8, animated: true });
  };
  const onScroll = (y: number) => {
    let idx = 0;
    days.forEach((d, i) => { const top = tops.current[d.date]; if (top != null && top - 60 <= y) idx = i; });
    if (idx !== dayIdx) setDayIdx(idx);
  };
  return (
    <Screen>
      <TopBar onBack={back} title={t('itin.title')} right={
        <Pressable testID="itin-share-top" accessibilityRole="button" accessibilityLabel={t('itin.shareTitle')} onPress={() => setSheet('share')} hitSlop={10}><Icon name="link" size={20} /></Pressable>
      } />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.daybar} accessibilityRole="tablist" style={{ flexGrow: 0, flexShrink: 0, minHeight: 74 }}>
        {days.map((d, i) => (
          <Pressable key={d.date} testID={`itin-chip-${i}`} accessibilityRole="tab" accessibilityState={{ selected: dayIdx === i }} onPress={() => jump(i)} style={[styles.chip, dayIdx === i && styles.chipOn]}>
            <T v="tiny" color={dayIdx === i ? colors.mist : colors.ink3}>{weekdayOf(d.date)}</T>
            <T v="h3" color={dayIdx === i ? colors.mist : colors.green} style={{ fontVariant: ['tabular-nums'] }}>{String(dayOfMonth(d.date))}</T>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView ref={scroll} scrollEventThrottle={64} onScroll={(e) => onScroll(e.nativeEvent.contentOffset.y)} contentContainerStyle={styles.body}>
        <Rise style={{ gap: 6 }}>
          <Eyebrow>{t('itin.eyebrow', { dates: data.datesLong, n: days.length })}</Eyebrow>
          <Display size={40}>{t('itin.heading', { city: trip.city })}</Display>
          {data.move ? <MoveNotice trip={trip} /> : null}
          <Row gap={8} style={{ flexWrap: 'wrap' }}><Row gap={6}><Icon name="wifiOff" size={14} color={colors.ink3} /><Tiny>{t('itin.saved')}</Tiny></Row><StaleBadge testID="itin-fresh" updatedAt={q.dataUpdatedAt || null} stale={q.isError} /></Row>
        </Rise>
        <Row gap={8}>
          <SmallButton testID="itin-cal" icon="bell" label={t('itin.addCal')} onPress={() => setSheet('cal')} />
          <SmallButton testID="itin-share" icon="link" label={t('itin.share')} onPress={() => setSheet('share')} />
        </Row>
        {days.map((day) => (
          <View key={day.date} onLayout={(e: LayoutChangeEvent) => { tops.current[day.date] = e.nativeEvent.layout.y; }} accessibilityLabel={dl(day.date)}>
            <Day day={day} onPick={(it) => { buzz('tap'); setItem({ ...it, day: day.date }); }} />
          </View>
        ))}
        <Tiny style={{ textAlign: 'center' }}>{data.sameTimeAsHome ? t('itin.sameTime', { city: trip.city }) : t('itin.localTimes')}</Tiny>
      </ScrollView>
      {item ? <ItemSheet trip={trip} it={item} onClose={() => setItem(null)} /> : null}
      <ShareSheet open={sheet === 'share'} text={data.shareText} onClose={() => setSheet(null)} />
      <CalendarSheet open={sheet === 'cal'} events={data.events} name={data.title} onClose={() => setSheet(null)} />
    </Screen>
  );
}

function Day({ day, onPick }: { day: ItineraryDay; onPick: (it: ItineraryItem) => void }) {
  return (
    <View style={styles.day}>
      <Row gap={12} align="flex-start">
        <View style={styles.date}><T v="h2" style={{ fontVariant: ['tabular-nums'] }}>{String(dayOfMonth(day.date))}</T><Tiny>{weekdayOf(day.date)}</Tiny></View>
        <Grow><H3>{day.title}</H3><Tiny>{[dl(day.date), day.prayer].filter(Boolean).join(' · ')}</Tiny></Grow>
      </Row>
      <View style={styles.tl}>
        {day.items.map((it) => (
          <Pressable key={it.id} testID={`itin-item-${it.id}`} accessibilityRole="button" accessibilityLabel={[it.time, it.title].filter(Boolean).join(' ')} onPress={() => onPick(it)} style={[styles.ev, it.status === 'done' && { opacity: 0.55 }]}>
            <T v="small" style={styles.time}>{it.time ?? ''}</T>
            <View style={[styles.dot, it.kind === 'idea' && styles.dotIdea]}><Icon name={it.icon as IconName} size={15} color={it.kind === 'idea' ? colors.ink3 : colors.green} /></View>
            <Grow gap={3}>
              <H3 size={15} color={it.kind === 'idea' ? colors.ink2 : colors.green}>{it.title}</H3>
              {it.sub ? <Tiny>{it.sub}</Tiny> : null}
              {it.facts.length ? <Row gap={10} style={{ flexWrap: 'wrap' }}>{it.facts.map(([k, v]) => <Tiny key={k}><Tiny color={colors.ink3}>{k} </Tiny><Tiny color={colors.green}>{v}</Tiny></Tiny>)}</Row> : null}
              {it.tags.length ? <Row gap={4} style={{ flexWrap: 'wrap' }}>{it.tags.map((g) => <Tag key={g} label={g} tone="ok" />)}</Row> : null}
              {it.status === 'pending' && it.pendingText ? <Tag label={it.pendingText} tone="gold" style={{ alignSelf: 'flex-start' }} /> : null}
              {it.status === 'cancelled' ? <Tag label={t('itin.cancelledAirline')} tone="bad" style={{ alignSelf: 'flex-start' }} /> : null}
              {it.warn ? <Small color={colors.goldInk}>{it.warn}</Small> : null}
            </Grow>
          </Pressable>
        ))}
      </View>
      <Row gap={8} style={styles.docs}><Icon name="doc" size={16} /><Tiny style={{ flex: 1 }}><Tiny color={colors.green}>{t('itin.carry')} </Tiny>{day.docs.join(' · ')}</Tiny></Row>
    </View>
  );
}

function ItemSheet({ trip, it, onClose }: { trip: TripDetail; it: Picked; onClose: () => void }) {
  const router = useRouter();
  const to = (href: string) => { onClose(); router.push(href as Href); };
  const st = liveStay(trip);
  const lead = trip.travellers[0]?.fullName ?? '';
  return (
    <Sheet visible onClose={onClose} label={it.title}>
      <Eyebrow>{dl(it.day)}{it.time ? ` · ${it.time}` : ''}</Eyebrow>
      <T v="h2">{it.title}</T>
      {it.sub ? <T v="body" style={{ marginTop: -8 }}>{it.sub}</T> : null}
      {it.facts.length ? <Cells items={it.facts.map(([k, v]) => ({ k, v }))} /> : null}
      {it.kind === 'flight' ? (<>
        {it.tags.length ? <Small>{t('itin.askedFor', { what: it.tags.join(listSep()) })}</Small> : null}
        <Small>{t('itin.checkInNote')}</Small>
        <Button testID="item-change" label={t('itin.changeFlight')} onPress={() => to(`/trip/${trip.id}/change${it.leg === 'back' ? '?focus=return' : ''}`)} />
        <Row gap={8}>
          <SmallButton grow label={t('itin.special')} onPress={() => to(`/trip/${trip.id}/special`)} />
          <SmallButton grow label={t('itin.passes')} onPress={() => to('/wallet')} />
        </Row>
      </>) : null}
      {it.kind === 'pickup' ? (<>
        {it.driver ? <ListRow first icon="user" title={it.driver} sub={[it.car, it.phone].filter(Boolean).join(' · ')} /> : null}
        {it.warn ? <Small color={colors.goldInk}>{it.warn}</Small> : null}
        <Small>{t('itin.driverWaits', { driver: it.driver ?? t('itin.theDriver') })}</Small>
        {it.phone ? <Button label={t('itin.callDriver', { driver: it.driver ?? t('itin.theDriver') })} onPress={() => void Linking.openURL(`tel:${it.phone!.replace(/\s/g, '')}`).catch(() => toast(t('as.cantOpen')))} /> : null}
        <Button variant="ghost" label={t('action.talk')} onPress={() => to('/support?topic=other')} />
      </>) : null}
      {it.kind === 'hotel' ? (<>
        {st ? <ListRow first icon="pin" title={st.name} sub={st.address ?? ''} /> : null}
        {it.warn ? <Small color={colors.goldInk}>{it.warn}</Small> : null}
        <Small>{t('itin.hotelTimes', { name: lead || t('itin.yourName') })}</Small>
        <Button label={t('itin.hotelOptions')} onPress={() => to(`/trip/${trip.id}/hotel`)} />
      </>) : null}
      {it.kind === 'booked' || it.kind === 'pick' ? (<>
        <Small>{it.status === 'pending' ? t('itin.heldNote', { what: it.pendingText ?? '' }) : t('itin.bookedNote')}</Small>
        {it.status === 'pending' && it.requestId ? <Button label={t('itin.payConfirm')} onPress={() => to(`/pay?requestId=${it.requestId}`)} /> : null}
        <Button variant="ghost" label={t('action.talk')} onPress={() => to('/support?topic=change')} />
      </>) : null}
      {it.kind === 'idea' ? (<>
        <Small>{t('itin.ideaNote')}</Small>
        {it.ask ? <Button label={t('itin.askBook')} onPress={() => to(`/ask?prefill=${encodeURIComponent(it.ask!)}`)} /> : null}
        <Button variant={it.ask ? 'ghost' : 'primary'} label={t('itin.leaveFree')} onPress={onClose} />
      </>) : null}
      {it.kind === 'note' ? <Button label={t('itin.close')} onPress={onClose} /> : null}
      {it.kind === 'nostay' || it.kind === 'own' ? <NoStayChoices trip={trip} onDone={onClose} /> : null}
    </Sheet>
  );
}

const SEES = ['itin.sees.flights', 'itin.sees.hotel', 'itin.sees.drivers', 'itin.sees.tables'] as const;
const HIDDEN = ['itin.hidden.passports', 'itin.hidden.paid', 'itin.hidden.code'] as const;

/** Share as plain text through the phone's share sheet: no passport numbers, no prices, no booking code. */
function ShareSheet({ open, text, onClose }: { open: boolean; text: string; onClose: () => void }) {
  const share = async () => {
    buzz('tap');
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && !navigator.share) { await navigator.clipboard.writeText(text); toast(t('itin.copied')); return; }
      await Share.share({ message: text });
    } catch { toast(t('itin.cantShare')); }
  };
  return (
    <Sheet visible={open} onClose={onClose} label={t('itin.shareTitle')}>
      <T v="h2">{t('itin.shareTitle')}</T>
      <Small style={{ marginTop: -8 }}>{t('itin.shareBody')}</Small>
      <Box tone="well" gap={6}>
        <Eyebrow>{t('itin.theySee')}</Eyebrow>
        {SEES.map((k) => <Row key={k} gap={8}><Icon name="check" size={16} color={colors.ok} /><Small>{t(k)}</Small></Row>)}
        <Eyebrow style={{ marginTop: 6 }}>{t('itin.theyDont')}</Eyebrow>
        {HIDDEN.map((k) => <Row key={k} gap={8}><Icon name="close" size={16} color={colors.badInk} /><Small>{t(k)}</Small></Row>)}
      </Box>
      <Button testID="share-go" label={t('itin.shareBtn')} onPress={() => void share()} />
    </Sheet>
  );
}

/** The moments worth a reminder, one by one, or all at once as an .ics file. */
function CalendarSheet({ open, events, name, onClose }: { open: boolean; events: CalendarEvent[]; name: string; onClose: () => void }) {
  const [added, setAdded] = useState<string[]>([]);
  const [file, setFile] = useState<'saved' | 'failed' | null>(null);
  const key = events.filter((e) => e.key);
  const all = async () => {
    buzz('tap');
    const ics = buildIcs(events, name);
    const fname = `${name.replace(/[^a-zA-Z0-9]+/g, '-')}.ics`;
    try {
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
        const a = document.createElement('a');
        a.href = url; a.download = fname; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } else {
        const { File, Paths } = await import('expo-file-system');
        const f = new File(Paths.cache, fname);
        if (f.exists) f.delete();
        f.create();
        f.write(ics);
        const Sharing = await import('expo-sharing');
        if (!(await Sharing.isAvailableAsync())) throw new Error('no share');
        await Sharing.shareAsync(f.uri, { mimeType: 'text/calendar', UTI: 'com.apple.ical.ics', dialogTitle: name });
      }
      setFile('saved');
      buzz('success');
    } catch { setFile('failed'); }
  };
  return (
    <Sheet visible={open} onClose={onClose} label={t('itin.addCal')}>
      <T v="h2">{t('itin.calTitle')}</T>
      <Small style={{ marginTop: -8 }}>{t('itin.calBody', { n: key.length })}</Small>
      <View>
        {key.map((e, i) => (
          <Spread key={e.uid} style={[styles.evrow, i === 0 && { borderTopWidth: 0 }]}>
            <Grow gap={1}><Small color={colors.green}>{e.title}</Small><Tiny>{`${dl(e.day)} · ${e.time}`}</Tiny></Grow>
            <SmallButton testID={`cal-add-${i}`} tone={added.includes(e.uid) ? 'soft' : 'secondary'} icon={added.includes(e.uid) ? 'check' : undefined} label={added.includes(e.uid) ? t('itin.added') : t('itin.add')}
              onPress={() => { buzz('tap'); setAdded((a) => [...a, e.uid]); void Linking.openURL(calendarLink(e)).catch(() => toast(t('as.cantOpen'))); }} />
          </Spread>
        ))}
      </View>
      <Button testID="cal-all" variant="secondary" label={t('itin.allFile')} onPress={() => void all()} />
      {file === 'saved' ? <Small color={colors.ok}>{t('itin.fileSaved', { n: events.length })}</Small> : null}
      {file === 'failed' ? <Box tone="warn"><Small>{t('itin.fileFailed')}</Small></Box> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  daybar: { gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  chip: { width: 52, height: 58, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mist, gap: 0 },
  chipOn: { backgroundColor: colors.green },
  body: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 80, gap: 16 },
  day: { gap: 12, backgroundColor: colors.paper, borderRadius: radii.card, padding: 16 },
  date: { width: 46, alignItems: 'center' },
  tl: { gap: 2 },
  ev: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  time: { width: 44, textAlign: textEnd(), fontVariant: ['tabular-nums'], paddingTop: 6, color: colors.ink2 },
  dot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  dotIdea: { borderStyle: 'dashed', backgroundColor: colors.paper },
  docs: { backgroundColor: colors.mist, borderRadius: radii.sm, padding: 10 },
  evrow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line, gap: 10 },
});
