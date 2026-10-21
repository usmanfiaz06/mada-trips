import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { docLabel, fullDay, type AskDocTap, type ChatDocCard, type ChatShareCard, type CopyKey } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Pill } from '@/components/Pill';
import { T } from '@/components/Text';
import { IconTile } from '@/components/trips/ui';
import { Toggle, enter } from './parts';
import { attachToChat, sendShare, tapDocument } from '@/lib/ask-docs';
import { usePassportScan } from '@/lib/passport-scan';
import { getLocale, t } from '@/lib/i18n';
import { colors, radii } from '@/theme';

/*
 * The one card a passport, visa or ID gets in Ask (docs/app/ASK-INTEGRATED.md §6.2): the document as the mask shows it
 * (kind, first name, the last two characters, valid to), and the choices for its case. Nothing is saved until one of
 * these is tapped; the server's answer moves the card under Mada's next line (lib/ask-docs.ts tapDocument).
 */

const DONE: ChatDocCard['case'][] = ['used', 'saved', 'replaced', 'booking_only', 'discarded'];

export function DocumentCard({ card, turnId }: { card: ChatDocCard; turnId: number }) {
  const router = useRouter();
  const locale = getLocale();
  const [busy, setBusy] = useState<string | null>(null);
  const [keepCopy, setKeepCopy] = useState(false);
  const words = { passport: t('doc.kind.passport'), visa: t('doc.kind.visa'), id: t('doc.kind.id'), other: t('doc.kind.other') };
  const label = card.case === 'unreadable' ? t('doc.me.photo') : docLabel(card.kind, card.holder, card.ending, words);
  const go = async (choice: AskDocTap['choice'], personId?: string) => {
    if (busy) return;
    setBusy(personId ?? choice);
    const ok = await tapDocument(turnId, card.attachmentId, { choice, personId: personId ?? null, ...(card.hasFile ? { keepCopy } : {}) });
    if (!ok) setBusy(null);
  };
  const done = DONE.includes(card.case);
  const btn = (choice: AskDocTap['choice'], key: CopyKey, soft = false, vars?: Record<string, string>) => (
    <Button key={choice} size="small" variant={soft ? 'secondary' : 'primary'} label={t(key, vars)} busy={busy === choice} disabled={!!busy && busy !== choice}
      onPress={() => { void go(choice); }} style={[s.button, soft ? s.soft : null]} testID={`doc-${choice}`} />
  );
  const name = card.holder ?? '';
  let actions: ReactNode = null;
  switch (card.case) {
    case 'have_it': actions = [btn('use', 'doc.btn.use'), name ? btn('not_mine', 'doc.btn.notMine', true, { name }) : null]; break;
    case 'renewed': actions = [btn('replace', 'doc.btn.replace'), btn('keep_old', 'doc.btn.keepOld', true)]; break;
    case 'add': actions = [btn('add', 'doc.btn.add'), btn('discard', 'doc.btn.notNow', true)]; break;
    case 'consent': actions = [btn('keep', 'doc.btn.keep'), btn('booking_only', 'doc.btn.bookingOnly', true), btn('discard', 'doc.btn.notNow', true)]; break;
    case 'whose':
      actions = (
        <View style={s.chips} testID="doc-whose">
          {card.people.map((p) => <Chip key={p.id} label={p.name} background={colors.mist} onPress={() => { void go('person', p.id); }} testID="doc-person" />)}
          <Chip label={t('doc.btn.someoneNew')} icon={(c) => <Icon name="plus" size={16} color={c} />} background={colors.mist} onPress={() => { void go('new_person'); }} testID="doc-new-person" />
        </View>
      );
      break;
    case 'unreadable':
      actions = [
        <Button key="again" size="small" label={t('doc.btn.again')} onPress={() => { void go('discard').then(() => attachToChat('camera')); }} style={s.button} testID="doc-again" />,
        <Button key="type" size="small" variant="secondary" label={t('doc.btn.type')} style={[s.button, s.soft]} testID="doc-type"
          onPress={() => { usePassportScan.getState().start(null); usePassportScan.getState().set({ manual: true }); void go('discard'); router.push('/passport/confirm'); }} />,
      ];
      break;
  }
  const canKeepCopy = card.hasFile && card.kind === 'passport' && ['add', 'consent', 'renewed'].includes(card.case);
  return (
    <Animated.View entering={enter(0)} style={s.box} testID={`doc-card-${card.case}`} accessibilityLabel={t('doc.a11y.card', { label, state: done ? t(`doc.card.state.${card.case}` as CopyKey) : '' })}>
      <View style={[s.row, { alignItems: 'flex-start' }]}>
        <IconTile name={card.kind === 'visa' ? 'visa' : card.case === 'unreadable' ? 'scan' : 'doc'} />
        <View style={{ flex: 1, gap: 4 }}>
          <T v="h3" style={{ fontSize: 16, lineHeight: 22 }} accessibilityRole="header" testID="doc-label">{label}</T>
          {card.validTo ? <T v="small" color={colors.ink2}>{t('doc.card.valid', { date: fullDay(card.validTo, locale) })}</T> : null}
          {card.old ? <T v="small" color={colors.ink2} testID="doc-old">{t('doc.card.old', { ending: card.old.ending ?? '', date: card.old.validTo ? fullDay(card.old.validTo, locale) : '' })}</T> : null}
          {done ? <Pill label={t(`doc.card.state.${card.case}` as CopyKey)} variant={card.case === 'discarded' ? 'default' : 'ok'} style={{ marginTop: 2, alignSelf: 'flex-start' }} /> : null}
        </View>
      </View>
      {card.expiry && !done ? (
        <View style={s.line} testID="doc-expiry">
          <Icon name={card.expiry.state === 'ready' ? 'check' : 'calendar'} size={16} color={card.expiry.state === 'ready' ? colors.ok : colors.goldInk} />
          <T v="small" color={card.expiry.state === 'ready' ? colors.ink2 : colors.green} style={{ flex: 1 }}>
            {card.expiry.state === 'ready' ? t('doc.expiry.ok') : card.expiry.reason === 'expired' ? t('doc.expiry.expired') : t('doc.expiry.short', { until: fullDay(card.expiry.needUntil, locale) })}
          </T>
        </View>
      ) : null}
      {canKeepCopy ? <Toggle label={t('doc.btn.keepCopy')} on={keepCopy} onPress={() => setKeepCopy((v) => !v)} small testID="doc-keep-copy" /> : null}
      {actions ? <View style={card.case === 'whose' ? null : s.actions}>{actions}</View> : null}
      {!done ? (
        <View style={s.line}><Icon name="lock" size={14} color={colors.ink3} /><T v="tiny" color={colors.ink3} style={{ flex: 1 }}>{t('doc.card.private')}</T></View>
      ) : null}
    </Animated.View>
  );
}

/** "Ask Abdullah to share their passport": sent only on this tap (it tells them about the trip). */
export function ShareCard({ card, turnId }: { card: ChatShareCard; turnId: number }) {
  const [busy, setBusy] = useState(false);
  const status = card.status === 'draft' ? null : t(`share.status.${card.status}` as CopyKey, { name: card.name });
  return (
    <Animated.View entering={enter(0)} style={s.box} testID="doc-share-card">
      <View style={[s.row, { alignItems: 'flex-start' }]}>
        <IconTile name="user" />
        <View style={{ flex: 1, gap: 4 }}>
          <T v="h3" style={{ fontSize: 16, lineHeight: 22 }} accessibilityRole="header">{t('share.card.title', { name: card.name })}</T>
          {card.trip ? <T v="small" color={colors.ink2}>{card.trip}</T> : null}
        </View>
      </View>
      <T v="small" color={colors.ink2}>{status ?? t('share.card.line', { name: card.name })}</T>
      {card.status === 'draft' ? (
        <Button size="small" label={t('share.btn.send', { name: card.name })} busy={busy} onPress={async () => { setBusy(true); if (!(await sendShare(turnId, card.shareId))) setBusy(false); }} style={s.button} testID="doc-share-send" />
      ) : null}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: colors.paper, borderRadius: radii.card, padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actions: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { height: 44, alignSelf: 'stretch' },
  soft: { backgroundColor: colors.mist },
});
