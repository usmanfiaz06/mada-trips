import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { dayLabel, dayOfMonth, formatSar, moveNeeded, outSegment, weekdayOf, type TripDetail } from '@mada/shared';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { tripsApi, useTripMutation } from '@/lib/trips';
import { colors, ff } from '@/theme';
import { Box, Grow, H3, Num, Row, Small, SmallButton, Spread, Tiny } from './ui';

const dl = (d: string) => dayLabel(d, { today: d });

/** After a date change: the hotel and the home pickup are still on the old day until the traveller says (one source of truth). */
export function MoveNotice({ trip }: { trip: TripDetail }) {
  const [open, setOpen] = useState(false);
  const m = moveNeeded(trip);
  if (!m) return null;
  const what = m.hotel && m.pickup ? t('mv.both') : m.hotel ? t('mv.hotel') : t('mv.pickup');
  return (
    <Box tone="warn" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }} testID="move-notice">
      <Icon name="flight" color={colors.goldInk} />
      <Grow gap={2}>
        <H3 size={15}>{t('mv.stillOn', { what, day: dl(m.from) })}</H3>
        <Small>{t('mv.flightNow', { day: dl(m.to) })}</Small>
        <View style={{ marginTop: 6 }}><SmallButton testID="move-open" tone="primary" label={t(m.hotel && m.pickup ? 'mv.moveThem' : 'mv.moveIt', { day: `${weekdayOf(m.to)} ${dayOfMonth(m.to)}` })} onPress={() => setOpen(true)} /></View>
      </Grow>
      <MoveSheet trip={trip} open={open} onClose={() => setOpen(false)} />
    </Box>
  );
}

export function MoveSheet({ trip, open, onClose }: { trip: TripDetail; open: boolean; onClose: () => void }) {
  const m = moveNeeded(trip);
  const move = useTripMutation((b: { hotel: boolean; pickup: boolean }) => tripsApi.move(trip.id, b));
  if (!m) return null;
  const out = outSegment(trip)!;
  const st = m.hotel;
  const title = t(m.hotel && m.pickup ? 'mv.titleBoth' : m.hotel ? 'mv.titleHotel' : 'mv.titlePickup', { day: `${weekdayOf(m.to)} ${dayOfMonth(m.to)}` });
  const extra = st ? st.diff > 0 : false;
  return (
    <Sheet visible={open} onClose={onClose} label={title}>
      <T v="h2">{title}</T>
      <Small style={{ marginTop: -8 }}>{t('mv.flightIs', { day: dl(m.to), time: out.departLocal.slice(11, 16) })}</Small>
      <Box tone="well" gap={14}>
        {st ? (
          <Spread align="flex-start">
            <Row align="flex-start" style={{ flex: 1 }}><Icon name="stay" size={20} /><Grow gap={1}><H3 size={15}>{st.name}</H3><Tiny color={colors.ink2}>{t('mv.checkIn', { from: dl(st.fromDay), to: dl(m.to), n: st.newNights })}</Tiny></Grow></Row>
            <Num size={13}>{st.diff === 0 ? t('mv.noCost') : st.diff > 0 ? `+${formatSar(st.diff)}` : st.back ? `−${formatSar(st.back)}` : t('mv.nothingBack')}</Num>
          </Spread>
        ) : null}
        {m.pickup ? (
          <Spread align="flex-start">
            <Row align="flex-start" style={{ flex: 1 }}><Icon name="car" size={20} /><Grow gap={1}><H3 size={15}>{t('mv.atDoor', { driver: m.pickup.driver })}</H3><Tiny color={colors.ink2}>{`${dl(m.pickup.fromDay)} → ${dl(m.to)} · ${m.pickup.time}`}</Tiny></Grow></Row>
            <Num size={13}>{t('mv.noCost')}</Num>
          </Spread>
        ) : null}
      </Box>
      {st && st.diff < 0 && !st.back ? <Small>{t('mv.keepsNight')}</Small> : null}
      {extra ? <Small>{t('mv.extraNight')}</Small> : null}
      <Button testID="move-confirm" label={`${t(st && m.pickup ? 'mv.both.btn' : 'mv.it.btn')}${st?.back ? ` · ${t('mv.back', { amount: formatSar(st.back) })}` : extra && st ? ` · +${formatSar(st.diff)}` : ''}`} busy={move.isPending}
        onPress={() => move.mutate({ hotel: !!m.hotel, pickup: !!m.pickup }, { onSuccess: (r) => { buzz('success'); toast(r.say); onClose(); }, onError: (e) => toast(e.message) })} />
      <Button label={t('mv.keep')} variant="ghost" onPress={onClose} />
    </Sheet>
  );
}

/** No hotel any more: ask where they're staying, so the driver and Mada know. */
export function NoStayChoices({ trip, onDone }: { trip: TripDetail; onDone: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<'own' | null>(null);
  const [addr, setAddr] = useState(trip.noStay?.address ?? '');
  const save = useTripMutation((address: string) => tripsApi.patch(trip.id, { noStay: { label: t('mv.familyFriends'), address } }));
  if (mode === 'own') {
    const ok = addr.trim().length >= 6;
    return (
      <View style={{ gap: 10 }}>
        <T style={styles.label}>{t('mv.whereStaying')}</T>
        <TextInput testID="nostay-address" value={addr} onChangeText={setAddr} placeholder={t('mv.addrPh')} placeholderTextColor={colors.muted} style={styles.input} autoComplete="street-address" />
        {addr && !ok ? <T v="small" color={colors.bad}>{t('mv.addrErr')}</T> : null}
        <Button testID="nostay-save" label={t('mv.saveAddr')} disabled={!ok} busy={save.isPending} onPress={() => save.mutate(addr.trim(), { onSuccess: () => { buzz('success'); toast(t('mv.saved')); onDone(); } })} />
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <Box tone="well" onPress={() => { onDone(); router.push('/ask?intent=stay' as Href); }} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Icon name="stay" /><Grow gap={0}><H3 size={15}>{t('mv.findHotel')}</H3><Tiny>{t('mv.sameDates')}</Tiny></Grow><Icon name="chevron" />
      </Box>
      <Box tone="well" onPress={() => setMode('own')} style={{ flexDirection: 'row', alignItems: 'center' }} testID="nostay-own">
        <Icon name="user" /><Grow gap={0}><H3 size={15}>{t('mv.withFamily')}</H3><Tiny>{t('mv.addAddr')}</Tiny></Grow><Icon name="chevron" />
      </Box>
      <Button label={t('mv.later')} variant="ghost" onPress={onDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: ff.ui600, fontSize: 13, lineHeight: 17, color: colors.ink2 },
  input: { height: 52, borderRadius: 16, backgroundColor: colors.mist, paddingHorizontal: 16, fontSize: 16, fontFamily: ff.ui500, color: colors.green },
});
