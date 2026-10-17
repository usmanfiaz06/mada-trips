import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { anchorName, anchorOfLandmark, nameIn, catalogueHotelByKey, distanceFrom, formatSar, landmarksIn, roomTitle, shortDay, stayLines, type StayOption } from '@mada/shared';
import { Button } from '@/components/Button';
import { HotelRequestsAsked } from '@/components/booking/HotelRequests';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { StaysMap } from '@/components/maps/StaysMap';
import { ArtSuitcase } from '@/components/trips/Arts';
import { Box, H3, Photo, Rise, Row, Small, Tag, Tiny, TripScreen } from '@/components/trips/ui';
import { bookingApi, usePayDraft, useStayAnchor } from '@/lib/booking';
import { useTrip } from '@/lib/trips';
import { rangeLabel, stayEnd } from '@mada/shared';
import { buzz } from '@/lib/haptics';
import { getLocale, t, tn } from '@/lib/i18n';
import { transferKeys, transfersApi, useHotelDetails } from '@/lib/transfers';
import { api } from '@/lib/api';
import { accountIds } from '@/lib/guest';
import { herePath, requireAccount } from '@/lib/signin-ask';
import { TranslateToggle, WrittenInEnglish, useTranslated } from '@/components/booking/Translate';
import { colors, ff, font } from '@/theme';

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
  const { code, offer, guests: g, city = '', who = '', trip: tripId = '', stay: stayId = '' } = useLocalSearchParams<{ code: string; offer?: string; guests?: string; city?: string; who?: string; trip?: string; stay?: string }>();
  const guests = Math.max(1, Number(g) || 1);
  // A booked stay (opened from the trip): the room and dates come from the trip; the hotel's content when it has a code.
  const tripQ = useTrip(tripId || null);
  const booked = tripId ? tripQ.data?.trip.stays.find((x) => x.id === stayId) ?? null : null;
  const hasCode = Number.isInteger(Number(code)) && Number(code) > 0;
  const q = useHotelDetails(hasCode ? Number(code) : 0);
  const shown = useQuery({ queryKey: ['booking', 'offer', offer], enabled: !!offer, queryFn: () => bookingApi.offer(offer!) });
  const rooms = useQuery({ queryKey: ['booking', 'rooms', offer], enabled: !!offer, staleTime: 300_000, queryFn: () => bookingApi.rooms(offer!) });
  const cityKey = city || catalogueHotelByKey(code)?.city || '';
  const stored = useStayAnchor((x) => x.byCity[cityKey]);
  const anchor = stored ?? (landmarksIn(cityKey)[0] ? anchorOfLandmark(landmarksIn(cityKey)[0]!) : null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [allFacilities, setAllFacilities] = useState(false);
  const [moreText, setMoreText] = useState(false);
  const details = q.data?.hotel;
  // A catalogue stay has no supplier content: the page is the stay itself (name, address, phone, the walk).
  // A hotel from Mada's own catalogue (the Istanbul bundle's, an Umrah hotel near the Haram), opened by its key before booking.
  const cat = !hasCode && !tripId ? catalogueHotelByKey(code) : null;
  const h = details ?? (booked ? { code: 0, name: booked.name, category: null, address: booked.address, phone: booked.phone, description: null, images: [], facilities: [], latitude: null, longitude: null, source: 'HBX Group' as const }
    : cat ? { code: 0, name: cat.name, category: cat.area, address: cat.address, phone: null, description: cat.note, images: [], facilities: [], latitude: cat.lat, longitude: cat.lng, source: 'HBX Group' as const } : undefined);
  const stay = shown.data?.stay ?? null;
  const options: StayOption[] = rooms.data?.options ?? (stay ? [stay] : []);
  const cur = options.find((o) => o.id === chosen) ?? options[0] ?? null;
  // The hotel wrote its words in English: on an Arabic page they show as written, with "Translate" (translated once, kept).
  const tr = useTranslated(transferKeys.translation(Number(code), lang), () => transfersApi.hotelTranslation(Number(code), lang));
  const canTranslate = lang === 'ar' && !!details && (!!details.description || details.facilities.length > 0);
  const trNames = useMemo(() => new Map((details?.facilities ?? []).filter((f) => f.name).map((f, i) => [f.name, tr.data?.facilities[i] ?? null])), [details?.facilities, tr.data]);
  const facilities = useMemo(() => (details?.facilities ?? []).filter((f) => !NOISE.test(f.name)).sort((a, b) => rank(a.name) - rank(b.name)), [details?.facilities]);

  if (!h) return <TripScreen title="">{q.isPending || tripQ.isPending ? <View style={{ paddingTop: 40 }}><ActivityIndicator color={colors.green} /></View> : <EmptyState art={<ArtSuitcase />} title={t('error.notFound')} body="" />}</TripScreen>;
  const lat = h.latitude ?? stay?.facts?.lat ?? null;
  const lng = h.longitude ?? stay?.facts?.lng ?? null;
  const dist = cur && anchor ? distanceFrom(cur, anchor, lang) : null;
  const openMaps = () => {
    buzz('tap');
    const label = encodeURIComponent(h.name);
    if (lat == null || lng == null) {
      // No pin: search the address by name (a catalogue stay).
      const where = encodeURIComponent(`${h.name} ${h.address ?? ''}`.trim());
      void Linking.openURL(Platform.OS === 'ios' ? `maps://?q=${where}` : Platform.OS === 'android' ? `geo:0,0?q=${where}` : `https://www.openstreetmap.org/search?query=${where}`).catch(() => {});
      return;
    }
    const url = Platform.OS === 'ios' ? `maps://?q=${label}&ll=${lat},${lng}` : Platform.OS === 'android' ? `geo:${lat},${lng}?q=${lat},${lng}(${label})` : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
    void Linking.openURL(url).catch(() => Linking.openURL(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`));
  };
  const review = async () => {
    if (!cur) return;
    // Looking around without an account: "Sign in to book this", then back on this hotel with this room.
    if (!requireAccount('book', herePath() ?? `/hotel/${code}?${new URLSearchParams({ ...(offer ? { offer } : {}), guests: String(guests), city, who }).toString()}`)) return;
    buzz('tap');
    // People added before signing in are the account's now (lib/guest.ts).
    const ids = await accountIds(who.split(',').filter(Boolean), api);
    usePayDraft.getState().set({ draft: { kind: 'stay', stayOfferId: cur.id, travellerIds: ids }, title: cur.name, destination: city });
    router.push('/pay');
  };

  return (
    <TripScreen act={booked ? <Button label={t('hotel.booked.options')} variant="secondary" onPress={() => router.push(`/trip/${tripId}/hotel` as never)} testID="hotel-booked-options" /> : cur ? <Button label={t('search.review', { price: formatSar(cur.total.amount) })} onPress={() => { void review(); }} testID="hotel-review" /> : undefined}>
      {/* The photos run edge to edge and the name is the screen's serif line: the hotel, before its facts. */}
      {h.images.length ? (
        <ScrollView testID="hotel-images" horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}>
          {h.images.slice(0, 20).map((uri) => <Photo key={uri} uri={uri} style={{ width: 300, height: 224, borderRadius: 20 }} />)}
        </ScrollView>
      ) : null}
      <Rise><T style={font('displaySmall')} accessibilityRole="header">{h.name}</T></Rise>
      <Rise step={1}><Row gap={8} style={{ flexWrap: 'wrap' }}>{booked ? <Tag tone="ok" label={booked.status === 'cancelled' ? t('tm.detail.cancelled') : t('hotel.booked.tag')} /> : null}{h.category ? <Tag tone="gold" label={nameIn(h.category, lang)} /> : null}{stay?.facts?.zone ? <Tag label={stay.facts.zone} /> : null}{details ? <Tag label="HBX Group" /> : null}</Row></Rise>

      {/* Your booking: the room and dates as booked, the confirmation, the cancellation rule, the walk and the drive. */}
      {booked ? (
        <Box testID="hotel-booked" gap={6}>
          <H3 size={15}>{booked.roomType ?? (booked.rooms > 1 ? t('trip.connectingRooms') : t('trip.aRoom'))}</H3>
          <Small color={colors.green}>{rangeLabel(booked.checkIn, stayEnd(booked))} · {t('tm.detail.nights', { n: booked.nights })}</Small>
          {booked.confirmation ? <Tiny>{t('hotel.booked.ref', { ref: booked.confirmation })}</Tiny> : null}
          {booked.cancellation ? <Tiny>{booked.cancellation}</Tiny> : null}
          {booked.walk || booked.fromAirport ? <Tiny>{[booked.walk, booked.fromAirport ? t('hotel.booked.fromAirport', { time: booked.fromAirport }) : null].filter(Boolean).join(' · ')}</Tiny> : null}
          <HotelRequestsAsked requests={booked.requests} testID="hotel-asked" />
        </Box>
      ) : null}

      {/* Where it is. */}
      <Box testID="hotel-where" gap={10}>
        <H3 size={15}>{t('hotel.map')}</H3>
        {lat != null && lng != null ? (
          <StaysMap single height={180} points={[{ id: 'hotel', lat, lng, label: h.name, selected: true }]} marks={anchor ? [{ id: anchor.id, lat: anchor.lat, lng: anchor.lng, name: anchorName(anchor, lang) }] : []} testID="hotel-map" />
        ) : null}
        {!dist && cat?.minutes ? <Row gap={6}><Icon name="pin" size={16} /><T v="small" color={colors.green} style={{ flex: 1 }} testID="hotel-distance">{t(cat.band === 'shuttle' ? 'umrah.hotel.shuttle' : 'umrah.hotel.walk', { min: cat.minutes })}{anchor ? ` · ${anchorName(anchor, lang)}` : ''}</T></Row> : null}
        {dist ? <Row gap={6}><Icon name="pin" size={16} /><T v="small" color={colors.green} style={{ flex: 1 }} testID="hotel-distance">{dist.text}</T></Row> : null}
        {h.address ? <Small>{h.address}</Small> : null}
        {lat != null || h.address ? <Pressable accessibilityRole="link" onPress={openMaps} testID="hotel-open-maps"><Small color={colors.green} style={{ textDecorationLine: 'underline' }}>{t('hotel.openMaps')}</Small></Pressable> : null}
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
          <Row gap={6} style={{ flexWrap: 'wrap' }}>{(allFacilities ? facilities : facilities.slice(0, 10)).map((f) => { const name = trNames.get(f.name) ?? f.name; return <Tag key={f.name} label={f.paid ? `${name} · ${t('hotel.paid')}` : name} />; })}</Row>
          {facilities.length > 10 ? <Pressable onPress={() => setAllFacilities(!allFacilities)} testID="hotel-facilities-all"><Small color={colors.green} style={{ textDecorationLine: 'underline' }}>{allFacilities ? t('hotel.fewer') : t('hotel.allFacilities', { count: facilities.length })}</Small></Pressable> : null}
        </Box>
      ) : null}
      {h.description ? (
        <Pressable onPress={() => setMoreText(!moreText)} accessibilityRole="button" testID="hotel-description">
          {tr.data?.description ? <Small lines={moreText ? undefined : 4}>{tr.data.description}</Small>
            : canTranslate ? <WrittenInEnglish><Small lines={moreText ? undefined : 4}>{h.description}</Small></WrittenInEnglish>
              : <Small lines={moreText ? undefined : 4}>{h.description}</Small>}
          {!moreText && h.description.length > 180 ? <Small color={colors.green} style={{ fontFamily: ff.ui500 }}>{t('hotel.readMore')}</Small> : null}
        </Pressable>
      ) : null}
      {canTranslate ? <TranslateToggle on={tr.on} loading={tr.loading} failed={tr.failed} translated={!!tr.data} toggle={tr.toggle} testID="hotel-translate" /> : null}
      {h.phone ? <Box gap={4}><Tiny>{t('voucher.phone')}</Tiny><Small color={colors.green}>{h.phone}</Small></Box> : null}
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
