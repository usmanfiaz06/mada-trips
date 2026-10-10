import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { DESK_PHONE, DESK_TEL, DESK_WHATSAPP } from '@mada/shared';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { Sun } from '@/components/Sun';
import { T } from '@/components/Text';
import { AccountScreen, VERSION } from '@/components/wallet/AccountScreen';
import { Group, Row } from '@/components/wallet/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { useTrips } from '@/lib/wallet';
import { nextTrip } from '@/lib/wallet-model';
import { colors } from '@/theme';

const FAQ = [1, 2, 3, 4, 5, 6] as const;

/** Help (Account.jsx Help): talk to Mada, call or WhatsApp the desk, questions people ask, terms and privacy. */
export default function Help() {
  const router = useRouter();
  const trips = useTrips();
  const [open, setOpen] = useState<number | null>(null);
  const [call, setCall] = useState(false);
  const ref = nextTrip(trips.data)?.trip.bookingRef;
  return (
    <AccountScreen title={t('help.title')} testID="help">
      <Card variant="focal" style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View style={{ width: 44, height: 44, borderRadius: 999, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' }}><Sun width={28} color={colors.green} /></View>
          <View style={{ flex: 1 }}><T v="h3" color={colors.mist}>{t('help.talk')}</T><T v="small" color={colors.onDark2}>{t('help.talkBody')}</T></View>
        </View>
        <Button variant="gold" label={t('action.talk')} onPress={() => router.push('/support')} testID="help-talk" />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button variant="onDark" size="small" block={false} style={{ flex: 1 }} label={t('help.whatsapp')} onPress={() => { toast(t('help.opening', { phone: DESK_PHONE })); Linking.openURL(DESK_WHATSAPP).catch(() => {}); }} />
          <Button variant="onDark" size="small" block={false} style={{ flex: 1 }} label={t('help.call')} onPress={() => setCall(true)} testID="help-call" />
        </View>
      </Card>
      <Group label={t('help.faq')}>
        {FAQ.map((i) => (
          <View key={i}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === i }} onPress={() => { buzz('tap'); setOpen(open === i ? null : i); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 56 }}>
              <T v="h3" style={{ flex: 1, fontSize: 15 }}>{t(`help.q${i}`)}</T>
              <View style={{ transform: [{ rotate: open === i ? '90deg' : '0deg' }] }}><Icon name="chevron" size={18} color={colors.muted} /></View>
            </Pressable>
            {open === i ? <T v="small" style={{ paddingHorizontal: 16, paddingBottom: 16, marginTop: -4 }}>{t(`help.a${i}`)}</T> : null}
          </View>
        ))}
      </Group>
      <Group label={t('help.legal')}>
        <Row value={t('help.terms')} onPress={() => router.push({ pathname: '/account/legal', params: { doc: 'terms' } })} testID="help-terms" />
        <Row value={t('help.privacy')} onPress={() => router.push({ pathname: '/account/legal', params: { doc: 'privacy' } })} />
      </Group>
      <T v="tiny" style={{ textAlign: 'center' }}>{t('help.version', { version: VERSION })}</T>
      <Sheet visible={call} onClose={() => setCall(false)} label={t('help.callTitle')}>
        <T v="h2">{t('help.callTitle')}</T>
        <T v="body">{`${t('help.callBody', { phone: DESK_PHONE })}${ref ? ` ${ref}` : ''}`}</T>
        <Button label={t('help.callNow')} onPress={() => { setCall(false); Linking.openURL(DESK_TEL).catch(() => {}); }} testID="call-now" />
        <Button variant="ghost" label={t('common.cancel')} onPress={() => setCall(false)} />
      </Sheet>
    </AccountScreen>
  );
}
