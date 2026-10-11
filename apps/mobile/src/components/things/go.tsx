import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dayLabel, localizeDigits, travelEstimate, type GoApp, type GoTarget, type TravelEstimate } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon, type IconName } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { ApiError } from '@/lib/api';
import { appsFor, openDirections, type Offered } from '@/lib/directions';
import { buzz } from '@/lib/haptics';
import { isRTL, t } from '@/lib/i18n';
import { thingId, thingsApi, thingTitle, type Thing } from '@/lib/things';
import { toast } from '@/lib/toast';
import { usePresence } from '@/lib/wallet';
import { colors, ff, font } from '@/theme';
import type { ThingsContext } from './sheets';

/*
 * Getting there, on every place and experience: the address, a straight-line "about" time from the hotel, Directions
 * (a chooser of the maps and ride apps on this phone; Google Maps on the web) and Get there with Mada (a car booked by
 * the desk, like an airport pickup). Experiences show their meeting point when the supplier gives one, and say it's on
 * the voucher when not.
 */

/** Where Directions takes you, or null when there's nowhere to go yet (a pickup, or a meeting point on the voucher). */
export function targetOf(x: Thing, city: string): GoTarget | null {
  if (x.kind === 'activity') return { name: (isRTL() && x.a.nameAr) || x.a.name, lat: x.a.lat, lon: x.a.lon, address: x.a.address ?? null };
  if (x.kind === 'experience') {
    const m = x.e.meetingPoint;
    if (!m || m.kind === 'pickup' || (m.lat === null && !m.address)) return null;
    return { name: m.address ?? x.e.title, lat: m.lat, lon: m.lon, address: m.address };
  }
  return x.w.venue ? { name: x.w.venue, lat: null, lon: null, address: `${x.w.venue}, ${city}` } : null;
}

/** "About 12 min by car" from the hotel, when the trip has one and the place has a point. */
export function estimateFor(target: GoTarget | null, ctx: ThingsContext): TravelEstimate | null {
  if (!target || target.lat === null || target.lon === null || ctx.near?.label !== 'hotel') return null;
  return travelEstimate(ctx.near, { lat: target.lat, lon: target.lon });
}

export const minutesLine = (e: TravelEstimate) => t(e.mode === 'walk' ? 'things.go.minWalk' : 'things.go.minDrive', { n: localizeDigits(String(e.min)) });
const aboutLine = (e: TravelEstimate) => t(e.mode === 'walk' ? 'things.go.walk' : 'things.go.drive', { n: localizeDigits(String(e.min)) });

/** The meeting point of an experience, or the promise that it's on the voucher. */
export function MeetingPoint({ x }: { x: Extract<Thing, { kind: 'experience' }> }) {
  const m = x.e.meetingPoint;
  return (
    <View style={st.card} testID="thing-meeting">
      <View style={st.row}>
        <Icon name={m?.kind === 'pickup' ? 'car' : 'pin'} size={16} color={colors.goldInk} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="eyebrow" color={colors.goldInk}>{t('things.meet.label')}</T>
          {m && (m.address || m.kind === 'pickup') ? (
            <>
              <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{m.kind === 'pickup' && !m.address ? t('things.meet.pickup') : m.address}</T>
              {m.note ? <T v="tiny">{m.note}</T> : null}
            </>
          ) : (
            <>
              <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{t('things.meet.voucher')}</T>
              <T v="tiny">{t('things.meet.voucherSub')}</T>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

/** Address, the "about" time from the hotel, and the two ways there. */
export function GettingThere({ x, ctx, onDirections, onRide }: { x: Thing; ctx: ThingsContext; onDirections: () => void; onRide: () => void }) {
  const target = targetOf(x, ctx.city);
  const est = estimateFor(target, ctx);
  const address = x.kind === 'activity' ? x.a.address ?? null : x.kind === 'event' ? x.w.venue : null;
  return (
    <View style={st.card} testID="thing-getting-there">
      {address ? (
        <View style={st.row}>
          <Icon name="pin" size={16} color={colors.goldInk} />
          <View style={{ flex: 1 }}>
            <T v="tiny" color={colors.goldInk}>{t('things.go.address')}</T>
            <T v="small" color={colors.green} selectable>{address}</T>
          </View>
        </View>
      ) : null}
      {est ? (
        <View style={st.row} testID="thing-estimate">
          <Icon name={est.mode === 'walk' ? 'user' : 'car'} size={16} color={colors.goldInk} />
          <View style={{ flex: 1 }}>
            <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{aboutLine(est)}</T>
            <T v="tiny">{ctx.hotel ? t('things.go.fromHotel', { hotel: ctx.hotel }) : t('things.go.fromHotelPlain')}</T>
          </View>
        </View>
      ) : null}
      <View style={st.buttons}>
        {target ? <Button testID="thing-directions" label={t('things.go.directions')} size="small" style={{ flex: 1 }} icon={<Icon name="arrow" size={16} color={colors.mist} />} onPress={onDirections} /> : null}
        <Button testID="thing-ride" label={t('things.go.withMada')} variant="secondary" size="small" style={{ flex: 1 }} icon={<Icon name="car" size={16} color={colors.green} />} onPress={onRide} />
      </View>
    </View>
  );
}

const APP_ICON: Record<GoApp, IconName> = { apple: 'pin', google: 'pin', waze: 'pin', uber: 'car', careem: 'car' };

/** The chooser: the apps this phone has, the guess at the time, and Get there with Mada. */
export function DirectionsSheet({ x, ctx, onClose, onRide }: { x: Thing | null; ctx: ThingsContext; onClose: () => void; onRide: (x: Thing) => void }) {
  const target = x ? targetOf(x, ctx.city) : null;
  const est = estimateFor(target, ctx);
  const mode = est?.mode ?? 'drive';
  // Which apps this phone has: asked each time the chooser opens for a place (someone may have just installed one).
  const apps = useQuery({
    queryKey: ['directions', target ? `${target.lat},${target.lon},${target.address ?? target.name}` : '', mode],
    queryFn: () => appsFor(target!, mode),
    enabled: !!target,
    staleTime: 0,
    gcTime: 60_000,
  }).data;
  if (!x || !target) return null;
  const title = thingTitle(x, isRTL());
  const go = (l: Offered) => {
    buzz('tap');
    void openDirections(l).catch(() => toast(t('things.offline')));
  };
  return (
    <Sheet visible={!!x} onClose={onClose} label={t('things.go.title', { name: title })}>
      <ScrollView style={{ maxHeight: 640 }} contentContainerStyle={{ gap: 12 }} testID="directions-sheet">
        <T v="h2">{t('things.go.title', { name: title })}</T>
        {target.address ? <T v="small" selectable>{target.address}</T> : null}
        {est ? (
          <View style={[st.card, { gap: 4 }]} testID="directions-estimate">
            <T v="eyebrow" color={colors.goldInk}>{ctx.hotel ? t('things.go.fromHotel', { hotel: ctx.hotel }) : t('things.go.fromHotelPlain')}</T>
            <View style={st.row}><Icon name="user" size={16} color={colors.goldInk} /><T v="small" color={colors.green} style={est.mode === 'walk' ? { fontFamily: ff.ui600 } : null}>{t('things.go.walk', { n: localizeDigits(String(est.walkMin)) })}</T></View>
            <View style={st.row}><Icon name="car" size={16} color={colors.goldInk} /><T v="small" color={colors.green} style={est.mode === 'drive' ? { fontFamily: ff.ui600 } : null}>{t('things.go.drive', { n: localizeDigits(String(est.driveMin)) })}</T></View>
            <T v="tiny">{t('things.go.estimate')}</T>
          </View>
        ) : null}
        <T v="eyebrow">{t('things.go.openIn')}</T>
        <View style={{ gap: 8 }}>
          {(apps ?? []).map((l) => (
            <Pressable key={l.app} testID={`go-app-${l.app}`} accessibilityRole="button" accessibilityLabel={t(`things.go.app.${l.app}`)} onPress={() => go(l)} style={({ pressed }) => [st.app, pressed && { opacity: 0.85 }]}>
              <View style={[st.appMark, (l.app === 'uber' || l.app === 'careem') && { backgroundColor: colors.green }]}>
                <Icon name={APP_ICON[l.app]} size={18} color={l.app === 'uber' || l.app === 'careem' ? colors.mist : colors.goldInk} />
              </View>
              <View style={{ flex: 1, gap: 1 }}>
                <T v="h3" style={{ fontSize: 16 }}>{t(`things.go.app.${l.app}`)}</T>
                <T v="tiny">{l.app === 'uber' || l.app === 'careem' ? t('things.go.appRide') : Platform.OS === 'web' || !l.installed ? t('things.go.appWeb') : t('things.go.appMaps')}</T>
              </View>
              <Icon name="chevron" size={18} color={colors.ink3} />
            </Pressable>
          ))}
        </View>
        <View style={st.mada}>
          <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{t('things.go.withMada')}</T>
          <T v="tiny">{t('things.go.withMadaSub')}</T>
          <Button testID="directions-ride" label={t('things.go.askCar')} variant="secondary" size="small" icon={<Icon name="car" size={16} color={colors.green} />} onPress={() => onRide(x)} />
        </View>
      </ScrollView>
    </Sheet>
  );
}

const TIMES = Array.from({ length: 33 }, (_, i) => { const m = 7 * 60 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; });

/** Get there with Mada: which day, what time, from where, how many. A desk request, then its chat. */
export function RideSheet({ x, ctx, onClose }: { x: Thing | null; ctx: ThingsContext; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const presence = usePresence();
  const today = new Date().toISOString().slice(0, 10);
  const days = ctx.days.length ? ctx.days : Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10); });
  const [day, setDay] = useState<string>(ctx.day && days.includes(ctx.day) ? ctx.day : days.find((d) => d >= today) ?? days[0]!);
  const [time, setTime] = useState('10:00');
  const [pickup, setPickup] = useState<'hotel' | 'other'>(ctx.hotel ? 'hotel' : 'other');
  const [where, setWhere] = useState('');
  const [n, setN] = useState(Math.max(1, Math.min(6, ctx.travellers || 2)));
  const [text, setText] = useState<string | null>(null);
  const times = useRef<ScrollView>(null);
  const scrolled = useRef(false);
  const viewport = useRef(390);
  const [clientId] = useState(() => `ride-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const ride = useMutation({
    mutationFn: (message: string) => thingsApi.ride({
      ref: { kind: x!.kind, id: thingId(x!) }, placeId: ctx.placeId, ...(ctx.tripId ? { tripId: ctx.tripId } : {}), day, time, pickup,
      ...(pickup === 'other' ? { pickupText: where.trim() } : {}), travellers: n, message, clientId,
    }),
    onSuccess: (r) => {
      buzz('success');
      void qc.invalidateQueries({ queryKey: ['booking'] });
      void qc.invalidateQueries({ queryKey: ['trips'] });
      toast(t('things.ride.sent'));
      onClose();
      router.push(`/ask/request/${r.request.id}`);
    },
  });
  if (!x) return null;
  const title = thingTitle(x, isRTL());
  const from = pickup === 'hotel' ? ctx.hotel ?? t('things.ride.hotel') : where.trim() || '…';
  const who = n === 1 ? t('things.request.whoOne') : t('things.request.who', { n: localizeDigits(String(n)) });
  const generated = t('things.ride.message', { name: title, day: dayLabel(day, { today }), time: localizeDigits(time), from, who });
  const message = text ?? generated;
  const agent = presence.data?.agent?.name ?? null;
  const missingWhere = pickup === 'other' && !where.trim();
  const offline = ride.error instanceof ApiError && ride.error.code === 'OFFLINE';
  const reset = () => setText(null);
  return (
    <Sheet visible={!!x} onClose={onClose} label={t('things.ride.title', { name: title })}>
      <ScrollView style={{ maxHeight: 660 }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled" testID="ride-sheet">
        <T v="h2">{t('things.ride.title', { name: title })}</T>
        <T v="eyebrow">{t('things.ride.day')}</T>
        <View style={st.chips}>{days.slice(0, 10).map((d) => <Chip key={d} label={dayLabel(d, { today })} on={day === d} onPress={() => { setDay(d); reset(); }} />)}</View>
        <T v="eyebrow">{t('things.ride.time')}</T>
        <ScrollView
          ref={times} horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }} testID="ride-times"
          // Start with the chosen time in view (10:00 is off the edge otherwise).
          onContentSizeChange={(w) => { if (!scrolled.current) { scrolled.current = true; const x = Math.max(0, (w / TIMES.length) * TIMES.indexOf(time) - 40); times.current?.scrollTo({ x: isRTL() && Platform.OS !== 'web' ? Math.max(0, w - x - viewport.current) : x, animated: false }); } }}
          onLayout={(e) => { viewport.current = e.nativeEvent.layout.width; }}
        >
          {TIMES.map((tm) => <Chip key={tm} label={localizeDigits(tm)} on={time === tm} onPress={() => { setTime(tm); reset(); }} />)}
        </ScrollView>
        <T v="eyebrow">{t('things.ride.from')}</T>
        <View style={st.chips}>
          {ctx.hotel ? <Chip label={ctx.hotel} on={pickup === 'hotel'} onPress={() => { setPickup('hotel'); reset(); }} /> : null}
          <Chip label={t('things.ride.elsewhere')} on={pickup === 'other'} onPress={() => { setPickup('other'); reset(); }} />
        </View>
        {pickup === 'other' ? (
          <TextInput value={where} onChangeText={(v) => { setWhere(v); reset(); }} placeholder={t('things.ride.where')} placeholderTextColor={colors.muted} maxLength={160} accessibilityLabel={t('things.ride.where')} testID="ride-where" style={[st.input, { minHeight: 0 }, font('body', colors.green)]} />
        ) : null}
        <T v="eyebrow">{t('things.ride.people')}</T>
        <View style={st.chips}>{[1, 2, 3, 4, 5, 6].map((k) => <Chip key={k} label={k === 6 ? '6+' : localizeDigits(String(k))} on={n === k} onPress={() => { setN(k); reset(); }} />)}</View>
        <View style={{ gap: 6 }}>
          <T v="small" style={{ fontFamily: ff.ui600 }}>{t('things.bookSheet.message')}</T>
          <TextInput value={message} onChangeText={setText} multiline maxLength={600} accessibilityLabel={t('things.bookSheet.message')} testID="ride-message" style={[st.input, font('body', colors.green)]} />
        </View>
        <T v="tiny">{agent ? t('things.ride.note', { agent }) : t('things.ride.noteAway')}</T>
        {missingWhere ? <T v="small" color={colors.goldInk}>{t('things.ride.whereNeeded')}</T> : null}
        {offline ? <T v="small" color={colors.badInk}>{t('things.offline')}</T> : ride.error ? <T v="small" color={colors.badInk}>{ride.error.message}</T> : null}
        <Button testID="ride-send" label={t('things.ride.send')} busy={ride.isPending} disabled={!message.trim() || missingWhere} haptic="success" onPress={() => ride.mutate(message.trim())} />
      </ScrollView>
    </Sheet>
  );
}

const st = StyleSheet.create({
  card: { gap: 10, padding: 14, borderRadius: 18, backgroundColor: colors.mist },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  app: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  appMark: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldWash },
  mada: { gap: 6, padding: 14, borderRadius: 18, backgroundColor: colors.goldWash },
  input: { minHeight: 84, borderRadius: 16, padding: 14, fontSize: 17, backgroundColor: colors.paper, borderWidth: 1.5, borderColor: colors.line, textAlignVertical: 'top' },
});
