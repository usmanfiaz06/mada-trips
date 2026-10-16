import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { CITY_INFO, type InviteLink, type LinkOptions, type Post, type PostKind } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/net/hooks';
import { GoneState } from '@/components/states';
import { circlesApi, ck, cityCover, photoSource, useAct, useMeId, whenLabel } from '@/lib/circles';
import { buzz } from '@/lib/haptics';
import { getLocale, t, tn } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors, ff } from '@/theme';
import { Face, Input, Row, SheetScroll, TextLink } from './ui';
import { QrCode } from './QrCode';

/* Sheets shared by several Circles screens: invite links, reports, the city picker, posting a tip, one tip opened. */

/**
 * Invite with a link (FLOWS.md §8): the link, its code and a QR code; WhatsApp first, then the system share sheet;
 * how long it lasts and how many it lets in (a change makes a new link and turns the old one off); turning it off.
 * The link is shown so it can be selected by hand if copying is refused.
 */
export function InviteSheet({ visible, onClose, what, load }: { visible: boolean; onClose: () => void; what: string; load: (o?: LinkOptions) => Promise<InviteLink> }) {
  const [link, setLink] = useState<InviteLink | null>(null);
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [days, setDays] = useState<1 | 7 | 14>(14);
  const [cap, setCap] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (visible && !link && !off && !failed) load().then(setLink).catch(() => setFailed(true)); }, [visible, link, off, failed, load]);
  const url = link?.url ?? '';
  const web = Platform.OS === 'web';
  const text = t('circles.invite.shareText', { url });
  const remake = async (o: LinkOptions, said: string) => {
    setBusy(true);
    try { const l = await load({ ...o, fresh: true }); setLink(l); setOff(false); buzz('success'); toast(said); } catch (e) { toast(e instanceof ApiError ? e.message : t('error.internal')); } finally { setBusy(false); }
  };
  const pick = (o: { days?: 1 | 7 | 14; cap?: number | null }) => {
    const d = o.days ?? days;
    const c = o.cap !== undefined ? o.cap : cap;
    setDays(d); setCap(c);
    void remake({ expiresInDays: d, maxUses: c }, t('circles.invite.made'));
  };
  const whatsapp = async () => {
    if (!url) return;
    const app = `whatsapp://send?text=${encodeURIComponent(text)}`;
    try {
      if (!web && (await Linking.canOpenURL(app))) await Linking.openURL(app);
      else await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`);
      buzz('success');
    } catch { toast(t('circles.invite.copyRefused')); }
  };
  const share = async () => {
    if (!url) return;
    try {
      if (web) { await Clipboard.setStringAsync(url); toast(t('circles.invite.copied')); }
      else await Share.share({ message: text });
      buzz('success');
    } catch {
      toast(t('circles.invite.copyRefused'));
    }
  };
  const copyCode = async () => { try { await Clipboard.setStringAsync(link!.code); toast(t('circles.invite.codeCopied')); } catch { toast(t('circles.invite.copyRefused')); } };
  const turnOff = async () => {
    if (!link?.id) return;
    setBusy(true);
    try { await circlesApi.cancelInvite(link.id); setLink(null); setOff(true); setConfirmOff(false); buzz('success'); toast(t('circles.invite.turnedOff')); } catch (e) { toast(e instanceof ApiError ? e.message : t('error.internal')); } finally { setBusy(false); }
  };
  const until = link ? new Date(link.expiresAt).toLocaleDateString(getLocale() === 'ar' ? 'ar-SA' : 'en-GB', { day: 'numeric', month: 'short' }) : '';
  const used = !link ? '' : link.maxUses != null ? t('circles.invite.usedOf', { uses: link.uses, max: link.maxUses }) : link.uses ? tn('circles.invite.usedOpen', link.uses) : '';

  return (
    <Sheet visible={visible} onClose={onClose} label={t('circles.invite.label')}>
      <SheetScroll>
        <T v="h2">{t('circles.invite.title', { what })}</T>
        <T v="small">{t('circles.invite.body')}</T>
        {off ? (
          <View style={{ gap: 12 }}>
            <T v="small" style={{ fontFamily: ff.ui600 }} testID="invite-off">{t('circles.invite.turnedOff')}</T>
            <Button label={t('circles.invite.makeNew')} busy={busy} onPress={() => remake({ expiresInDays: days, maxUses: cap }, t('circles.invite.made'))} testID="invite-new" />
          </View>
        ) : !link ? (
          // The circle (and its link) may still be on the way: say so, never an empty code and a blank QR.
          <View style={[s.qrRow, { justifyContent: 'center', minHeight: 132 }]} testID={failed ? 'invite-failed' : 'invite-loading'} accessibilityLiveRegion="polite">
            {failed ? (
              <View style={{ flex: 1, gap: 10, alignItems: 'flex-start' }}>
                <T v="small">{t('circles.invite.makeFailed')}</T>
                <Button size="small" block={false} label={t('common.tryAgain')} onPress={() => setFailed(false)} testID="invite-retry" />
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator color={colors.green} />
                <T v="small" style={{ fontFamily: ff.ui600 }}>{t('circles.invite.making')}</T>
              </View>
            )}
          </View>
        ) : (<>
          <View style={s.qrRow}>
            {url ? <QrCode value={url} size={132} label={t('circles.invite.qrA11y')} /> : <View style={{ width: 132, height: 132 }} />}
            <View style={{ flex: 1, gap: 6 }}>
              <T v="tiny">{t('circles.invite.codeLabel')}</T>
              <Pressable accessibilityRole="button" accessibilityLabel={`${t('circles.invite.codeLabel')} ${link?.code ?? ''}`} onPress={copyCode} disabled={!link} testID="invite-code">
                <T style={s.code} selectable>{link?.code ?? ' '}</T>
              </Pressable>
              <T v="tiny">{t('circles.invite.qrHint')}</T>
            </View>
          </View>
          <Input value={url.replace(/^https:\/\//, '')} editable={false} selectTextOnFocus accessibilityLabel={t('circles.invite.linkA11y')} testID="invite-link" />
          {link ? <T v="tiny" testID="invite-status">{[t('circles.invite.until', { date: until }), used].filter(Boolean).join(' ')}</T> : null}
          <Button label={t('circles.invite.whatsapp')} icon={<Icon name="phone" color={colors.mist} />} onPress={whatsapp} disabled={!url} testID="invite-whatsapp" />
          <Button variant="secondary" label={web ? t('circles.invite.copy') : t('circles.invite.more')} icon={<Icon name="link" />} onPress={share} disabled={!url} testID="invite-copy" />
          <Row gap={16} wrap>
            <TextLink label={t('circles.invite.options')} onPress={() => setSettings((v) => !v)} testID="invite-settings" />
            {link?.id ? <TextLink label={t('circles.invite.turnOff')} color={colors.ink3} onPress={() => setConfirmOff(true)} testID="invite-turn-off" /> : null}
          </Row>
          {settings ? (
            <View style={{ gap: 10 }} testID="invite-options">
              <T v="small" style={{ fontFamily: ff.ui600 }}>{t('circles.invite.lasts')}</T>
              <Row wrap gap={8}>{([1, 7, 14] as const).map((d) => <Chip key={d} label={tn('circles.invite.days', d)} on={days === d} onPress={() => pick({ days: d })} />)}</Row>
              <T v="small" style={{ fontFamily: ff.ui600 }}>{t('circles.invite.letsIn')}</T>
              <Row wrap gap={8}>{([null, 2, 5, 10, 20] as const).map((c) => <Chip key={String(c)} label={c == null ? t('circles.invite.anyone') : tn('circles.invite.people', c)} on={cap === c} onPress={() => pick({ cap: c })} />)}</Row>
            </View>
          ) : null}
          {confirmOff ? (
            <View style={s.confirm} testID="invite-confirm-off">
              <T v="h3">{t('circles.invite.turnOffTitle')}</T>
              <T v="small">{t('circles.invite.turnOffBody')}</T>
              <Row gap={8}>
                <Button size="small" block={false} label={t('circles.invite.turnOff')} busy={busy} onPress={turnOff} testID="invite-turn-off-yes" />
                <Button size="small" block={false} variant="ghost" label={t('common.cancel')} onPress={() => setConfirmOff(false)} />
              </Row>
            </View>
          ) : null}
        </>)}
      </SheetScroll>
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
export function PostSheet({ visible, onClose, cities, initialCity, onPosted }: { visible: boolean; onClose: () => void; cities: string[]; initialCity: string; onPosted: (audience: 'friends' | 'everyone', held?: string | null) => void }) {
  const [city, setCity] = useState(initialCity);
  const [place, setPlace] = useState('');
  const [text, setText] = useState('');
  const [kind, setKind] = useState<PostKind>('food');
  const [audience, setAudience] = useState<'friends' | 'everyone'>('friends');
  const [photo, setPhoto] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useAct(circlesApi.createPost, () => [ck.all], (b) => ({ kind: 'circle-post', label: b.place, method: 'POST', path: '/posts', body: b }));
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
    onSuccess: (r) => { buzz('success'); setPlace(''); setText(''); setPhoto(null); setConsent(false); onPosted(audience, r.post.held); },
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
  const live = useApiQuery({ queryKey: ['circles', 'post', post?.id ?? ''], queryFn: () => circlesApi.post(post!.id), enabled: !!post, retry: false });
  const del = useAct((id: string) => circlesApi.deletePost(id));
  // A thank refreshes this tip and the feed, so the count under it ("2 people thanked Noor") moves at once.
  const thank = useAct((id: string) => circlesApi.thank(id), (id) => [['circles', 'post', id], ['circles', 'posts'], ck.profile(post?.author.id ?? '')]);
  const report = useAct((r: { id: string; reason: string }) => circlesApi.report({ targetKind: 'post', targetId: r.id, reason: r.reason as 'other' }), () => []);
  if (!post) return <Sheet visible={false} onClose={onClose} label=""><View /></Sheet>;
  if (live.isError && (live.error as ApiError)?.status === 404) return (
    <Sheet visible onClose={onClose} label={post.place}><GoneState variant="card" /><T v="small" style={{ textAlign: 'center' }}>{t('circles.tipDetail.gone')}</T></Sheet>
  );
  const mine = post.author.id === me;
  const plan = () => { onClose(); router.push({ pathname: '/ask', params: { prefill: post.kind === 'food' ? t('circles.tableAsk', { place: post.place }) : post.place } }); };
  const rel = relLabel(post);
  const src = photoSource(post);
  const fresh = live.data?.post ?? post;
  const counted = { ...fresh, thanks: fresh.thanks + (thanked && !fresh.thanked ? 1 : 0), thanked: fresh.thanked || thanked };
  const thanksText = thanksLine(counted);
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
          {/* Why it waits for a person, or why it didn't go up: to its author, in plain words (moderation). */}
          {mine && post.held ? <T v="small" testID="tip-held" style={{ color: colors.ink2 }}>{post.held}</T> : null}
          <Row wrap gap={8}>
            <Button size="small" block={false} variant={post.saved ? 'gold' : 'secondary'} label={post.saved ? t('circles.saved') : t('circles.save')} onPress={() => onSave(post)} testID="tip-save" />
            <Button size="small" block={false} label={post.kind === 'food' ? t('circles.bookTable') : t('circles.tipDetail.planWith')} onPress={plan} />
            {!mine ? <Button size="small" block={false} variant="secondary" disabled={counted.thanked} label={counted.thanked ? t('circles.tipDetail.thanked', { name: post.author.short }) : t('circles.tipDetail.thank', { name: post.author.short })} onPress={() => { setThanked(true); thank.mutate(post.id); }} testID="tip-thank" /> : null}
          </Row>
          {thanksText ? <Row gap={6}><Icon name="star" size={14} color={colors.goldInk} /><T v="small" color={colors.goldInk} testID="tip-thanks">{thanksText}</T></Row> : null}
          {mine
            ? <Button variant="ghost" color={colors.badInk} label={t('circles.tipDetail.delete')} onPress={() => setMode('delete')} testID="tip-delete" />
            : <Button variant="ghost" color={colors.badInk} label={t('circles.tipDetail.report')} onPress={() => setMode('report')} testID="tip-report" />}
        </>)}
      </SheetScroll>
    </Sheet>
  );
}

/** "2 people thanked Abdullah for this", "You and 1 other thanked Noor": the thanks under a tip, or null when none yet. */
export function thanksLine(p: Pick<Post, 'thanks' | 'thanked' | 'author' | 'relation'>): string | null {
  const name = p.relation === 'you' ? t('circles.you') : p.author.short;
  if (!p.thanks) return null;
  if (p.thanked) return p.thanks > 1 ? tn('circles.tip.thanksYouOthers', p.thanks - 1, { name }) : t('circles.tip.thanksYou', { name });
  return tn('circles.tip.thanks', p.thanks, { name });
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
  qrRow: { flexDirection: "row", alignItems: "center", gap: 16, padding: 12, borderRadius: 22, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  code: { fontFamily: ff.mono, fontSize: 17, letterSpacing: 0.5, color: colors.green, writingDirection: "ltr" },
  confirm: { gap: 8, padding: 14, borderRadius: 18, backgroundColor: colors.mist },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingStart: 8, paddingEnd: 12, borderRadius: 18, backgroundColor: colors.mist },
  cityOn: { backgroundColor: colors.goldWash, borderWidth: 1.5, borderColor: colors.gold, paddingVertical: 6.5, paddingStart: 6.5, paddingEnd: 10.5 },
  cityImg: { width: 48, height: 48, borderRadius: 12 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#c9c1b4', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: colors.green, borderColor: colors.green },
});
