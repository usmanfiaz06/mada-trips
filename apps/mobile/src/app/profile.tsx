import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { formatSar } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { PayMark } from '@/components/PayMark';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { AccountScreen, DeletionBanner, VERSION } from '@/components/wallet/AccountScreen';
import { PhotoSheet } from '@/components/wallet/PhotoSheet';
import { SignOutSheet } from '@/components/wallet/SignOutSheet';
import { CardsSheet } from '@/components/wallet/sheets';
import { LanguageSheet } from '@/components/wallet/AccountSheets';
import { Group, Row, UserAvatar } from '@/components/wallet/ui';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { usePeople, useUpdateMe } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useAccount, useCards, useCredit, useDevices, useExport, useInbox, useTrips, walletApi, walletKeys } from '@/lib/wallet';
import { fullNameOf, nameOf, nextTrip, passportStatus, prettyPhone, useNow } from '@/lib/wallet-model';
import { colors, ff } from '@/theme';

/** Profile (prototype Profile.jsx): you, your account, household, paying, alerts, the app, sign out. */
export default function Profile() {
  const router = useRouter();
  const status = useSession((s) => s.status);
  if (status !== 'signedIn') {
    return (
      <AccountScreen>
        <T v="h1" accessibilityRole="header">{t('profile.guest.title')}</T>
        <T v="body">{t('profile.guest.body')}</T>
        <Button label={t('profile.guest.signIn')} onPress={() => router.replace('/welcome')} />
        <Group><Row icon="doc" value={t('profile.help')} onPress={() => router.push('/account/help')} /></Group>
      </AccountScreen>
    );
  }
  return <SignedIn />;
}

function SignedIn() {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useSession((s) => s.user);
  const account = useAccount();
  const people = usePeople();
  const cards = useCards();
  const credit = useCredit();
  const devices = useDevices();
  const exp = useExport();
  const inbox = useInbox();
  const trips = useTrips();
  const updateMe = useUpdateMe();
  const now = useNow();
  const [sheet, setSheet] = useState<null | 'photo' | 'language' | 'cards' | 'signout' | 'lastcard' | { removeDefault: string }>(null);
  const a = account.data;
  const self = people.data?.find((p) => p.isSelf);
  const display = a?.preferredName || nameOf(self, user?.name) || '';
  const trip = nextTrip(trips.data);
  const list = people.data ?? [];
  const needs = list.filter((p) => ['none', 'soon', 'problem', 'expired'].includes(passportStatus(p, trip).key)).length;
  const methods = [user?.methods.apple && t('signinMethods.apple'), user?.methods.google && t('signinMethods.google'), user?.methods.email && t('auth.methods.email'), user?.methods.phone && t('signinMethods.phone').split(' ')[0]].filter(Boolean).join(' · ');
  const prefs = a?.prefs;
  const seat = prefs ? t(prefs.seat === 'any' ? 'prefs.seat.anyShort' : prefs.seat === 'window' ? 'prefs.seat.window' : 'prefs.seat.aisle') : '';
  const meal = prefs ? t(`prefs.meal.${prefs.meal}` as 'prefs.meal.halal') : '';
  const loyalty = prefs?.loyalty.length ? tn('profile.prefsLoyalty', prefs.loyalty.length) : t('profile.prefsNoLoyalty');
  const saved = cards.data?.cards ?? [];
  const def = cards.data?.defaultId ?? 'applepay';
  const bal = credit.data?.balance.amount ?? 0;
  const unread = (inbox.data ?? []).filter((x) => !x.readAt).length;
  const exportPending = !!exp.data && exp.data.status === 'pending' && now - Date.parse(exp.data.requestedAt) < 86_400_000;

  const removeCard = async (id: string, newDefault?: string) => {
    try {
      const r = await walletApi.removeCard(id, newDefault);
      qc.setQueryData(walletKeys.cards, r);
      buzz('tap');
      toast(r.defaultId === 'applepay' && def === id ? t('cards.removedApplePay') : t('cards.removed'));
    } catch { toast(t('error.internal')); }
    setSheet(null);
  };
  const askRemove = (id: string) => {
    if (id === def && saved.length > 1) setSheet({ removeDefault: id });
    else if (id === def) setSheet('lastcard');
    else removeCard(id);
  };
  const alerts = user?.alerts ?? 'quiet';

  return (
    <AccountScreen testID="profile">
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel={a?.photo ? t('profile.photoChange') : t('profile.photoAdd')} onPress={() => { buzz('tap'); setSheet('photo'); }} testID="profile-photo">
          <UserAvatar size={68} initial={display.charAt(0)} hasPhoto={!!a?.photo} photoKey={a?.photo?.updatedAt} />
          <View style={styles.cam}><Icon name="plus" size={14} color={colors.green} width={2.6} /></View>
        </Pressable>
        <Pressable accessibilityRole="button" style={{ flex: 1, gap: 2 }} onPress={() => router.push('/account')} testID="profile-name">
          <T v="h1" style={{ fontSize: 26, lineHeight: 30 }}>{a?.preferredName || (self?.passport ? fullNameOf(self) : '') || display || t('profile.yourAccount')}</T>
          <T v="small" style={{ fontVariant: ['tabular-nums'] }}>{user?.phone ? prettyPhone(user.phone) : user?.email ?? (self?.passport ? t('profile.addPhone') : t('profile.addPassport'))}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4 }}><T v="caption" color={colors.goldInk} style={{ fontFamily: ff.ui600, fontSize: 13 }}>{t('profile.details')}</T><Icon name="chevron" size={14} width={2.4} color={colors.goldInk} /></View>
        </Pressable>
      </View>

      <DeletionBanner />

      <Group label={t('profile.account')}>
        <Row icon="user" value={t('profile.details')} sub={t('profile.detailsSub')} onPress={() => router.push('/account')} testID="profile-details" />
        {user && !user.phone ? <Row icon="bell" value={t('auth.verifyPhone.row')} sub={t('auth.verifyPhone.rowSub')} onPress={() => router.push('/verify-phone?then=back')} testID="profile-verify-phone" /> : null}
        <Row icon="lock" value={t('profile.signin')} sub={methods || t('profile.signinNone')} onPress={() => router.push('/account/signin')} testID="profile-signin" />
        <Row icon="flight" value={t('profile.prefs')} sub={`${seat} · ${meal} · ${loyalty}`} onPress={() => router.push('/account/prefs')} testID="profile-prefs" />
        <Row icon="bell" value={t('profile.inbox')} sub={unread ? tn('profile.inboxSub', unread) : t('profile.inboxSub.zero')} onPress={() => router.push('/inbox')} testID="profile-inbox" />
      </Group>

      <Group label={t('profile.household')}>
        <Row lead={<View style={{ flexDirection: 'row' }}>{list.slice(0, 4).map((p, i) => <View key={p.id} style={{ marginStart: i ? -10 : 0 }}>{p.isSelf ? <UserAvatar size={34} ring={colors.paper} initial={display.charAt(0)} hasPhoto={!!a?.photo} photoKey={a?.photo?.updatedAt} /> : <View style={styles.face}><T style={{ fontFamily: ff.ui600, fontSize: 13, color: colors.green }}>{p.firstName.charAt(0)}</T></View>}</View>)}</View>}
          value={list.length > 1 ? list.map((p) => (p.isSelf ? display || t('household.youPlain') : p.firstName)).join(', ') : t('profile.justYou')}
          sub={list.length <= 1 ? (needs ? t('profile.household.youNoPassport') : t('profile.household.addFamily')) : needs ? tn('profile.household.needs', needs) : t('profile.household.allGood')}
          onPress={() => router.push('/household')} testID="profile-household" />
      </Group>

      <Group label={t('profile.paying')}>
        {def === 'applepay' ? <Row lead={<PayMark brand="applepay" size={26} />} value={t('cards.applePay')} right={<Pill text={t('cards.default')} />} /> : null}
        {saved.map((c) => (
          <Row key={c.id} lead={<PayMark brand={c.brand} size={26} />} value={c.label} sub={t('cards.expires', { exp: c.exp })}
            right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{c.id === def ? <Pill text={t('cards.default')} /> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={t('cards.removeLabel', { label: c.label })} onPress={() => askRemove(c.id)} hitSlop={8}><T v="caption" color={colors.badInk} style={{ fontFamily: ff.ui600, fontSize: 13, textDecorationLine: 'underline' }}>{t('cards.remove')}</T></Pressable></View>} />
        ))}
        {!saved.length && def !== 'applepay' ? <Row icon="card" value={t('profile.noCards')} sub={t('profile.noCardsSub')} /> : null}
        {!saved.length && def === 'applepay' ? <View style={{ padding: 16 }}><T v="tiny">{t('profile.noCardsApplePay')}</T></View> : null}
        {bal > 0 ? <Row lead={<PayMark brand="credit" size={26} />} value={t('profile.credit', { amount: formatSar(bal) })} sub={t('profile.creditSub')} /> : null}
        <Row icon="card" value={saved.length ? t('profile.changeCard') : t('profile.addCard')} onPress={() => setSheet('cards')} testID="profile-cards" />
      </Group>

      <Group label={t('profile.alerts')}>
        <View style={{ padding: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8 }} accessibilityLabel={t('profile.alerts.label')}>
            {(['quiet', 'everything'] as const).map((id) => <Chip key={id} on={alerts === id} label={t(`profile.alerts.${id}`)} onPress={() => updateMe.mutate({ alerts: id })} />)}
          </View>
          <T v="small">{alerts === 'quiet' ? t('profile.alerts.quietBody') : t('profile.alerts.everythingBody')}</T>
          {user?.notifications === 'declined' ? <T v="small" color={colors.goldInk}>{t('profile.alerts.off')}</T> : null}
        </View>
      </Group>

      <Group label={t('profile.app')}>
        <Row icon="globe" value={t('profile.language')} sub={t('lang.current')} onPress={() => setSheet('language')} testID="profile-language" />
        <Row icon="lock" value={t('profile.security')} sub={tn('profile.securitySub', devices.data?.length ?? 1, { face: a?.faceId === false ? t('profile.faceOff') : t('profile.faceOn') })} onPress={() => router.push('/account/security')} testID="profile-security" />
        <Row icon="doc" value={t('profile.privacy')} sub={exportPending ? t('profile.privacySubPending') : t('profile.privacySub')} onPress={() => router.push('/account/privacy')} testID="profile-privacy" />
        <Row icon="bell" value={t('profile.help')} sub={t('profile.helpSub')} onPress={() => router.push('/account/help')} testID="profile-help" />
      </Group>

      <Button variant="secondary" label={t('profile.signOut')} onPress={() => setSheet('signout')} testID="profile-signout" />
      <T v="tiny" style={{ textAlign: 'center' }}>{t('profile.version', { version: VERSION })}</T>

      <PhotoSheet visible={sheet === 'photo'} onClose={() => setSheet(null)} initial={display.charAt(0)} />
      <LanguageSheet visible={sheet === 'language'} onClose={() => setSheet(null)} />
      <CardsSheet visible={sheet === 'cards'} onClose={() => setSheet(null)} onPicked={(label, changed) => toast(changed ? (label === t('cards.applePay') ? t('cards.default.applePay') : t('cards.default.changed', { label })) : t('cards.default.same'))} />
      <SignOutSheet visible={sheet === 'signout'} onClose={() => setSheet(null)} />
      <Sheet visible={typeof sheet === 'object' && !!sheet} onClose={() => setSheet(null)} label={t('cards.removeDefault.title')}>
        <T v="h2">{t('cards.removeDefault.title')}</T>
        <T v="body">{t('cards.removeDefault.body')}</T>
        {typeof sheet === 'object' && sheet ? saved.filter((c) => c.id !== sheet.removeDefault).map((c) => (
          <Button key={c.id} variant="secondary" style={{ backgroundColor: colors.mist }} icon={<PayMark brand={c.brand} size={22} />} label={t('cards.removeDefault.use', { label: c.label })} onPress={() => removeCard(sheet.removeDefault, c.id)} />
        )) : null}
        {typeof sheet === 'object' && sheet ? <Button variant="secondary" style={{ backgroundColor: colors.mist }} icon={<PayMark brand="applepay" size={22} />} label={t('cards.removeDefault.use', { label: t('cards.applePay') })} onPress={() => removeCard(sheet.removeDefault, 'applepay')} testID="remove-default-applepay" /> : null}
      </Sheet>
      <Sheet visible={sheet === 'lastcard'} onClose={() => setSheet(null)} label={t('cards.removeLast.title')}>
        <T v="h2">{t('cards.removeLast.title')}</T>
        <T v="body">{t('cards.removeLast.body')}</T>
        <Button variant="secondary" style={{ backgroundColor: colors.mist }} color={colors.badInk} label={t('cards.removeLast.confirm')} onPress={() => removeCard(def)} testID="remove-last" />
        <Button label={t('cards.keep')} onPress={() => setSheet(null)} />
      </Sheet>
    </AccountScreen>
  );
}

function Pill({ text }: { text: string }) {
  return <View style={styles.pill}><T v="caption" color={colors.ok} style={{ fontFamily: ff.ui600 }}>{text}</T></View>;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: 16, alignItems: 'center', paddingTop: 4 },
  cam: { position: 'absolute', end: -2, bottom: -2, width: 26, height: 26, borderRadius: 999, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.sand },
  face: { width: 34, height: 34, borderRadius: 999, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.paper },
  pill: { height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(47,122,75,0.12)', justifyContent: 'center' },
});
