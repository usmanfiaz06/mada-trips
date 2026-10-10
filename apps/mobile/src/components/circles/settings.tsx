import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { CircleDetail, CircleMemberView } from '@mada/shared';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Pill } from '@/components/Pill';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { agoLabel, circlesApi, ck, useAct, useFriends, useMeId } from '@/lib/circles';
import { buzz } from '@/lib/haptics';
import { joinAnd, t, tn } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors } from '@/theme';
import { InviteSheet } from './sheets';
import { ChoiceCard, Face, Input, PersonRow, Row, SheetScroll, TextLink, Tick, Toggle } from './ui';

type Mode = 'main' | 'rename' | 'add' | 'invite' | 'member' | 'leave' | 'delete';

/** Circle settings (prototype GroupInfo): members, invited (remind, cancel), admin, rename, mute, leave, delete for everyone. */
export function CircleSettings({ visible, onClose, d, onGone }: { visible: boolean; onClose: () => void; d: CircleDetail; onGone: () => void }) {
  const router = useRouter();
  const me = useMeId();
  const [mode, setMode] = useState<Mode>('main');
  const [rename, setRename] = useState(d.circle.name);
  const [target, setTarget] = useState<CircleMemberView | null>(null);
  const [adding, setAdding] = useState<string[]>([]);
  const [reminded, setReminded] = useState<string[]>([]);
  const id = d.circle.id;
  const admin = d.circle.role === 'admin';
  const others = d.members.filter((m) => m.id !== me);
  const invited = d.invited;
  const adminP = d.members.find((m) => m.role === 'admin');
  const friends = useFriends().data?.friends ?? [];
  const addable = friends.filter((f) => !d.members.some((m) => m.id === f.id) && !invited.some((i) => i.person.id === f.id));
  const touched = () => [ck.circle(id), ck.messages(id), ck.list];
  const update = useAct((b: Parameters<typeof circlesApi.update>[1]) => circlesApi.update(id, b), touched);
  const invite = useAct((ids: string[]) => circlesApi.invite(id, ids), touched);
  const remind = useAct(circlesApi.remindInvite, touched);
  const cancel = useAct(circlesApi.cancelInvite, touched);
  const makeAdmin = useAct((uid: string) => circlesApi.makeAdmin(id, uid), touched);
  const remove = useAct((uid: string) => circlesApi.removeMember(id, uid), touched);
  const leave = useAct(() => circlesApi.leave(id), () => [ck.list]);
  const del = useAct(() => circlesApi.remove(id), () => [ck.list]);
  const sheetLabel = mode === 'rename' ? t('circles.settings.rename') : mode === 'add' ? t('circles.settings.addPeople') : t('circles.settings.label');

  if (mode === 'invite') return <InviteSheet visible={visible} onClose={() => setMode('main')} what={d.circle.name} load={() => circlesApi.circleLink(id)} />;

  return (
    <Sheet visible={visible} onClose={onClose} label={sheetLabel}>
      <SheetScroll>
        {mode === 'rename' ? (<>
          <T v="h2">{t('circles.rename.title')}</T>
          <Input maxLength={40} value={rename} onChangeText={setRename} accessibilityLabel={t('circles.rename.a11y')} testID="rename-input" />
          <T v="tiny">{t('circles.rename.note')}</T>
          <Button label={t('circles.save')} disabled={rename.trim().length < 2 || rename.trim() === d.circle.name} onPress={() => update.mutate({ name: rename.trim() }, { onSuccess: () => { setMode('main'); toast(t('circles.rename.done')); } })} testID="rename-save" />
        </>) : mode === 'add' ? (<>
          <T v="h2">{t('circles.add.title')}</T>
          <T v="small">{t('circles.newCircle.whoSub')}</T>
          {addable.length === 0 ? <T v="small">{t('circles.add.none')}</T> : null}
          {addable.map((f) => <PersonRow key={f.id} p={f} on={adding.includes(f.id)} onPress={() => setAdding(adding.includes(f.id) ? adding.filter((x) => x !== f.id) : [...adding, f.id])} right={<Tick on={adding.includes(f.id)} />} />)}
          <Button size="small" block={false} variant="secondary" style={{ alignSelf: 'flex-start', backgroundColor: colors.mist }} icon={<Icon name="link" size={18} />} label={t('circles.invite.label')} onPress={() => setMode('invite')} />
          <Button label={adding.length ? t('circles.add.go', { count: adding.length }) : t('circles.add.idle')} disabled={!adding.length} haptic="success" testID="add-go"
            onPress={() => { const names = addable.filter((f) => adding.includes(f.id)).map((f) => f.short); invite.mutate(adding, { onSuccess: () => { toast(t('circles.add.sent', { names: join(names) })); setAdding([]); setMode('main'); } }); }} />
        </>) : mode === 'member' && target ? (<>
          <Row gap={12}><Face p={target} size={48} /><View><T v="h2">{target.name}</T><T v="tiny">{target.role === 'admin' ? t('circles.settings.roleAdmin') : t('circles.member.member')}</T></View></Row>
          <ChoiceCard title={t('circles.member.profile')} onPress={() => { onClose(); router.push(`/friend/${target.id}`); }} />
          {admin ? <ChoiceCard title={t('circles.member.makeAdmin', { name: target.short })} sub={t('circles.member.makeAdminSub')} onPress={() => makeAdmin.mutate(target.id, { onSuccess: () => { setMode('main'); toast(t('circles.member.adminDone', { name: target.short })); } })} testID="make-admin" /> : null}
          {admin ? <ChoiceCard danger title={t('circles.member.remove')} sub={t('circles.member.removeSub')} onPress={() => remove.mutate(target.id, { onSuccess: () => { setMode('main'); toast(t('circles.member.removed', { name: target.short })); } })} testID="remove-member" /> : null}
          {!admin ? <T v="small">{t('circles.member.onlyAdmin', { name: adminP?.short ?? '' })}</T> : null}
        </>) : mode === 'leave' ? (<>
          <T v="h2">{others.length || invited.length ? t('circles.leave.title', { name: d.circle.name }) : t('circles.leave.deleteTitle', { name: d.circle.name })}</T>
          <T v="body">{others.length ? (admin ? t('circles.leave.bodyAdmin', { name: others[0]!.short }) : t('circles.leave.body')) : invited.length ? t('circles.leave.bodyInvited') : t('circles.leave.bodyAlone')}</T>
          <Button variant="secondary" color={colors.badInk} style={{ backgroundColor: colors.mist }} label={others.length || invited.length ? t('circles.leave.leave') : t('circles.leave.delete')} testID="leave-yes"
            onPress={() => leave.mutate(undefined, { onSuccess: (r) => { buzz('success'); toast(r.deleted ? t('circles.leave.deleted', { name: d.circle.name }) : t('circles.leave.left', { name: d.circle.name })); onGone(); } })} />
          <Button variant="ghost" label={t('circles.leave.stay')} onPress={() => setMode('main')} />
        </>) : mode === 'delete' ? (<>
          <T v="h2">{t('circles.deleteAll.title')}</T>
          <T v="body">{t('circles.deleteAll.body', { count: d.members.length })}</T>
          <Button variant="secondary" color={colors.badInk} style={{ backgroundColor: colors.mist }} label={t('circles.settings.deleteAll')} testID="delete-yes"
            onPress={() => del.mutate(undefined, { onSuccess: () => { toast(t('circles.leave.deleted', { name: d.circle.name })); onGone(); } })} />
          <Button variant="ghost" label={t('circles.keepIt')} onPress={() => setMode('main')} />
        </>) : (<>
          <View style={st.spread}>
            <T v="h2" style={{ flex: 1 }}>{d.circle.name}</T>
            {admin && !d.circle.dm ? <TextLink label={t('circles.settings.rename')} onPress={() => setMode('rename')} testID="rename" /> : null}
          </View>
          <T v="tiny">{[tn('circles.people', d.members.length), invited.length ? t('circles.chat.invited', { count: invited.length }) : null, d.circle.trip, admin ? t('circles.settings.adminYou') : t('circles.settings.admin', { name: adminP?.short ?? '' })].filter(Boolean).join(' · ')}</T>
          <View style={{ gap: 6 }}>
            {d.members.map((m) => (
              <PersonRow key={m.id} p={m} sub={m.role === 'admin' ? t('circles.settings.roleAdmin') : m.relation === 'family' ? t('circles.settings.roleFamily') : null}
                onPress={m.id === me ? undefined : () => { setTarget(m); setMode('member'); }} right={m.id === me ? null : <Icon name="chevron" />} />
            ))}
            {invited.map((iv) => {
              const done = !!iv.remindedAt || reminded.includes(iv.inviteId);
              return (
                <View key={iv.inviteId} style={st.invited} accessibilityLabel={t('circles.settings.invitedA11y', { name: iv.person.short })}>
                  <View style={{ opacity: 0.55 }}><Face p={iv.person} /></View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Row gap={8}><T v="h3" style={{ fontSize: 15, flexShrink: 1 }} numberOfLines={1}>{iv.person.name}</T><Pill label={t('circles.settings.invitedPill')} /></Row>
                    <T v="tiny">{`${t('circles.settings.sent', { ago: agoLabel(iv.sentAt) })} · ${done ? t('circles.settings.remindedTag') : t('circles.settings.noAnswer')}`}</T>
                    {admin ? (
                      <Row gap={6} style={{ marginTop: 4 }}>
                        <Button size="small" block={false} variant="secondary" style={st.mini} disabled={done} label={done ? t('circles.settings.reminded') : t('circles.settings.remind')}
                          onPress={() => { setReminded([...reminded, iv.inviteId]); remind.mutate(iv.inviteId, { onSuccess: () => toast(t('circles.invite.reminded', { name: iv.person.short })) }); }} />
                        <Button size="small" block={false} variant="ghost" color={colors.badInk} style={st.mini} label={t('circles.settings.cancelInvite')}
                          onPress={() => cancel.mutate(iv.inviteId, { onSuccess: () => toast(t('circles.invite.cancelled', { name: iv.person.short })) })} testID="cancel-invite" />
                      </Row>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
          {!d.circle.dm ? (
            <Row wrap gap={8}>
              {admin ? <Button size="small" block={false} variant="secondary" style={{ backgroundColor: colors.mist }} icon={<Icon name="plus" size={18} />} label={t('circles.settings.addPeople')} onPress={() => setMode('add')} testID="add-people" /> : null}
              <Button size="small" block={false} variant="secondary" style={{ backgroundColor: colors.mist }} icon={<Icon name="link" size={18} />} label={t('circles.invite.label')} onPress={() => setMode('invite')} testID="invite-link-btn" />
            </Row>
          ) : null}
          <View style={[st.spread, { paddingVertical: 6 }]}>
            <View style={{ flex: 1 }}><T v="h3" style={{ fontSize: 15 }}>{t('circles.settings.mute')}</T><T v="tiny">{t('circles.settings.muteSub')}</T></View>
            <Toggle value={d.circle.muted} label={t('circles.settings.muteA11y')} onChange={(v) => update.mutate({ muted: v }, { onSuccess: () => toast(v ? t('circles.settings.mutedToast') : t('circles.settings.unmutedToast')) })} />
          </View>
          {!d.circle.dm ? <Button variant="secondary" color={colors.badInk} style={{ backgroundColor: colors.mist }} label={others.length || invited.length ? t('circles.settings.leave') : t('circles.settings.delete')} onPress={() => setMode('leave')} testID="leave" /> : null}
          {admin && others.length > 0 && !d.circle.dm ? <Button variant="ghost" color={colors.badInk} label={t('circles.settings.deleteAll')} onPress={() => setMode('delete')} testID="delete-all" /> : null}
        </>)}
      </SheetScroll>
    </Sheet>
  );
}

const join = (n: string[]) => (n.length <= 1 ? n[0] ?? '' : joinAnd(n));

const st = StyleSheet.create({
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  invited: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 18, backgroundColor: colors.mist },
  mini: { height: 32, paddingHorizontal: 12 },
});
