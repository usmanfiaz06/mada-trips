import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { anchorName, anchorOfLandmark, distanceFrom, formatSar, landmarksIn, roomTitle, shortDay, stayLines, type StayOption } from '@mada/shared';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { StaysMap } from '@/components/maps/StaysMap';
import { ArtSuitcase } from '@/components/trips/Arts';
import { Box, H3, Photo, Rise, Row, Small, Tag, Tiny, TripScreen } from '@/components/trips/ui';
import { bookingApi, usePayDraft, useStayAnchor } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { getLocale, t, tn } from '@/lib/i18n';
import { useHotelDetails } from '@/lib/transfers';
import { colors, ff } from '@/theme';

/*
 * A hotel before booking (certification §5 for the content: HBX Group, from our store, never fetched live): every
 * photo, where it is on a map and how far from where the traveller measures, the rooms for this stay with the total
 * and per night, what each includes and its cancellation in plain words, what the hotel has (the useful things
 * first), and one action: review this room.
 */

/** Facilities nobody chooses a hotel by (payment cards, build year, check-in hour fields, nearby-place markers). */
const NOISE = /year of construction|renovation|number of|check-?in hour|check-?out hour|^hotel$|american express|^visa$|mastercard|\bjcb\b|diners|maestro|credit card|mobile phone coverage|smoke detector|fire|sprinkler|emergency|^airport$|city centre|bus\/?train|nearest bus|golf course$|entertainment area|shopping area|\btv\b|telephone|desk$|safe$|wake-?up|hairdryer|bathtub|shower|heating|metro stop/i;
/** What people look for, in the order they look. */
const FIRST = [/pool/i, /beach/i, /kids|children|playground|mini ?club|babysit/i, /wi-?fi|internet/i, /parking|car park|garage/i, /breakfast|restaurant/i, /spa|sauna|massage|hammam/i, /gym|fitness/i, /connecting|family/i, /wheelchair|accessible|adapted/i, /shuttle|transfer/i, /room service/i, /24-hour reception/i, /laundry/i];
const rank = (name: string) => { const i = FIRST.findIndex((re) => re.test(name)); return i < 0 ? FIRST.length : i; };

export default function HotelScreen() {
  const router = useRouter();
  const lang = getLocale();
  const { code, offer, guests: g, city = '', who = '' } = useLocalSearchParams<{ code: string; offer?: string; guests?: string; city?: string; who?: string }>();
  const guests = Math.max(1, Number(g) || 1);
  const q = useHotelDetails(Number(code));
  const shown = useQuery({ queryKey: ['booking', 'offer', offer], enabled: !!offer, queryFn: () => bookingApi.offer(offer!) });
  const rooms = useQuery({ queryKey: ['booking', 'rooms', offer], enabled: !!offer, staleTime: 300_000, queryFn: () => bookingApi.rooms(offer!) });
  const stored = useStayAnchor((x) => x.byCity[city]);
  const anchor = stored ?? (landmarksIn(city)[0] ? anchorOfLandmark(landmarksIn(city)[0]!) : null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [allFacilities, setAllFacilities] = useState(false);
  const [moreText, setMoreText] = useState(false);
  const h = q.data?.hotel;
  const stay = shown.data?.stay ?? null;
  const options: StayOption[] = rooms.data?.options ?? (stay ? [stay] : []);
  const cur = options.find((o) => o.id === chosen) ?? options[0] ?? null;
  const facilities = useMemo(() => (h?.facilities ?? []).filter((f) => !NOISE.test(f.name)).sort((a, b) => rank(a.name) - rank(b.name)), [h?.facilities]);

  if (!h) return <TripScreen title="">{q.isPending ? <View style={{ paddingTop: 40 }}><ActivityIndicator color={colors.green} /></View> : <EmptyState art={<ArtSuitcase />} title={t('error.notFound')} body="" />}</TripScreen>;
  const lat = h.latitude ?? stay?.facts?.lat ?? null;
  const lng = h.longitude ?? stay?.facts?.lng ?? null;
  const dist = cur && anchor ? distanceFrom(cur, anchor, lang) : null;
  const openMaps = () => {
    if (lat == null || lng == null) return;
    buzz('tap');
    const label = encodeURIComponent(h.name);
    const url = Platform.OS === 'ios' ? `maps://?q=${label}&ll=${lat},${lng}` : Platform.OS === 'android' ? `geo:${lat},${lng}?q=${lat},${lng}(${label})` : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
    void Linking.openURL(url).catch(() => Linking.openURL(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`));
  };
  const review = () => {
    if (!cur) return;
    buzz('tap');
    usePayDraft.getState().set({ draft: { kind: 'stay', stayOfferId: cur.id, travellerIds: who.split(',').filter(Boolean) }, title: cur.name, destination: city });
    router.push('/pay');
  };

  return (
    <TripScreen title={h.name} act={cur ? <Button label={t('search.review', { price: formatSar(cur.total.amount) })} onPress={review} testID="hotel-review" /> : undefined}>
      {h.images.length ? (
        <ScrollView testID="hotel-images" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {h.images.slice(0, 20).map((uri) => <Photo key={uri} uri={uri} style={{ width: 280, height: 190, borderRadius: 16 }} />)}
        </ScrollView>
      ) : null}
      <Rise><T v="h1" accessibilityRole="header">{h.name}</T></Rise>
      <Rise step={1}><Row gap={8} style={{ flexWrap: 'wrap' }}>{h.category ? <Tag tone="gold" label={h.category} /> : null}{stay?.facts?.zone ? <Tag label={stay.facts.zone} /> : null}<Tag label="HBX Group" /></Row></Rise>

      {/* Where it is. */}
      <Box testID="hotel-where" gap={10}>
        <H3 size={15}>{t('hotel.map')}</H3>
        {lat != null && lng != null ? (
          <StaysMap single height={180} points={[{ id: 'hotel', lat, lng, label: h.name, selected: true }]} marks={anchor ? [{ id: anchor.id, lat: anchor.lat, lng: anchor.lng, name: anchorName(anchor, lang) }] : []} testID="hotel-map" />
        ) : null}
        {dist ? <Row gap={6}><Icon name="pin" size={16} /><T v="small" color={colors.green} style={{ flex: 1 }} testID="hotel-distance">{dist.text}</T></Row> : null}
        {h.address ? <Small>{h.address}</Small> : null}
        {lat != null ? <Pressable accessibilityRole="link" onPress={openMaps} testID="hotel-open-maps"><Small color={colors.green} style={{ textDecorationLine: 'underline' }}>{t('hotel.openMaps')}</Small></Pressable> : null}
      </Box>

      {/* The rooms for this stay. */}
      {offer ? (
        <View style={{ gap: 10 }} testID="hotel-rooms">
          <H3 size={17}>{t('hotel.rooms')}</H3>
          {rooms.isPending ? <Row gap={8}><ActivityIndicator color={colors.green} /><Small>{t('hotel.roomsChecking')}</Small></Row> : null}
          {options.map((o, i) => {
            const l = stayLines(o);
            const on = cur?.id === o.id;
            return (
              <Pressable key={o.id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => { buzz('select'); setChosen(o.id); }} style={[st.room, on ? st.roomOn : null]} testID={`hotel-room-${i}`}>
                <View style={[st.radio, on ? st.radioOn : null]}>{on ? <Icon name="check" size={14} color={colors.mist} /> : null}</View>
                <View style={{ flex: 1, gap: 3 }}>
                  <T v="h3" style={{ fontSize: 15 }}>{roomTitle(o.facts?.room ?? o.hotel?.room)}</T>
                  <Small>{l.room.split(' · ').slice(1).join(' · ') || l.room}</Small>
                  <Small color={l.cancel.free ? colors.ok : colors.ink2}>{l.cancel.text}</Small>
                  {l.tax ? <Tiny>{l.tax}</Tiny> : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <T style={st.price}>{formatSar(o.total.amount)}</T>
                  <Tiny>{t('stays.priceFor', { guests: tn('ask.stay.guests', guests) })}</Tiny>
                  <Tiny>{l.perNight}</Tiny>
                </View>
              </Pressable>
            );
          })}
          {cur ? (
            <Box tone="well" gap={6} testID="hotel-cancel">
              <H3 size={15}>{t('hotel.cancelTitle')}</H3>
              <Small color={colors.green}>{cur.facts?.refundable || cur.freeCancelUntil
                ? (cur.freeCancelUntil ? t('hotel.cancelFree', { date: shortDay(cur.freeCancelUntil) }) : t('stay.freeCancelAny'))
                : t('hotel.cancelNone')}</Small>
              {lang === 'en' && cur.cancellation ? <Tiny>{cur.cancellation}</Tiny> : null}
            </Box>
          ) : null}
        </View>
      ) : null}

      {facilities.length ? (
        <Box testID="hotel-facilities">
          <H3 size={15}>{t('hotel.facilities')}</H3>
          <Row gap={6} style={{ flexWrap: 'wrap' }}>{(allFacilities ? facilities : facilities.slice(0, 10)).map((f) => <Tag key={f.name} label={f.paid ? `${f.name} · ${t('hotel.paid')}` : f.name} />)}</Row>
          {facilities.length > 10 ? <Pressable onPress={() => setAllFacilities(!allFacilities)} testID="hotel-facilities-all"><Small color={colors.green} style={{ textDecorationLine: 'underline' }}>{allFacilities ? t('hotel.fewer') : t('hotel.allFacilities', { count: facilities.length })}</Small></Pressable> : null}
        </Box>
      ) : null}
      {h.description ? (
        <Pressable onPress={() => setMoreText(!moreText)} accessibilityRole="button">
          <Small lines={moreText ? undefined : 4}>{h.description}</Small>
          {!moreText ? <Small color={colors.green} style={{ fontFamily: ff.ui500 }}>{t('hotel.readMore')}</Small> : null}
        </Pressable>
      ) : null}
      {h.phone ? <Box gap={4}><Tiny>{t('voucher.phone')}</Tiny><Small color={colors.green}>{h.phone}</Small></Box> : null}
      <Tiny style={{ textAlign: 'center' }}>{t('stays.checked')}</Tiny>
    </TripScreen>
  );
}

const st = StyleSheet.create({
  room: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 18, backgroundColor: colors.paper, borderWidth: 1.5, borderColor: 'transparent' },
  roomOn: { borderColor: colors.green },
  radio: { width: 22, height: 22, borderRadius: 99, borderWidth: 1.5, borderColor: colors.ink3, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  radioOn: { backgroundColor: colors.green, borderColor: colors.green },
  price: { fontFamily: ff.ui600, fontSize: 16, color: colors.green, fontVariant: ['tabular-nums'] },
});
