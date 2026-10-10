import { useEffect, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import * as Contacts from 'expo-contacts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { checkSaudiMobile, contactHash, type FriendView, type SearchHit } from '@mada/shared';
import { ArtFriends } from '@/components/art/Arts';
import { Button } from '@/components/Button';
import { ArtCompass, ArtEnvelope, ArtLantern } from '@/components/circles/art';
import { InviteSheet } from '@/components/circles/sheets';
import { ChoiceCard, Face, PersonRow, Row, SheetScroll, TabsText, TextLink } from '@/components/circles/ui';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Screen, TopBar } from '@/components/Layout';
import { Pill } from '@/components/Pill';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { ApiError } from '@/lib/api';
import { circlesApi, ck, useAct, useFriends, useInvites, whenLabel } from '@/lib/circles';
import { API_MODE } from '@/lib/config';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors } from '@/theme';

type Tab = 'friends' | 'following' | 'invited' | 'requests';
type SheetMode = null | 'add' | 'ask' | 'denied' | 'found' | 'link';
/** The mock world's phone book on the web, where no contacts can be read: Maha, Yousef and Reem (the prototype's). */
const DEMO_CONTACTS = ['+966551000005', '+966551000006', '+966551000003'];

/** Your people (prototype People): friends, following, invited, requests; add friends by contacts, number or link. */
export default function People() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: Tab; add?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab ?? 'friends');
  const [sheet, setSheet] = useState<SheetMode>(params.add ? 'add' : null);
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState<string[]>([]);
  const [found, setFound] = useState<SearchHit[] | null>(null);
  const [byPhone, setByPhone] = useState<{ digits: string; hit: SearchHit | null } | null>(null);
  const friends = useFriends();
  const invites = useInvites();
  const f = friends.data;
  const sentInv = invites.data?.sent ?? [];
  const pending = sentInv.filter((i) => i.status === 'pending').length;
  const add = useAct(circlesApi.addFriend, () => [ck.friends]);
  const accept = useAct(circlesApi.acceptFriend, () => [ck.friends, ck.all]);
  const decline = useAct(circlesApi.removeFriend, () => [ck.friends]);
  const block = useAct(circlesApi.block, () => [ck.friends]);
  const remind = useAct(circlesApi.remindInvite, () => [ck.invites]);
  const cancel = useAct(circlesApi.cancelInvite, () => [ck.invites]);
  const invite = useAct(circlesApi.createInvite, () => [ck.invites]);
  const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : t('error.internal'));

  const digits = phone.replace(/\D/g, '').replace(/^0/, '');
  const check = checkSaudiMobile(digits);
  useEffect(() => {
    if (!check.ok) { setByPhone(null); return; }
    let live = true;
    circlesApi.search(check.e164).then((r) => { if (live) setByPhone({ digits, hit: r.people[0] ?? null }); }).catch(() => {});
    return () => { live = false; };
  }, [digits]); // eslint-disable-line react-hooks/exhaustive-deps

  const askFriend = (p: { id: string; short: string }) => add.mutate(p.id, { onSuccess: (r) => { buzz('tap'); setSent([...sent, p.id]); toast(r.status === 'friends' ? t('circles.people.friendsNow', { name: p.short }) : t('circles.addFriends.requestSent')); }, onError: fail });
  const contacts = async () => {
    let numbers: string[] = [];
    if (Platform.OS === 'web') {
      if (API_MODE !== 'mock') { setSheet('denied'); return; }
      numbers = DEMO_CONTACTS;
    } else {
      const perm = await Contacts.requestPermissionsAsync();
      if (perm.status !== 'granted') { setSheet('denied'); return; }
      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
      numbers = data.flatMap((c) => (c.phoneNumbers ?? []).map((n) => n.number ?? '')).map((n) => checkSaudiMobile(n)).filter((x) => x.ok).map((x) => (x as { e164: string }).e164);
    }
    // Hashed here, on the phone. Only the hashes leave; nothing is stored.
    const hashes = [...new Set(numbers)].slice(0, 2000).map(contactHash);
    try { setFound((await circlesApi.contacts(hashes)).people); setSheet('found'); } catch (e) { fail(e); }
  };
  const friendIds = new Set((f?.friends ?? []).map((x) => x.id));
  const sub = (x: FriendView) => (x.going ? t('circles.people.going', { going: x.going }) : t('circles.people.explored', { count: x.places }));
  const channel = (c: string) => t(c === 'whatsapp' ? 'circles.people.channel.whatsapp' : c === 'sms' ? 'circles.people.channel.sms' : 'circles.people.channel.link');

  return (
    <Screen>
      <TopBar onBack={() => router.back()} backLabel={t('circles.back')} right={<Button size="small" block={false} label={t('circles.friends.add')} onPress={() => setSheet('add')} testID="people-add" />} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120, gap: 14 }} keyboardShouldPersistTaps="handled">
        <T v="h1" accessibilityRole="header">{t('circles.people.title')}</T>
        <TabsText label={t('circles.people.tabsA11y')} size={20} value={tab} onChange={setTab} tabs={[
          ['friends', t('circles.people.friends'), f?.friends.length], ['following', t('circles.people.following'), f?.following.length],
          ['invited', t('circles.people.invited'), pending], ['requests', t('circles.people.requests'), f?.requests.length],
        ]} />

        {tab === 'friends' && f ? (f.friends.length ? f.friends.map((x) => <PersonRow key={x.id} p={x} sub={sub(x)} onPress={() => router.push(`/friend/${x.id}`)} right={<Icon name="chevron" />} />) : (
          <EmptyState art={<ArtFriends />} title={t('circles.people.friendsEmptyTitle')} body={t('circles.people.friendsEmptyBody')} action={<Button label={t('circles.friends.add')} onPress={() => setSheet('add')} />} />
        )) : null}

        {tab === 'following' && f ? (f.following.length ? f.following.map((x) => <PersonRow key={x.id} p={x} sub={t('circles.people.followingSub', { count: x.trips })} onPress={() => router.push(`/friend/${x.id}`)} right={<Icon name="chevron" />} />) : (
          <EmptyState art={<ArtCompass />} title={t('circles.people.followingEmptyTitle')} body={t('circles.people.followingEmptyBody')} action={<Button label={t('circles.people.followingEmptyAction')} onPress={() => router.navigate('/circles')} />} />
        )) : null}

        {tab === 'invited' && invites.data ? (sentInv.length ? sentInv.map((iv) => (
          <View key={iv.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 18, backgroundColor: colors.paper }} testID="invite-row">
            {iv.joined ? <Face p={iv.joined} /> : <Face p={{ initial: iv.label.replace(/^\+/, '').charAt(0), tone: 'default' }} />}
            <View style={{ flex: 1, gap: 4 }}>
              <Row gap={8} style={{ justifyContent: 'space-between' }}><T v="h3" style={{ fontSize: 15 }}>{iv.label}</T><Pill variant={iv.status === 'joined' ? 'ok' : 'default'} label={iv.status === 'joined' ? t('circles.people.joined') : iv.status === 'expired' ? t('circles.people.expired') : t('circles.people.notYet')} /></Row>
              <T v="tiny">{`${t('circles.people.sentBy', { channel: channel(iv.channel), when: whenLabel(iv.sentAt) })}${iv.remindedAt ? ` · ${t('circles.people.remindedToday')}` : ''}`}</T>
              {iv.status === 'pending' ? (
                <Row gap={8}>
                  <Button size="small" block={false} variant="secondary" style={{ backgroundColor: colors.mist }} disabled={!!iv.remindedAt} label={iv.remindedAt ? t('circles.settings.reminded') : t('circles.settings.remind')}
                    onPress={() => remind.mutate(iv.id, { onSuccess: () => toast(t('circles.people.remindToast', { name: iv.label, channel: channel(iv.channel) })), onError: fail })} />
                  <Button size="small" block={false} variant="ghost" label={t('circles.settings.cancelInvite')} onPress={() => cancel.mutate(iv.id, { onSuccess: () => toast(t('circles.people.cancelToast')) })} />
                </Row>
              ) : null}
              {iv.joined ? <TextLink size={13} label={t('circles.people.see', { name: iv.joined.short })} onPress={() => router.push(`/friend/${iv.joined!.id}`)} /> : null}
            </View>
          </View>
        )) : (
          <EmptyState art={<ArtEnvelope />} title={t('circles.people.invitedEmptyTitle')} body={t('circles.people.invitedEmptyBody')} action={<Button label={t('circles.people.shareLink')} onPress={() => setSheet('link')} />} />
        )) : null}

        {tab === 'requests' && f ? (f.requests.length ? f.requests.map((x) => (
          <View key={x.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 18, backgroundColor: colors.paper }}>
            <Face p={x} />
            <View style={{ flex: 1, gap: 6 }}>
              <View><T v="h3" style={{ fontSize: 15 }}>{x.name}</T><T v="tiny">{t('circles.people.requestSub', { trips: x.trips, mutual: x.mutual })}</T></View>
              <Row gap={8} wrap>
                <Button size="small" block={false} label={t('circles.people.accept')} haptic="success" onPress={() => accept.mutate(x.id, { onSuccess: () => toast(t('circles.people.friendsNow', { name: x.short })) })} testID="request-accept" />
                <Button size="small" block={false} variant="secondary" label={t('circles.people.decline')} onPress={() => decline.mutate(x.id, { onSuccess: () => toast(t('circles.people.declined', { name: x.short })) })} />
                <Button size="small" block={false} variant="ghost" color={colors.badInk} label={t('circles.people.block')} onPress={() => block.mutate(x.id, { onSuccess: () => toast(t('circles.people.blocked', { name: x.short })) })} />
              </Row>
            </View>
          </View>
        )) : (
          <EmptyState art={<ArtLantern />} title={t('circles.people.requestsEmptyTitle')} body={t('circles.people.requestsEmptyBody')} />
        )) : null}
      </ScrollView>

      <Sheet visible={sheet === 'add'} onClose={() => setSheet(null)} label={t('circles.addFriends.title')}>
        <SheetScroll>
          <T v="h2">{t('circles.addFriends.title')}</T>
          <ChoiceCard title={t('circles.addFriends.contacts')} sub={t('circles.addFriends.contactsSub')} onPress={() => setSheet('ask')} testID="from-contacts" />
          <Field label={t('circles.addFriends.byPhone')} prefix="+966" keyboardType="phone-pad" placeholder={t('circles.addFriends.phoneHint')} value={phone} onChangeText={setPhone} testID="add-phone"
            error={digits.length >= 9 && !check.ok ? t('circles.addFriends.phoneBad') : null} />
          {check.ok && byPhone?.digits === digits ? (byPhone.hit ? (
            friendIds.has(byPhone.hit.id) ? <T v="small">{t('circles.addFriends.already', { name: byPhone.hit.short })}</T>
              : <PersonRow p={byPhone.hit} sub={t('circles.addFriends.onMada')} right={<Button size="small" block={false} disabled={sent.includes(byPhone.hit.id)} label={sent.includes(byPhone.hit.id) ? t('circles.addFriends.sent') : t('circles.addFriends.add')} onPress={() => askFriend(byPhone.hit!)} />} />
          ) : (
            <View style={{ backgroundColor: colors.mist, borderRadius: 24, padding: 16, gap: 8 }}>
              <T v="h3" style={{ fontSize: 15 }}>{t('circles.addFriends.notOnMada')}</T>
              <Button size="small" block={false} variant="secondary" style={{ alignSelf: 'flex-start' }} label={t('circles.addFriends.inviteSms')} testID="invite-sms"
                onPress={() => check.ok && invite.mutate({ phone: check.e164, channel: 'sms' }, { onSuccess: () => { setPhone(''); setSheet(null); setTab('invited'); toast(t('circles.addFriends.smsSent')); }, onError: fail })} />
            </View>
          )) : null}
          <Button variant="secondary" style={{ backgroundColor: colors.mist }} icon={<Icon name="link" size={18} />} label={t('circles.people.shareLink')} onPress={() => setSheet('link')} />
        </SheetScroll>
      </Sheet>
      <Sheet visible={sheet === 'ask'} onClose={() => setSheet(null)} label={t('circles.contacts.askLabel')}>
        <T v="h2">{t('circles.contacts.askTitle')}</T>
        <T v="body">{t('circles.contacts.askBody')}</T>
        <Button label={t('circles.contacts.allow')} onPress={contacts} testID="contacts-allow" />
        <Button variant="ghost" label={t('circles.contacts.deny')} onPress={() => setSheet('denied')} />
      </Sheet>
      <Sheet visible={sheet === 'denied'} onClose={() => setSheet(null)} label={t('circles.contacts.deniedLabel')}>
        <T v="h2">{t('circles.contacts.deniedTitle')}</T>
        <T v="body">{t('circles.contacts.deniedBody')}</T>
        <Button label={t('circles.people.shareLink')} onPress={() => setSheet('link')} />
      </Sheet>
      <Sheet visible={sheet === 'found'} onClose={() => setSheet(null)} label={t('circles.contacts.foundLabel')}>
        <SheetScroll>
          <T v="h2">{t('circles.contacts.foundTitle')}</T>
          {(found ?? []).filter((p) => !friendIds.has(p.id)).map((p) => {
            const asked = (f?.requests ?? []).some((r) => r.id === p.id);
            return <PersonRow key={p.id} p={p} sub={t('circles.contacts.mutual', { count: p.mutual })} right={asked
              ? <Button size="small" block={false} label={t('circles.people.accept')} onPress={() => accept.mutate(p.id, { onSuccess: () => toast(t('circles.people.friendsNow', { name: p.short })) })} />
              : <Button size="small" block={false} disabled={sent.includes(p.id) || (f?.asked ?? []).includes(p.id)} label={sent.includes(p.id) || (f?.asked ?? []).includes(p.id) ? t('circles.addFriends.sent') : t('circles.addFriends.add')} onPress={() => askFriend(p)} testID="contact-add" />} />;
          })}
          {found && found.length === 0 ? <T v="small">{t('circles.contacts.none')}</T> : found && found.every((p) => friendIds.has(p.id)) ? <T v="small">{t('circles.contacts.allFriends')}</T> : null}
        </SheetScroll>
      </Sheet>
      <InviteSheet visible={sheet === 'link'} onClose={() => setSheet(null)} what={t('circles.invite.mada')} load={() => circlesApi.createInvite({ link: true }).then((r) => r.link!)} />
    </Screen>
  );
}
