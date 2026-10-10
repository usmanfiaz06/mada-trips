import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import {
  PLACES, PLAN_SUMMARIES, addDays, dayOfMonth, monthOf, splitAmounts, todayIn, weekdayOf,
  type CircleMemberView, type CreateSplitRequest, type CreateVoteRequest, type SharedCard, type SplitMode,
} from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { Sun } from '@/components/Sun';
import { T } from '@/components/Text';
import { COVERS, money, photoSource, useSaved } from '@/lib/circles';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { colors, ff } from '@/theme';
import { VoteIcon } from './chat';
import { Faces, GhostChip, Input, Row, Segmented, SheetScroll, TextLink } from './ui';

/* The circle's tools (prototype Circles.jsx): start a vote, split a cost, share a plan or place, ask Mada. */

export type Tool = 'vote' | 'split' | 'share' | 'ask';

export function ToolsSheet({ visible, onClose, canSplit, dest, onPick }: { visible: boolean; onClose: () => void; canSplit: boolean; dest: string | null; onPick: (t: Tool) => void }) {
  const items: [Tool, ReactNode, string, string][] = [
    ['vote', <VoteIcon key="v" color={colors.green} />, t('circles.chat.startVote'), t('circles.tools.voteSub')],
    ['split', <Icon key="s" name="card" size={20} />, t('circles.chat.split'), canSplit ? t('circles.tools.splitSub') : t('circles.tools.splitSubAlone')],
    ['share', <Icon key="p" name="pin" size={20} />, t('circles.tools.share'), t('circles.tools.shareSub')],
    ['ask', <Sun key="a" width={24} color={colors.goldDeep} />, t('action.ask'), dest ? t('circles.tools.askSub', { dest }) : t('circles.tools.askSubAny')],
  ];
  return (
    <Sheet visible={visible} onClose={onClose} label={t('circles.tools.title')}>
      <T v="h2">{t('circles.tools.title')}</T>
      {items.map(([id, ic, title, sub]) => {
        const off = id === 'split' && !canSplit;
        return (
          <Pressable key={id} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: off }} disabled={off} onPress={() => { buzz('tap'); onPick(id); }} style={[st.tool, off ? { opacity: 0.5 } : null]} testID={`tool-${id}`}>
            <View style={st.toolIc}>{ic}</View>
            <View style={{ flex: 1 }}><T v="h3" style={{ fontSize: 15 }}>{title}</T><T v="tiny">{sub}</T></View>
            <Icon name="chevron" size={18} />
          </Pressable>
        );
      })}
    </Sheet>
  );
}

const nextDays = () => {
  const today = todayIn();
  return [1, 2, 3, 4].map((n) => { const d = addDays(today, n); return `${weekdayOf(d)} ${dayOfMonth(d)} ${monthOf(d)}`; });
};

export function VoteSheet({ visible, onClose, dest, busy, onPost }: { visible: boolean; onClose: () => void; dest: string | null; busy: boolean; onPost: (v: CreateVoteRequest) => void }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'dates' | 'places' | 'any'>('dates');
  const [opts, setOpts] = useState(['', '']);
  const [tried, setTried] = useState(false);
  const ideas = kind === 'dates' ? nextDays() : kind === 'places' ? (dest && PLACES[dest]?.spots) || ['Georgia', 'Baku', 'AlUla', 'Istanbul'] : [t('circles.voteSheet.yes'), t('circles.voteSheet.no'), t('circles.voteSheet.maybe')];
  const clean = opts.map((o) => o.trim()).filter(Boolean);
  const dup = new Set(clean.map((o) => o.toLowerCase())).size !== clean.length;
  const ok = q.trim().length >= 3 && clean.length >= 2 && !dup;
  const fill = (v: string) => {
    if (opts.some((o) => o.trim().toLowerCase() === v.toLowerCase())) return;
    const i = opts.findIndex((o) => !o.trim());
    if (i >= 0) setOpts(opts.map((o, j) => (j === i ? v : o)));
    else if (opts.length < 4) setOpts([...opts, v]);
  };
  return (
    <Sheet visible={visible} onClose={onClose} label={t('circles.chat.startVote')}>
      <SheetScroll>
        <T v="h2">{t('circles.chat.startVote')}</T>
        <Field label={t('circles.voteSheet.q')} value={q} onChangeText={setQ} maxLength={60} placeholder={kind === 'places' ? t('circles.voteSheet.qPlaces') : kind === 'dates' ? t('circles.voteSheet.qDates') : t('circles.voteSheet.qAny')} testID="vote-q" />
        <Row wrap gap={8}>{(['dates', 'places', 'any'] as const).map((k) => <Chip key={k} label={t(`circles.voteSheet.${k}`)} on={kind === k} onPress={() => setKind(k)} />)}</Row>
        <View style={{ gap: 8 }}>
          {opts.map((o, i) => (
            <Row key={i} gap={8}>
              <Input style={{ flex: 1 }} accessibilityLabel={t('circles.voteSheet.choice', { n: i + 1 })} maxLength={30} value={o} placeholder={t('circles.voteSheet.choice', { n: i + 1 })} onChangeText={(v) => setOpts(opts.map((x, j) => (j === i ? v : x)))} testID={`vote-o${i + 1}`} />
              {opts.length > 2 ? <Pressable accessibilityRole="button" accessibilityLabel={t('circles.voteSheet.removeChoice', { n: i + 1 })} onPress={() => setOpts(opts.filter((_, j) => j !== i))} style={st.remove}><Icon name="close" size={18} /></Pressable> : null}
            </Row>
          ))}
          {opts.length < 4 ? <TextLink label={t('circles.voteSheet.add')} onPress={() => setOpts([...opts, ''])} /> : null}
        </View>
        <Row wrap gap={8}>{ideas.map((v) => <GhostChip key={v} label={v} onPress={() => fill(v)} />)}</Row>
        {tried && !ok ? <T v="small" color={colors.badInk} accessibilityRole="alert">{q.trim().length < 3 ? t('circles.voteSheet.needQ') : dup ? t('circles.voteSheet.dup') : t('circles.voteSheet.need2')}</T> : null}
        <View style={{ opacity: ok ? 1 : 0.45 }}>
          <Button label={t('circles.voteSheet.post')} busy={busy} onPress={() => { if (!ok) { setTried(true); return; } onPost({ q: q.trim(), kind, options: clean }); }} haptic={ok ? 'success' : 'tap'} testID="vote-post" />
        </View>
      </SheetScroll>
    </Sheet>
  );
}

export function SplitSheet({ visible, onClose, me, members, busy, onPost }: { visible: boolean; onClose: () => void; me: string; members: CircleMemberView[]; busy: boolean; onPost: (s: CreateSplitRequest) => void }) {
  const [what, setWhat] = useState('');
  const [total, setTotal] = useState('');
  const [payer, setPayer] = useState(me);
  const [mode, setMode] = useState<SplitMode>('equal');
  const [who, setWho] = useState<string[]>(members.map((m) => m.id));
  const [custom, setCustom] = useState<Record<string, string>>({});
  const sum = (Number(total) || 0) * 100;
  const paidBy = who.includes(payer) ? payer : who[0] ?? me;
  const short = (id: string) => (id === me ? t('circles.you') : members.find((m) => m.id === id)?.short ?? '');
  const units = useMemo(() => {
    if (mode !== 'family') return who.map((id) => ({ key: id, ids: [id] }));
    const by = new Map<string, string[]>();
    for (const id of who) { const k = members.find((m) => m.id === id)?.family ?? id; by.set(k, [...(by.get(k) ?? []), id]); }
    return [...by.entries()].map(([key, ids]) => ({ key, ids }));
  }, [mode, who, members]);
  const unitLabel = (u: { key: string; ids: string[] }) => (u.ids.length === 1 ? short(u.ids[0]!) : u.ids.includes(me) ? t('circles.split.yourFamily') : t('circles.split.family', { name: short(u.key) }));
  const amounts = mode === 'custom' ? units.map((u) => (Number(custom[u.key]) || 0) * 100) : splitAmounts(sum, units.length || 1);
  const diff = sum - amounts.reduce((a, b) => a + b, 0);
  const ok = what.trim().length >= 2 && sum > 0 && who.length >= 2 && (mode !== 'custom' || diff === 0);
  const face = (id: string) => members.find((m) => m.id === id) ?? { id, initial: '?', tone: 'default' as const };
  return (
    <Sheet visible={visible} onClose={onClose} label={t('circles.chat.split')}>
      <SheetScroll>
        <T v="h2">{t('circles.chat.split')}</T>
        <Field label={t('circles.splitSheet.what')} value={what} onChangeText={setWhat} maxLength={40} placeholder={t('circles.splitSheet.whatHint')} testID="split-what"
          hint={<Row wrap gap={8}>{(['dinner', 'hotel', 'van', 'tickets'] as const).map((k) => <GhostChip key={k} label={t(`circles.splitSheet.${k}`)} onPress={() => setWhat(t(`circles.splitSheet.${k}`))} />)}</Row>} />
        <Field label={t('circles.splitSheet.total')} prefix="SAR" value={total} onChangeText={(v) => setTotal(v.replace(/[^\d]/g, '').slice(0, 7))} keyboardType="number-pad" placeholder={t('circles.splitSheet.totalHint')} testID="split-total" />
        <View style={{ gap: 8 }}>
          <T v="eyebrow">{t('circles.splitSheet.paidBy')}</T>
          <Row wrap gap={8}>{who.map((id) => <Chip key={id} label={short(id)} on={paidBy === id} onPress={() => setPayer(id)} />)}</Row>
        </View>
        <View style={{ gap: 8 }}>
          <T v="eyebrow">{t('circles.splitSheet.between')}</T>
          <Row wrap gap={8}>{members.map((m) => <Chip key={m.id} label={short(m.id)} on={who.includes(m.id)} onPress={() => setWho(who.includes(m.id) ? who.filter((x) => x !== m.id) : members.map((x) => x.id).filter((x) => x === m.id || who.includes(x)))} />)}</Row>
        </View>
        <Segmented label={t('circles.splitSheet.how')} value={mode} onChange={setMode} options={[['equal', t('circles.splitSheet.equally')], ['family', t('circles.splitSheet.byFamily')], ['custom', t('circles.splitSheet.custom')]]} />
        <View style={st.well}>
          {units.map((u, i) => (
            <View key={u.key} style={[st.share, i === units.length - 1 ? { borderBottomWidth: 0 } : null]}>
              <Faces people={u.ids.slice(0, 3).map(face)} size={26} overlap={9} ring={colors.mist} />
              <T style={{ flex: 1, fontFamily: ff.ui600, fontSize: 14, color: colors.green }} numberOfLines={1}>{unitLabel(u)}</T>
              {mode === 'custom'
                ? <Input style={st.amtIn} keyboardType="number-pad" accessibilityLabel={u.ids.includes(me) ? t('circles.split.yourShare') : t('circles.splitSheet.shareA11y', { name: unitLabel(u) })} value={custom[u.key] ?? ''} placeholder="0" onChangeText={(v) => setCustom({ ...custom, [u.key]: v.replace(/[^\d]/g, '').slice(0, 7) })} />
                : <T style={{ fontFamily: ff.ui600, fontSize: 14, color: colors.green, fontVariant: ['tabular-nums'] }}>{money(amounts[i] ?? 0)}</T>}
            </View>
          ))}
        </View>
        {mode === 'custom' && sum > 0 ? (diff === 0
          ? <T v="tiny" style={{ fontFamily: ff.ui600 }} color={colors.ok}>{t('circles.splitSheet.addsUp', { amount: money(sum) })}</T>
          : <T v="small" color={colors.badInk} accessibilityRole="alert">{diff > 0 ? t('circles.splitSheet.left', { amount: money(diff) }) : t('circles.splitSheet.over', { amount: money(-diff) })}</T>) : null}
        {who.length < 2 ? <T v="tiny">{t('circles.splitSheet.pick2')}</T> : null}
        <Button label={ok ? t('circles.splitSheet.go', { amount: money(sum) }) : t('circles.splitSheet.idle')} disabled={!ok} busy={busy} haptic="success" testID="split-post"
          onPress={() => onPost({ what: what.trim(), total: sum, paidBy, mode, between: who, custom: mode === 'custom' ? Object.fromEntries(units.map((u, i) => [u.key, amounts[i]!])) : undefined })} />
      </SheetScroll>
    </Sheet>
  );
}

export function ShareSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (card: SharedCard, pin: boolean) => void }) {
  const [pin, setPin] = useState(false);
  const saved = (useSaved().data?.saved ?? []).filter((s) => s.kind === 'post' && s.post);
  return (
    <Sheet visible={visible} onClose={onClose} label={t('circles.tools.share')}>
      <SheetScroll>
        <T v="h2">{t('circles.tools.share')}</T>
        <T v="eyebrow">{t('circles.shareSheet.plans')}</T>
        {PLAN_SUMMARIES.map((pl) => (
          <Pressable key={pl.id} accessibilityRole="button" accessibilityLabel={pl.title} onPress={() => { buzz('tap'); onPick({ kind: 'plan', id: pl.id }, pin); }} style={st.cityRow} testID={`share-${pl.id}`}>
            <Image source={COVERS[pl.photoKey]} style={st.thumb} contentFit="cover" />
            <View style={{ flex: 1 }}><T v="h3" style={{ fontSize: 15 }}>{pl.title}</T><T v="tiny">{t('circles.shareSheet.planSub', { days: pl.days, city: pl.city })}</T></View>
            <Icon name="up" size={18} />
          </Pressable>
        ))}
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: pin }} onPress={() => { buzz('select'); setPin(!pin); }} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <View style={[st.box, pin ? st.boxOn : null]}>{pin ? <Icon name="check" size={14} color={colors.mist} width={2.6} /> : null}</View>
          <T v="small">{t('circles.shareSheet.pin')}</T>
        </Pressable>
        <T v="eyebrow">{t('circles.shareSheet.saves')}</T>
        {saved.length === 0 ? <T v="small">{t('circles.shareSheet.none')}</T> : saved.map((s) => {
          const p = s.post!;
          const src = photoSource(p);
          return (
            <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={p.place} onPress={() => { buzz('tap'); onPick({ kind: 'place', post: p }, false); }} style={st.cityRow}>
              {src ? <Image source={src} style={st.thumb} contentFit="cover" /> : <View style={[st.thumb, { backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' }]}><T v="h3">{p.author?.initial ?? '?'}</T></View>}
              <View style={{ flex: 1, minWidth: 0 }}><T v="h3" style={{ fontSize: 15 }} numberOfLines={1}>{p.place}</T><T v="tiny">{t('circles.shareSheet.from', { city: p.city, name: p.author?.short ?? t('circles.you') })}</T></View>
              <Icon name="up" size={18} />
            </Pressable>
          );
        })}
      </SheetScroll>
    </Sheet>
  );
}

const st = StyleSheet.create({
  tool: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: colors.mist },
  toolIc: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  remove: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
  well: { backgroundColor: colors.mist, borderRadius: 18, paddingVertical: 6, paddingHorizontal: 12 },
  share: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  amtIn: { width: 96, height: 40, borderRadius: 12, textAlign: 'right', fontSize: 15, paddingHorizontal: 10 },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingStart: 8, paddingEnd: 12, borderRadius: 18, backgroundColor: colors.mist },
  thumb: { width: 48, height: 48, borderRadius: 12 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#c9c1b4', alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.green, borderColor: colors.green },
});
