import { useEffect, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { CITY_INFO, type InviteLink, type Post, type PostKind } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { ApiError } from '@/lib/api';
import { circlesApi, ck, cityCover, photoSource, useAct, useMeId, whenLabel } from '@/lib/circles';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors, ff } from '@/theme';
import { Face, Input, Row, SheetScroll } from './ui';

/* Sheets shared by several Circles screens: invite links, reports, the city picker, posting a tip, one tip opened. */

/** Invite with a link. The link is shown so it can be selected by hand if copying is refused (FLOWS.md §8). */
export function InviteSheet({ visible, onClose, what, load }: { visible: boolean; onClose: () => void; what: string; load: () => Promise<InviteLink> }) {
  const [link, setLink] = useState<InviteLink | null>(null);
  useEffect(() => { if (visible && !link) load().then(setLink).catch(() => toast(t('error.internal'))); }, [visible, link, load]);
  const url = link?.url ?? '';
  const web = Platform.OS === 'web';
  const share = async () => {
    if (!url) return;
    try {
      if (web) { await Clipboard.setStringAsync(url); toast(t('circles.invite.copied')); }
      else await Share.share({ message: t('circles.invite.shareText', { url }) });
      buzz('success');
    } catch {
      toast(t('circles.invite.copyRefused'));
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} label={t('circles.invite.label')}>
      <T v="h2">{t('circles.invite.title', { what })}</T>
      <T v="small">{t('circles.invite.body')}</T>
      <Input value={url.replace(/^https:\/\//, '')} editable={false} selectTextOnFocus accessibilityLabel={t('circles.invite.linkA11y')} testID="invite-link" />
      <Button label={web ? t('circles.invite.copy') : t('circles.invite.shareNative')} icon={<Icon name="link" color={colors.mist} />} onPress={share} disabled={!url} testID="invite-copy" />
    </Sheet>
  );
}

export const REASONS = ['unwanted', 'impostor', 'unsafe', 'other'] as const;
export type Reason = (typeof REASONS)[number];

/** "What's wrong?" Four reasons, one button. */
export function ReportBody({ onSend, cta = t('circles.report.send') }: { onSend: (r: Reason) => void; cta?: string }) {
  const [reason, setReason] = useState<Reason | null>(null);
  return (
    <>
      <T v="h2">{t('circles.report.title')}</T>
      <Row wrap gap={8}>{REASONS.map((r) => <Chip key={r} label={t(`circles.report.${r}`)} on={reason === r} onPress={() => setReason(r)} />)}</Row>
      <Button label={cta} disabled={!reason} onPress={() => reason && onSend(reason)} testID="report-send" />
    </>
  );
}

/** "What's on where?": where you are, your trips, worth a look; or a search, honest about cities we don't cover. */
export function CitySheet({ visible, onClose, current, sheet, onPick, onGuide }: {
  visible: boolean; onClose: () => void; current: string; sheet: { title: 'here' | 'trips' | 'worth'; rows: { city: string; note: string }[] }[]; onPick: (city: string) => void; onGuide: (city: string) => void;
}) {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const hits = term ? Object.keys(CITY_INFO).filter((c) => c.toLowerCase().includes(term)) : null;
  const note = (n: string) => (n === 'here' ? t('circles.city.hereNow') : n === 'planned' ? t('circles.city.planned') : n === 'popular' ? t('circles.city.popular') : n);
  const row = (city: string, sub: string) => (
    <Pressable key={city + sub} accessibilityRole="button" accessibilityState={{ selected: city === current }} accessibilityLabel={city}
      onPress={() => { buzz('select'); setQ(''); onPick(city); }} style={[s.cityRow, city === current ? s.cityOn : null]}>
      <Image source={cityCover(city)} style={s.cityImg} contentFit="cover" />
      <View style={{ flex: 1 }}><T v="h3" style={{ fontSize: 16 }}>{city}</T><T v="tiny">{sub}</T></View>
      {city === current ? <Icon name="check" size={20} width={2.4} /> : null}
    </Pressable>
  );
  return (
    <Sheet visible={visible} onClose={() => { setQ(''); onClose(); }} label={t('circles.city.label')}>
      <SheetScroll>
        <T v="h2">{t('circles.city.title')}</T>
        <Input placeholder={t('circles.city.search')} value={q} onChangeText={setQ} accessibilityLabel={t('circles.city.search')} testID="city-search" />
        {hits ? (
          <View style={{ gap: 8 }}>
            {hits.map((c) => row(c, CITY_INFO[c]!.country))}
            {/* Anywhere else opens its city guide (the places screens own /city/[id]). */}
            {!hits.some((c) => c.toLowerCase() === term) ? (
              <Pressable accessibilityRole="button" accessibilityLabel={q.trim()} onPress={() => { buzz('select'); setQ(''); onClose(); onGuide(q.trim()); }} style={s.cityRow} testID="city-guide">
                <View style={[s.cityImg, { backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' }]}><Icon name="globe" /></View>
                <View style={{ flex: 1 }}><T v="h3" style={{ fontSize: 16 }}>{q.trim()}</T><T v="tiny">{t('circles.city.guide')}</T></View>
                <Icon name="chevron" />
              </Pressable>
            ) : null}
          </View>
        ) : sheet.map((g) => (
          <View key={g.title} style={{ gap: 8 }}>
            <T v="eyebrow">{t(`circles.city.${g.title}`)}</T>
            {g.rows.map((r) => row(r.city, note(r.note)))}
          </View>
        ))}
      </SheetScroll>
    </Sheet>
  );
}

/** Post a tip: city, place, the tip, kind, an optional photo everyone in it agreed to, who sees it. Checked before it shows. */
export function PostSheet({ visible, onClose, cities, initialCity, onPosted }: { visible: boolean; onClose: () => void; cities: string[]; initialCity: string; onPosted: (audience: 'friends' | 'everyone') => void }) {
  const [city, setCity] = useState(initialCity);
  const [place, setPlace] = useState('');
  const [text, setText] = useState('');
  const [kind, setKind] = useState<PostKind>('food');
  const [audience, setAudience] = useState<'friends' | 'everyone'>('friends');
  const [photo, setPhoto] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useAct(circlesApi.createPost, () => [ck.all]);
  const ok = place.trim().length > 2 && text.trim().length > 10 && (!photo || consent);
  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6, base64: true, allowsEditing: false });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    const data = a.base64 ? `data:${a.mimeType ?? 'image/jpeg'};base64,${a.base64}` : a.uri.startsWith('data:') ? a.uri : null;
    if (!data || data.length > 2_700_000) { setError(t('circles.postTip.photoTooBig')); return; }
    setError(null); setPhoto(data); setConsent(false);
  };
  const post = () => create.mutate({ city, place: place.trim(), text: text.trim(), kind, audience, photo, photoConsent: photo ? consent : undefined }, {
    onSuccess: () => { buzz('success'); setPlace(''); setText(''); setPhoto(null); setConsent(false); onPosted(audience); },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('error.internal')),
  });
  return (
    <Sheet visible={visible} onClose={onClose} label={t('circles.postTip.title')}>
      <SheetScroll>
        <T v="h2">{t('circles.postTip.title')}</T>
        <Row wrap gap={8}>{cities.map((c) => <Chip key={c} label={c} on={city === c} onPress={() => setCity(c)} />)}</Row>
        <Field label={t('circles.postTip.place')} value={place} onChangeText={setPlace} placeholder={t('circles.postTip.placeHint')} maxLength={80} testID="tip-place" />
        <View style={{ gap: 6 }}>
          <T v="small" style={{ fontFamily: ff.ui600 }}>{t('circles.postTip.tip')}</T>
          <Input value={text} onChangeText={setText} placeholder={t('circles.postTip.tipHint')} multiline maxLength={600} accessibilityLabel={t('circles.postTip.tip')}
            style={{ height: 96, paddingTop: 14, textAlignVertical: 'top', lineHeight: 22 }} testID="tip-text" />
        </View>
        <Row wrap gap={8}>{(['food', 'todo'] as const).map((k) => <Chip key={k} label={t(`circles.kind.${k}`)} on={kind === k} onPress={() => setKind(k)} />)}</Row>
        <View style={{ gap: 8 }}>
          <T v="small" style={{ fontFamily: ff.ui600 }}>{t('circles.postTip.photo')}</T>
          {photo ? <Image source={{ uri: photo }} style={{ height: 140, borderRadius: 16 }} contentFit="cover" /> : null}
          <Button size="small" block={false} variant="secondary" label={photo ? t('circles.postTip.changePhoto') : t('circles.postTip.addPhoto')} onPress={pick} style={{ alignSelf: 'flex-start' }} />
          {photo ? (
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => { buzz('select'); setConsent(!consent); }} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }} testID="tip-consent">
              <View style={[s.box, consent ? s.boxOn : null]}>{consent ? <Icon name="check" size={14} color={colors.mist} width={2.6} /> : null}</View>
              <T v="small" style={{ flex: 1 }}>{t('circles.postTip.consent')}</T>
            </Pressable>
          ) : null}
        </View>
        <Row wrap gap={8}>{(['friends', 'everyone'] as const).map((a) => <Chip key={a} label={t(`circles.postTip.${a}`)} on={audience === a} onPress={() => setAudience(a)} />)}</Row>
        <T v="tiny">{t('circles.postTip.note')}</T>
        {error ? <T v="small" color={colors.badInk} accessibilityRole="alert">{error}</T> : null}
        <Button label={t('circles.postTip.post')} disabled={!ok} busy={create.isPending} onPress={post} haptic={null} testID="tip-post" />
      </SheetScroll>
    </Sheet>
  );
}

/** One tip, opened: save it, plan it, thank the person, report it, or take your own down. */
export function PostDetail({ post, onClose, onSave }: { post: Post | null; onClose: () => void; onSave: (p: Post) => void }) {
  const router = useRouter();
  const me = useMeId();
  const [mode, setMode] = useState<'view' | 'delete' | 'report'>('view');
  const [thanked, setThanked] = useState(false);
  const del = useAct((id: string) => circlesApi.deletePost(id));
  const thank = useAct((id: string) => circlesApi.thank(id), () => []);
  const report = useAct((r: { id: string; reason: string }) => circlesApi.report({ targetKind: 'post', targetId: r.id, reason: r.reason as 'other' }), () => []);
  if (!post) return <Sheet visible={false} onClose={onClose} label=""><View /></Sheet>;
  const mine = post.author.id === me;
  const plan = () => { onClose(); router.push({ pathname: '/ask', params: { prefill: post.kind === 'food' ? t('circles.tableAsk', { place: post.place }) : post.place } }); };
  const rel = relLabel(post);
  const src = photoSource(post);
  return (
    <Sheet visible onClose={onClose} label={post.place}>
      <SheetScroll>
        {mode === 'delete' ? (<>
          <T v="h2">{t('circles.tipDetail.deleteTitle')}</T>
          <T v="body">{t('circles.tipDetail.deleteBody')}</T>
          <Button variant="secondary" color={colors.badInk} label={t('circles.tipDetail.deleteYes')} onPress={() => del.mutate(post.id, { onSuccess: () => { toast(t('circles.tipDetail.deleted')); onClose(); } })} testID="tip-delete-yes" />
          <Button variant="ghost" label={t('circles.keepIt')} onPress={() => setMode('view')} />
        </>) : mode === 'report' ? (
          <ReportBody onSend={(reason) => report.mutate({ id: post.id, reason }, { onSuccess: () => { buzz('success'); toast(t('circles.tipDetail.reported')); onClose(); } })} />
        ) : (<>
          {src ? <Image source={src} style={{ width: '100%', height: 180, borderRadius: 20 }} contentFit="cover" /> : null}
          <Pressable accessibilityRole="button" disabled={mine} onPress={() => { onClose(); router.push(`/friend/${post.author.id}`); }} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Face p={post.author} size={32} />
            <View><T v="h3" style={{ fontSize: 15 }}>{mine ? t('circles.you') : post.author.short}</T><T v="tiny">{[rel, whenLabel(post.createdAt), post.status === 'pending' ? t('circles.post.checking') : null].filter(Boolean).join(' · ')}</T></View>
          </Pressable>
          <T v="h2">{post.place}</T>
          <T v="body">{post.text}</T>
          <Row wrap gap={8}>
            <Button size="small" block={false} variant={post.saved ? 'gold' : 'secondary'} label={post.saved ? t('circles.saved') : t('circles.save')} onPress={() => onSave(post)} testID="tip-save" />
            <Button size="small" block={false} label={post.kind === 'food' ? t('circles.bookTable') : t('circles.tipDetail.planWith')} onPress={plan} />
            {!mine ? <Button size="small" block={false} variant="secondary" disabled={thanked} label={thanked ? t('circles.tipDetail.thanked', { name: post.author.short }) : t('circles.tipDetail.thank', { name: post.author.short })} onPress={() => { setThanked(true); thank.mutate(post.id); }} /> : null}
          </Row>
          {mine
            ? <Button variant="ghost" color={colors.badInk} label={t('circles.tipDetail.delete')} onPress={() => setMode('delete')} testID="tip-delete" />
            : <Button variant="ghost" color={colors.badInk} label={t('circles.tipDetail.report')} onPress={() => setMode('report')} testID="tip-report" />}
        </>)}
      </SheetScroll>
    </Sheet>
  );
}

/** "Friend", "Mada traveller · 14 trips": who posted, from your side. */
export function relLabel(p: Pick<Post, 'relation' | 'authorTrips'>): string {
  if (p.relation === 'you') return t('circles.rel.you');
  if (p.relation === 'family') return t('circles.rel.family');
  if (p.relation === 'friend') return t('circles.rel.friend');
  if (p.relation === 'following') return t('circles.rel.following');
  return p.authorTrips ? t('circles.rel.mada', { count: p.authorTrips }) : t('circles.rel.madaNew');
}

const s = StyleSheet.create({
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingStart: 8, paddingEnd: 12, borderRadius: 18, backgroundColor: colors.mist },
  cityOn: { backgroundColor: colors.goldWash, borderWidth: 1.5, borderColor: colors.gold, paddingVertical: 6.5, paddingStart: 6.5, paddingEnd: 10.5 },
  cityImg: { width: 48, height: 48, borderRadius: 12 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#c9c1b4', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: colors.green, borderColor: colors.green },
});
