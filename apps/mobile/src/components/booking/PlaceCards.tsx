import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Image as ExpoImage, type ImageSource } from 'expo-image';
import { addDays, dayLabel, type ChatCard, type ChatPlace } from '@mada/shared';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { planKey, plansApi, usePlan } from '@/lib/plans';
import { queryClient } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { colors, ff, radii } from '@/theme';
import { initialOf, toneOf } from './HotelPhoto';
import { Photo, enter } from './parts';

/*
 * Places from Google in a conversation (docs/app/CONNECT.md §32): up to five as a list (photo, name, kind, rating, price
 * level, open now or when it opens, how far from the hotel), and one in full (photo with its author's credit, open or
 * closed with today's hours, address, Directions, Call, Website, Add to plan). Both carry "Google Maps", as Google's
 * terms ask. Open now comes from the server, worked out when the card was made. Numbers stay left to right in Arabic.
 */

type PlacesChatCard = Extract<ChatCard, { type: 'places' }>;
type PlaceChatCard = Extract<ChatCard, { type: 'place' }>;

const rtl = () => getLocale() === 'ar';
/** Keeps "4.6 (18,420)" and "02:00" left-to-right inside an Arabic line (Arabic text, like Google's Arabic hours, as it is). */
const iso = (s: string) => (rtl() && !/[\u0600-\u06FF]/.test(s) ? `⁦${s}⁩` : s);

/** "350 m", "1.4 km": the number kept left-to-right, the unit where the language puts it. */
export function distanceWords(m: number): string {
  return m < 1000 ? t('chat.places.m', { m: iso(String(Math.max(10, Math.round(m / 10) * 10))) }) : t('chat.places.km', { km: iso((m / 1000).toFixed(1).replace(/\.0$/, '')) });
}

/** "Open · closes 23:00", "Open now", "Closed · opens 09:00", "Closed"; null without hours. */
export function openWords(p: ChatPlace): { text: string; open: boolean } | null {
  if (!p.open) return null;
  if (p.open.now) return { text: p.open.closes ? t('chat.places.closesAt', { time: iso(p.open.closes) }) : t('chat.places.openNow'), open: true };
  return { text: p.open.opens ? t('chat.places.opensAt', { time: iso(p.open.opens) }) : t('chat.places.closed'), open: false };
}

const priceWords = (p: ChatPlace) => (p.price ? t(`chat.places.price.${p.price}` as 'chat.places.price.1') : null);

/** Google's map, with the place as the destination: the phone's maps app or the browser. */
export function directionsUrl(p: ChatPlace): string {
  const to = p.lat != null && p.lng != null ? `${p.lat},${p.lng}` : encodeURIComponent([p.name, p.address].filter(Boolean).join(', '));
  return `https://www.google.com/maps/dir/?api=1&destination=${to}&destination_place_id=${encodeURIComponent(p.id)}`;
}
const open = (url: string) => { buzz('tap'); void Linking.openURL(url); };

/** The mock demo's own photos ("photo:turkish-breakfast"): pictures the app already ships elsewhere. */
const DEMO_PHOTOS: Record<string, ImageSource> = {
  'turkish-breakfast': require('../../../assets/photos/turkish-breakfast.jpg'),
  'dubai-creek': require('../../../assets/photos/dubai-creek.jpg'),
  'desert-camp': require('../../../assets/photos/desert-camp.jpg'),
};

/** The place's photo, a demo photo, or its initial on a soft tone. */
function PlacePhoto({ p, testID }: { p: ChatPlace; testID?: string }) {
  const [failed, setFailed] = useState(false);
  const uri = p.photo?.url ?? null;
  if (uri?.startsWith('photo:')) {
    const own = DEMO_PHOTOS[uri.slice(6)];
    return own ? <ExpoImage source={own} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} testID={testID} /> : <Photo name={uri.slice(6)} />;
  }
  if (uri && !failed) return <ExpoImage source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} recyclingKey={p.id} accessible={false} onError={() => setFailed(true)} testID={testID} />;
  return (
    <View style={[StyleSheet.absoluteFill, s.tile, { backgroundColor: toneOf(p.id) }]} accessible={false}>
      <T style={s.initial}>{initialOf(p.name)}</T>
    </View>
  );
}

function Rating({ p }: { p: ChatPlace }) {
  if (p.rating == null) return null;
  return (
    <View style={s.inline} accessible accessibilityLabel={t('chat.places.a11y.rating', { rating: String(p.rating), count: (p.ratings ?? 0).toLocaleString('en-US') })}>
      <Icon name="star" size={14} color={colors.goldInk} />
      <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{iso(p.rating.toFixed(1))}</T>
      {p.ratings != null ? <T v="tiny" color={colors.ink2}>{iso(`(${p.ratings.toLocaleString('en-US')})`)}</T> : null}
    </View>
  );
}

function OpenLine({ p, withToday }: { p: ChatPlace; withToday?: boolean }) {
  const w = openWords(p);
  if (!w) return withToday ? <T v="tiny" color={colors.ink2}>{t('chat.places.noHours')}</T> : null;
  return (
    <View style={s.inline}>
      <View style={[s.dot, { backgroundColor: w.open ? colors.ok : colors.ink3 }]} />
      <T v="small" color={w.open ? colors.ok : colors.ink2} style={{ fontFamily: ff.ui500, flexShrink: 1 }} testID="place-open">{w.text}</T>
    </View>
  );
}

/** "Google Maps": the credit every places card carries. */
function GoogleCredit({ photoBy }: { photoBy?: string | null }) {
  return (
    <View style={s.credit} testID="places-google">
      <T v="tiny" color={colors.ink3} style={{ fontFamily: ff.ui500 }}>{t('chat.places.google')}</T>
      {photoBy ? <T v="tiny" color={colors.ink3} numberOfLines={1} style={{ flexShrink: 1 }}>{`\u00A0· ${t('chat.places.photoBy', { name: `⁨${photoBy}⁩` })}`}</T> : null}
    </View>
  );
}

/** Up to five places: a row each; a tap asks Mada for that one in full. */
export function PlacesCard({ card, onSay }: { card: PlacesChatCard; onSay?: (text: string) => void }) {
  return (
    <Animated.View entering={enter(0)} style={{ gap: 8 }} testID="chat-places">
      {card.places.map((p, i) => {
        const sub = [p.type, priceWords(p)].filter(Boolean).join(' · ');
        return (
          <Card key={p.id} padding={0} onPress={onSay ? () => { buzz('tap'); onSay(t('chat.places.more', { name: p.name })); } : undefined} accessibilityLabel={[p.name, sub, openWords(p)?.text].filter(Boolean).join(', ')} style={{ overflow: 'hidden' }}>
            <View style={s.row} testID={`chat-place-${i}`}>
              <View style={s.thumb}><PlacePhoto p={p} /></View>
              <View style={{ flex: 1, gap: 3, paddingVertical: 10 }}>
                <T v="h3" style={{ fontSize: 15, lineHeight: 20 }} numberOfLines={1}>{p.name}</T>
                {sub ? <T v="tiny" color={colors.ink2} numberOfLines={1}>{sub}</T> : null}
                <View style={[s.inline, { gap: 10, flexWrap: 'wrap' }]}>
                  <Rating p={p} />
                  {p.distanceM != null ? <View style={s.inline}><Icon name="pin" size={13} color={colors.ink3} /><T v="tiny" color={colors.ink2}>{t('chat.places.fromHotel', { distance: distanceWords(p.distanceM) })}</T></View> : null}
                </View>
                <OpenLine p={p} />
              </View>
            </View>
          </Card>
        );
      })}
      <GoogleCredit />
    </Animated.View>
  );
}

/** One place in full, with what to do next. */
export function PlaceCard({ card, onSay }: { card: PlaceChatCard; onSay?: (text: string) => void }) {
  const p = card.place;
  const [days, setDays] = useState(false);
  const sub = [p.type, priceWords(p)].filter(Boolean).join(' · ');
  const by = p.photo?.credit[0]?.name ?? null;
  const add = () => {
    buzz('tap');
    if (card.tripId) setDays(true);
    else onSay?.(t('chat.places.addSay', { name: p.name }));
  };
  return (
    <Animated.View entering={enter(0)} testID="chat-place-card">
      <Card padding={0} style={{ overflow: 'hidden', gap: 0 }} accessibilityLabel={[p.name, sub].filter(Boolean).join(', ')}>
        <View style={s.photo}><PlacePhoto p={p} testID="chat-place-photo" /></View>
        <View style={s.body}>
          <T v="h3" style={{ fontSize: 17, lineHeight: 23 }} accessibilityRole="header">{p.name}</T>
          {sub ? <T v="small" color={colors.ink2}>{sub}</T> : null}
          <View style={[s.inline, { gap: 12, flexWrap: 'wrap' }]}>
            <Rating p={p} />
            {p.distanceM != null ? <T v="tiny" color={colors.ink2}>{t('chat.places.fromHotel', { distance: distanceWords(p.distanceM) })}</T> : null}
          </View>
          <OpenLine p={p} withToday />
          {p.today ? <T v="tiny" color={colors.ink2} testID="place-today">{t('chat.places.today', { hours: iso(p.today) })}</T> : null}
          {p.address ? (
            <View style={[s.inline, { alignItems: 'flex-start' }]}>
              <Icon name="pin" size={15} color={colors.ink3} />
              <T v="small" color={colors.green} style={{ flex: 1 }}>{p.address}</T>
            </View>
          ) : null}
          <View style={s.buttons}>
            <Button size="small" block={false} label={t('chat.places.directions')} icon={<Icon name="map" size={16} color={colors.mist} />} onPress={() => open(directionsUrl(p))} style={s.button} testID="place-directions" />
            {p.phone ? <Button size="small" block={false} variant="secondary" label={t('chat.places.call')} icon={<Icon name="phone" size={16} />} onPress={() => open(`tel:${p.phone!.replace(/[^\d+]/g, '')}`)} style={[s.button, s.soft]} testID="place-call" /> : null}
            {p.website ? <Button size="small" block={false} variant="secondary" label={t('chat.places.website')} icon={<Icon name="globe" size={16} />} onPress={() => open(p.website!)} style={[s.button, s.soft]} testID="place-website" /> : null}
          </View>
          <Button size="small" variant="secondary" label={t('chat.places.addToPlan')} icon={<Icon name="plus" size={16} />} onPress={add} style={[s.wide, s.soft]} testID="place-add" />
          <GoogleCredit photoBy={by} />
        </View>
      </Card>
      {card.tripId ? <DaySheet visible={days} onClose={() => setDays(false)} tripId={card.tripId} p={p} onSay={onSay} /> : null}
    </Animated.View>
  );
}

const FOOD = /restaurant|caf[eé]|coffee|bakery|food|grill|shawarma|kebab|مطعم|مقهى|كافيه|قهوة|مخبز/i;

/** "Which day?": the plan's days; a tap adds the place to that day as an idea, with where it is and Google's id. */
function DaySheet({ visible, onClose, tripId, p, onSay }: { visible: boolean; onClose: () => void; tripId: string; p: ChatPlace; onSay?: (text: string) => void }) {
  const q = usePlan(visible ? tripId : null);
  const [busy, setBusy] = useState<number | null>(null);
  const plan = q.data?.plan;
  const locale = getLocale();
  const pick = async (day: number) => {
    if (!plan) return;
    setBusy(day);
    try {
      const r = await plansApi.ops(tripId, plan.version, [{ op: 'add', day, item: { kind: FOOD.test(p.type ?? p.name) ? 'meal' : 'activity', title: p.name.slice(0, 120), place: { name: p.name.slice(0, 120), kind: 'place', lat: p.lat, lng: p.lng, gid: p.id } } }]);
      queryClient.setQueryData(planKey(tripId), (old: typeof q.data) => (old ? { ...old, plan: r.plan } : old));
      buzz('success');
      toast(t('chat.places.added', { n: day + 1 }));
      onClose();
    } catch {
      // No plan to add to (or it changed meanwhile): Mada does it in the chat.
      onClose();
      onSay?.(t('chat.places.addSay', { name: p.name }));
    } finally {
      setBusy(null);
    }
  };
  const count = plan ? plan.days : 0;
  return (
    <Sheet visible={visible} onClose={onClose} label={t('chat.places.pickDay')}>
      <View style={{ gap: 8 }} testID="place-days">
        {q.isError ? <Button label={t('chat.places.addSay', { name: p.name })} onPress={() => { onClose(); onSay?.(t('chat.places.addSay', { name: p.name })); }} /> : null}
        {Array.from({ length: count }, (_, d) => (
          <Pressable key={d} onPress={() => void pick(d)} disabled={busy !== null} style={s.day} accessibilityRole="button" testID={`place-day-${d}`}>
            <Icon name="calendar" size={16} color={colors.ink3} />
            <T v="body" color={colors.green} style={{ flex: 1 }}>{t('chat.places.day', { n: d + 1, date: dayLabel(addDays(plan!.startDate, d), { locale }) })}</T>
            <Icon name={busy === d ? 'more' : 'plus'} size={16} color={colors.green} />
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingEnd: 14 },
  thumb: { width: 84, alignSelf: 'stretch', minHeight: 92, backgroundColor: colors.stage, position: 'relative' },
  photo: { height: 150, position: 'relative', backgroundColor: colors.stage },
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, gap: 7 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 99 },
  tile: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: ff.ui600, fontSize: 26, lineHeight: 30, color: colors.goldInk },
  credit: { flexDirection: 'row', alignItems: 'center', paddingTop: 2 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
  button: { height: 44, flexGrow: 1 },
  wide: { height: 44, alignSelf: 'stretch' },
  soft: { backgroundColor: colors.mist },
  day: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14, borderRadius: radii.card, backgroundColor: colors.paper },
});
