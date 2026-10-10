import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { planById, type CircleMessage, type PersonRef, type SplitShare } from '@mada/shared';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Pill } from '@/components/Pill';
import { Sun } from '@/components/Sun';
import { T } from '@/components/Text';
import { COVERS, money, photoSource } from '@/lib/circles';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { colors, ff, font, textEnd } from '@/theme';
import { Face, Faces, Row, TextLink } from './ui';

/* The pieces of a circle's chat (prototype Circles.jsx Group): bubbles, votes, splits, shared plans and places. */

export type Who = { kind: 'me' } | { kind: 'person'; p: PersonRef } | { kind: 'mada' } | { kind: 'agent'; name: string };

/** One line in the chat. Mine on the end in green; Mada's on warm paper with the sun; a person's with their face. */
export function Bubble({ who, cont, wide, label, children, testID }: { who: Who; cont?: boolean; wide?: boolean; label?: string; children: ReactNode; testID?: string }) {
  const mine = who.kind === 'me';
  const name = who.kind === 'person' ? who.p.short : who.kind === 'mada' ? t('circles.mada') : who.kind === 'agent' ? t('actor.intro', { agent: who.name }) : '';
  const face = who.kind === 'mada' ? <View style={st.madaFace}><Sun width={18} color={colors.gold} /></View>
    : who.kind === 'agent' ? <Avatar initial={who.name} tone="green" size={32} /> : who.kind === 'person' ? <Face p={who.p} size={32} /> : null;
  return (
    <View style={[st.row, mine ? st.rowMine : null, cont ? { marginTop: -6 } : null, wide && mine ? { paddingStart: 40 } : null]} testID={testID}>
      {!mine ? <View style={st.face}>{cont ? null : face}</View> : null}
      <View style={[st.bubble, cont ? { borderRadius: 22 } : null, mine ? st.mine : null, who.kind === 'mada' ? st.mada : null, wide ? st.bare : null]}>
        {!cont && !mine && !wide ? <T style={st.name}>{name}</T> : null}
        {wide && label ? <T style={[st.name, mine ? { textAlign: textEnd() } : null]}>{label}</T> : null}
        {children}
      </View>
    </View>
  );
}
export const BubbleText = ({ children, mine }: { children: string; mine?: boolean }) => <T style={{ fontFamily: ff.ui400, fontSize: 15, lineHeight: 22, color: mine ? colors.mist : colors.green }}>{children}</T>;

export function SysLine({ text }: { text: string }) {
  return <View style={st.sys}><T style={{ fontSize: 12, lineHeight: 16, color: colors.ink3, textAlign: 'center', fontFamily: ff.ui400 }}>{text}</T></View>;
}

/** The vote glyph: three lines and a tick. */
export function VoteIcon({ color = colors.goldInk }: { color?: string }) {
  return <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round"><Path d="M4 6h10M4 12h16M4 18h7" /><Path d="M17 4.5l1.5 1.5 3-3" /></Svg>;
}

export function VoteCard({ m, me, total, canClose, people, onVote, onClose }: { m: CircleMessage; me: string; total: number; canClose: boolean; people: Map<string, PersonRef>; onVote: (o: string) => void; onClose: () => void }) {
  const v = m.vote!;
  const count = v.options.reduce((a, o) => a + o.votes.length, 0);
  const mine = v.options.find((o) => o.votes.includes(me));
  const winner = v.options.find((o) => o.id === v.winner);
  return (
    <View style={[st.card, v.closed ? null : null]} testID="vote-card">
      <T v="h3" style={{ fontSize: 16 }}>{v.q}</T>
      {v.options.map((o) => {
        const pct = count ? Math.round((o.votes.length / count) * 100) : 0;
        const won = v.closed && v.winner === o.id;
        const on = mine?.id === o.id;
        return (
          <Pressable key={o.id} accessibilityRole="button" accessibilityState={{ selected: on, disabled: v.closed }} accessibilityLabel={tn('circles.vote.opt', o.votes.length, { label: o.label })}
            disabled={v.closed} onPress={() => { buzz('select'); onVote(o.id); }} style={[st.opt, on ? st.optOn : null, won ? st.optWon : null, v.closed && !won ? { opacity: 0.7 } : null]} testID="vote-option">
            <View style={[st.fill, { width: `${pct}%`, backgroundColor: on || won ? '#ecd9b0' : '#ece3d4' }]} />
            <View style={st.optRow}>
              <Row gap={8} style={{ flexShrink: 1 }}>{won ? <Icon name="check" size={16} width={2.6} /> : null}<T style={{ fontFamily: ff.ui600, fontSize: 14, color: colors.green }} numberOfLines={1}>{o.label}</T></Row>
              <Row gap={8}>
                <Faces people={o.votes.slice(0, 3).map((id) => people.get(id) ?? { id, initial: '?', tone: 'default' as const })} size={20} overlap={7} ring={colors.paper} />
                <T style={{ fontFamily: ff.ui600, fontSize: 14, color: colors.green, minWidth: 14, textAlign: textEnd(), fontVariant: ['tabular-nums'] }}>{o.votes.length}</T>
              </Row>
            </View>
          </Pressable>
        );
      })}
      <View style={st.spread}>
        <T v="tiny" style={{ flex: 1 }}>{v.closed ? (winner ? t('circles.vote.closedWon', { label: winner.label }) : t('circles.vote.closedTie')) : `${t('circles.vote.count', { n: count, total })}${mine ? ` · ${t('circles.vote.youPicked', { label: mine.label })}` : ''}`}</T>
        {!v.closed && canClose ? <View style={{ opacity: count ? 1 : 0.4 }} pointerEvents={count ? 'auto' : 'none'}><TextLink size={13} label={t('circles.vote.close')} onPress={onClose} testID="vote-close" /></View> : null}
      </View>
    </View>
  );
}

export function SplitCard({ m, me, people, onPay, onRemind, onMark }: { m: CircleMessage; me: string; people: Map<string, PersonRef>; onPay: (sh: SplitShare) => void; onRemind: () => void; onMark: (sh: SplitShare) => void }) {
  const sp = m.split!;
  const iPaid = sp.paidBy === me;
  const short = (id: string) => (id === me ? t('circles.you') : people.get(id)?.short ?? t('circles.someone'));
  const label = (sh: SplitShare) => {
    if (sp.mode !== 'family' || sh.ids.length === 1) return short(sh.ids[0]!);
    return sh.ids.includes(me) ? t('circles.split.yourFamily') : t('circles.split.family', { name: short(sh.key) });
  };
  const owing = sp.shares.filter((sh) => !sh.paid && !sh.ids.includes(me));
  const mineSh = sp.shares.find((sh) => sh.ids.includes(me));
  const mode = sp.mode === 'family' ? t('circles.split.modeFamily') : sp.mode === 'custom' ? t('circles.split.modeCustom') : t('circles.split.modeEqual');
  return (
    <View style={[st.card, sp.settled ? { backgroundColor: '#f6faf6' } : null]} testID="split-card">
      <View style={[st.spread, { alignItems: 'flex-start' }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <T v="h3" style={{ fontSize: 16 }}>{sp.what}</T>
          <T v="tiny">{t('circles.split.paidBy', { who: iPaid ? t('circles.youLower') : short(sp.paidBy), mode })}</T>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <T style={{ fontFamily: ff.ui700, fontSize: 17, color: colors.green, fontVariant: ['tabular-nums'] }}>{money(sp.total)}</T>
          {sp.settled ? <Pill variant="ok" label={t('circles.split.settled')} /> : null}
        </View>
      </View>
      <View>
        {sp.shares.map((sh, i) => {
          const self = sh.ids.includes(me);
          return (
            <View key={sh.key} style={[st.share, i === sp.shares.length - 1 ? { borderBottomWidth: 0 } : null]}>
              <Faces people={sh.ids.slice(0, 2).map((id) => people.get(id) ?? { id, initial: '?', tone: 'default' as const })} size={26} overlap={9} ring={colors.paper} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T style={{ fontFamily: ff.ui600, fontSize: 14, color: colors.green }}>{label(sh)}</T>
                <T v="tiny">{sh.paid ? (sh.ids.includes(sp.paidBy) ? t('circles.split.paidBill') : t('circles.split.paid')) : self ? t('circles.split.yourShare') : t('circles.split.owes', { who: iPaid ? t('circles.youLower') : short(sp.paidBy) })}</T>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Row gap={6}>
                  <T style={[{ fontFamily: ff.ui600, fontSize: 14, color: colors.green, fontVariant: ['tabular-nums'] }, sh.paid ? { color: colors.ink3, textDecorationLine: 'line-through' } : null]}>{money(sh.amount)}</T>
                  {sh.paid ? <Icon name="check" size={16} color={colors.ok} width={2.6} /> : null}
                </Row>
                {!sh.paid && iPaid && !self ? <TextLink size={12} label={t('circles.split.markPaid')} onPress={() => onMark(sh)} /> : null}
              </View>
            </View>
          );
        })}
      </View>
      {!sp.settled && mineSh && !mineSh.paid ? (
        <Row wrap gap={10}>
          <Button size="small" block={false} label={t('circles.split.payMine', { amount: money(mineSh.amount) })} onPress={() => onPay(mineSh)} testID="pay-share" />
          <TextLink size={13} label={t('circles.split.cash')} onPress={() => onMark(mineSh)} testID="paid-cash" />
        </Row>
      ) : !sp.settled && iPaid && owing.length ? (
        <Button size="small" block={false} variant="secondary" style={{ alignSelf: 'flex-start', backgroundColor: colors.mist }} disabled={sp.reminded} onPress={onRemind} testID="split-remind"
          label={sp.reminded ? t('circles.split.reminded') : t('circles.split.remind', { names: owing.map((sh) => (sh.ids.length > 1 ? short(sh.key) : short(sh.ids[0]!))).join(` ${t('circles.and')} `) })} />
      ) : null}
      {sp.settled ? <T v="tiny">{t('circles.split.allPaid')}</T> : null}
    </View>
  );
}

export function ShareCard({ m, saved, pinned, canPin, onOpenPlan, onSave, onPlan, onPin }: { m: CircleMessage; saved: boolean; pinned: boolean; canPin: boolean; onOpenPlan: (id: string) => void; onSave: () => void; onPlan: () => void; onPin: () => void }) {
  const c = m.card!;
  if (c.kind === 'plan') {
    const pl = planById(c.id);
    if (!pl) return null;
    return (
      <View style={[st.card, { padding: 8, paddingBottom: 12 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={pl.title} onPress={() => onOpenPlan(pl.id)} style={st.sharePhoto}>
          <Image source={COVERS[pl.photoKey]} style={StyleSheet.absoluteFill} contentFit="cover" />
          <View style={[StyleSheet.absoluteFill, { top: '35%', backgroundColor: 'rgba(15,26,22,0.5)' }]} />
          <Pill variant="glass" label={t('circles.share.plan', { days: pl.days })} style={{ position: 'absolute', top: 10, start: 10 }} />
          <View style={{ padding: 12, gap: 2 }}>
            <T style={[font('display', colors.paper), { fontSize: 24, lineHeight: 26 }]} balance={false}>{pl.title}</T>
            <T v="tiny" color="rgba(255,253,249,0.9)">{pl.sub}</T>
          </View>
        </Pressable>
        <Row wrap gap={8} style={{ paddingHorizontal: 6 }}>
          <Button size="small" block={false} variant={saved ? 'gold' : 'secondary'} style={!saved ? { backgroundColor: colors.mist } : undefined} label={saved ? t('circles.saved') : t('circles.save')} onPress={onSave} />
          <Button size="small" block={false} label={t('circles.planIt')} onPress={() => onOpenPlan(pl.id)} />
          {!pinned && canPin ? <TextLink size={13} label={t('circles.share.pin')} onPress={onPin} /> : null}
        </Row>
      </View>
    );
  }
  const p = c.post;
  const src = photoSource(p);
  const whose = p.author ? t('circles.share.tipOf', { name: p.author.short }) : t('circles.share.yourTip');
  return (
    <View style={[st.card, { padding: 8, paddingBottom: 12 }]}>
      {src ? (
        <View style={[st.sharePhoto, { height: 112 }]}>
          <Image source={src} style={StyleSheet.absoluteFill} contentFit="cover" />
          <View style={[StyleSheet.absoluteFill, { top: '35%', backgroundColor: 'rgba(15,26,22,0.5)' }]} />
          <View style={{ padding: 12 }}><T v="h3" style={{ fontSize: 17 }} color={colors.paper}>{p.place}</T><T v="tiny" color="rgba(255,253,249,0.9)">{`${p.city} · ${whose}`}</T></View>
        </View>
      ) : <View style={{ paddingHorizontal: 6, gap: 2 }}><T v="h3" style={{ fontSize: 16 }}>{p.place}</T><T v="tiny">{`${p.city} · ${whose}`}</T></View>}
      <T v="small" color={colors.inkSoft} numberOfLines={2} style={{ paddingHorizontal: 6 }}>{p.text}</T>
      <Row wrap gap={8} style={{ paddingHorizontal: 6 }}>
        <Button size="small" block={false} variant={saved ? 'gold' : 'secondary'} style={!saved ? { backgroundColor: colors.mist } : undefined} label={saved ? t('circles.saved') : t('circles.save')} onPress={onSave} />
        <Button size="small" block={false} label={t('circles.planIt')} onPress={onPlan} />
      </Row>
    </View>
  );
}

/** "Mada is looking into it", while an answer is on its way. */
export function Typing({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingStart: 40 }}>
      <View style={st.dots}>{[0, 1, 2].map((i) => <View key={i} style={st.dot} />)}</View>
      <T style={{ fontSize: 12, color: colors.ink3, fontFamily: ff.ui400 }}>{text}</T>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowMine: { flexDirection: 'row-reverse' },
  face: { width: 32 },
  madaFace: { width: 32, height: 32, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  bubble: { gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 22, borderTopStartRadius: 6, backgroundColor: colors.paper, maxWidth: '80%' },
  mine: { backgroundColor: colors.green, borderTopStartRadius: 22, borderTopEndRadius: 6 },
  mada: { backgroundColor: '#fbf6ec', borderWidth: 1, borderColor: 'rgba(185,143,74,0.2)' },
  bare: { backgroundColor: 'transparent', padding: 0, paddingVertical: 0, paddingHorizontal: 0, maxWidth: '88%', width: '88%', borderWidth: 0 },
  name: { fontSize: 12, fontFamily: ff.ui600, color: colors.ink3, lineHeight: 16 },
  sys: { alignSelf: 'center', maxWidth: '86%', backgroundColor: 'rgba(255,253,249,0.55)', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12 },
  card: { backgroundColor: colors.paper, borderRadius: 22, padding: 14, gap: 10, boxShadow: '0px 14px 28px -26px rgba(15,26,22,0.7)' },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  opt: { height: 46, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.mist, overflow: 'hidden', justifyContent: 'center' },
  optOn: { borderWidth: 2, borderColor: colors.green },
  optWon: { borderWidth: 2, borderColor: colors.goldDeep },
  fill: { position: 'absolute', start: 0, top: 0, bottom: 0 },
  optRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingStart: 14, paddingEnd: 12 },
  share: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  sharePhoto: { height: 150, borderRadius: 16, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: colors.green },
  dots: { flexDirection: 'row', gap: 3, backgroundColor: colors.paper, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 9 },
  dot: { width: 5, height: 5, borderRadius: 99, backgroundColor: colors.ink3 },
});
