import { useState } from 'react';
import { Linking, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { arrivalPickup, destinationOf, liveStay, signName, type TripDetail } from '@mada/shared';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { newKey, tripsApi, useTripMutation } from '@/lib/trips';
import { colors, ff } from '@/theme';
import { Box, Display, Eyebrow, Grow, H3, Row, Small, SmallButton, Tiny } from './ui';

/** Map links that open the phone's own maps (Apple Maps on iOS, Google Maps everywhere). */
export const mapsLinks = (address: string) => {
  const q = encodeURIComponent(address);
  return { google: `https://www.google.com/maps/search/?api=1&query=${q}`, apple: Platform.OS === 'ios' ? `maps://?q=${q}` : `https://maps.apple.com/?q=${q}`, transit: (from: string) => `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${q}&travelmode=transit` };
};
const open = (url: string) => { buzz('tap'); void Linking.openURL(url).catch(() => toast(t('as.cantOpen'))); };
const tel = (phone: string) => `tel:${phone.replace(/\s/g, '')}`;

/** Where they're staying, from the booking: the hotel, an address they gave us, or a question. Saved on the phone (offline copy). */
export function AddressSheet({ trip, open: visible, onClose }: { trip: TripDetail; open: boolean; onClose: () => void }) {
  const [big, setBig] = useState(false);
  const [ride, setRide] = useState<'pickup' | 'taxi' | 'metro' | null>(null);
  const [addr, setAddr] = useState('');
  const st = liveStay(trip);
  const dest = destinationOf(trip);
  const arrive = arrivalPickup(trip);
  const save = useTripMutation((address: string) => tripsApi.patch(trip.id, { noStay: { label: t('mv.familyFriends'), address } }));
  const askPickup = useTripMutation(() => tripsApi.ask(trip.id, { area: 'other', kind: 'pickup', clientKey: newKey() }));
  const place = st?.address ? { local: st.address, name: st.name, phone: st.phone, note: t('as.checkIn') } : trip.noStay ? { local: trip.noStay.address, name: t('as.with', { label: trip.noStay.label }), phone: null, note: t('as.youGave') } : null;

  if (!place) {
    return (
      <Sheet visible={visible} onClose={onClose} label={t('as.whereTitle')}>
        <T v="h2">{t('as.whereTitle')}</T>
        <Small style={{ marginTop: -8 }}>{arrive ? t('as.driverNeeds', { driver: arrive.driverName ?? t('trip.yourDriver') }) : t('as.soMada')}</Small>
        <T style={styles.label}>{t('as.address')}</T>
        <TextInput testID="address-input" value={addr} onChangeText={setAddr} placeholder={t('mv.addrPh')} placeholderTextColor={colors.muted} style={styles.input} autoComplete="street-address" />
        <Button testID="address-save" label={t('mv.saveAddr')} disabled={addr.trim().length < 6} busy={save.isPending} onPress={() => save.mutate(addr.trim(), { onSuccess: () => { buzz('success'); toast(t('mv.saved')); } })} />
        <Tiny>{t('as.hotelInstead')}</Tiny>
      </Sheet>
    );
  }
  const links = mapsLinks(place.local);
  return (
    <>
      <Sheet visible={visible && !big} onClose={onClose} label={st ? t('as.hotelAddress') : t('as.theAddress')}>
        <Eyebrow>{place.name} · {place.note}</Eyebrow>
        <Pressable testID="address-card" accessibilityRole="button" accessibilityLabel={t('as.fullScreen')} onPress={() => { buzz('tap'); setBig(true); }} style={styles.card}>
          <Display size={26}>{place.local}</Display>
          <Tiny>{t('as.tapFull')}</Tiny>
        </Pressable>
        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          <SmallButton testID="maps-google" tone="soft" icon="pin" label={t('as.google')} onPress={() => open(links.google)} />
          <SmallButton testID="maps-apple" tone="soft" icon="pin" label={t('as.apple')} onPress={() => open(links.apple)} />
          <SmallButton tone="soft" label={t('as.copy')} onPress={async () => { try { await Clipboard.setStringAsync(place.local); toast(t('as.copied')); } catch { toast(t('as.holdCopy')); } }} />
          {place.phone ? <SmallButton tone="soft" label={t('as.callHotel')} onPress={() => open(tel(place.phone!))} /> : null}
        </Row>
        {arrive ? (
          <Box tone="well" gap={6}>
            <H3 size={15}>{t('as.meeting', { driver: arrive.driverName ?? t('trip.yourDriver') })}</H3>
            <Small>{t('as.meetingBody', { door: arrive.meetingPoint ?? '', sign: signName(trip), car: [arrive.car, arrive.plate].filter(Boolean).join(' · '), waits: arrive.waits ?? '60 min' })}</Small>
            <Row>
              {arrive.phone ? <SmallButton tone="primary" label={t('as.call', { driver: arrive.driverName ?? '' })} onPress={() => open(tel(arrive.phone!))} /> : null}
              {arrive.phone ? <SmallButton tone="paper" label={t('as.message')} onPress={() => open(`sms:${arrive.phone!.replace(/\s/g, '')}`)} /> : null}
            </Row>
          </Box>
        ) : (
          <View style={{ gap: 8 }}>
            <Eyebrow>{t('as.noCar')}</Eyebrow>
            {([['car', t('as.opt.pickup'), t('as.opt.pickupSub', { all: trip.travellers.length > 1 ? t('as.forAll') : '' }), 'pickup'], ['car', t('as.opt.taxi'), dest.taxi ?? t('as.opt.taxiGeneric'), 'taxi'], ['flight', t('as.opt.metro'), dest.metro ?? t('as.opt.metroGeneric'), 'metro']] as [IconName, string, string, 'pickup' | 'taxi' | 'metro'][]).map(([ic, title, sub, id]) => (
              <Box key={id} tone="well" onPress={() => setRide(id)} style={[{ flexDirection: 'row', alignItems: 'flex-start' }, ride === id ? { borderWidth: 2, borderColor: colors.green } : null]} testID={`ride-${id}`}>
                <Icon name={ic} /><Grow><H3 size={15}>{title}</H3><Tiny>{sub}</Tiny></Grow>
              </Box>
            ))}
            {ride === 'pickup' ? <Button testID="ride-book" label={t('as.bookPickup')} busy={askPickup.isPending} onPress={() => askPickup.mutate(undefined, { onSuccess: () => { buzz('success'); toast(t('as.pickupAsked')); } })} /> : null}
            {ride === 'taxi' ? <Small>{t('as.taxiTip')}</Small> : null}
            {ride === 'metro' ? <Button label={t('as.directions')} variant="secondary" onPress={() => open(links.transit(dest.city === 'Istanbul' ? 'Istanbul Airport' : `${dest.city} airport`))} /> : null}
          </View>
        )}
        <Row gap={6}><Icon name="wifiOff" size={14} color={colors.ink3} /><Tiny>{t('as.offline')}</Tiny></Row>
      </Sheet>
      <Modal visible={visible && big} animationType="fade" onRequestClose={() => setBig(false)}>
        <Pressable testID="address-big" style={styles.big} onPress={() => setBig(false)} accessibilityLabel={t('as.forDriver')}>
          <Eyebrow color={colors.goldInk}>{dest.sayToDriver ? `${dest.sayToDriver} · ${t('as.takeMe')}` : t('as.takeMe')}</Eyebrow>
          <Display size={44}>{place.local}</Display>
          <Small>{t('as.tapClose')}</Small>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.mist, borderRadius: 22, padding: 16, gap: 8 },
  big: { flex: 1, backgroundColor: colors.paper, paddingVertical: 80, paddingHorizontal: 28, gap: 20, justifyContent: 'center' },
  label: { fontFamily: ff.ui600, fontSize: 13, lineHeight: 17, color: colors.ink2 },
  input: { height: 52, borderRadius: 16, backgroundColor: colors.mist, paddingHorizontal: 16, fontSize: 16, fontFamily: ff.ui500, color: colors.green },
});
