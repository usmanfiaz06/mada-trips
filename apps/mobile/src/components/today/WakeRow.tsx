import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import type { TripDetail } from '@mada/shared';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { Grow, Num, Row, Small, Tag, TextLink, Tiny } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { armWake, currentMethod, disarmWake, openClock, refreshNotice, useWake, useWakeStore, wakePlan, type ArmResult, type WakePlan } from '@/lib/wake';
import { stepWake, type WakeMethod } from '@/lib/wake-logic';
import { colors, ff, textEnd } from '@/theme';

const minsBefore = (time: string, leave: string) => { const [h1, m1] = time.split(':').map(Number); const [h2, m2] = leave.split(':').map(Number); return (((h2! * 60 + m2! - (h1! * 60 + m1!)) % 1440) + 1440) % 1440; };

/** The one line under the switch that says what this phone will really do. */
function whatHappens(method: WakeMethod, time: string, note: ArmResult['note'] | null, on: boolean): string {
  if (note === 'past') return t('td.wake.past');
  if (note === 'alarmDenied') return t('td.wake.alarmDenied', { time });
  if (note === 'notifyOff') return t('td.wake.notifyOff', { time });
  if (note === 'noClock') return t('td.wake.noClock', { time });
  if (method === 'android-clock') return on ? t('td.wake.android') : t('td.wake.androidOff');
  if (method === 'ios-alarmkit') return t('td.wake.alarmkit');
  if (method === 'ios-notify') return t('td.wake.notify', { time });
  return t('td.wake.web', { time });
}

/** The time sheet: five-minute steps, kept between 3 hours and 10 minutes before you leave. */
function WakeTimeSheet({ plan, open, onClose, onSave }: { plan: WakePlan; open: boolean; onClose: () => void; onSave: (time: string | null) => void }) {
  const [time, setTime] = useState(plan.time);
  useEffect(() => { if (open) setTime(plan.time); }, [open, plan.time]);
  const step = (d: number) => { buzz('select'); setTime((x) => stepWake(x, d, plan.leave)); };
  return (
    <Sheet visible={open} onClose={onClose} label={t('td.wake.sheetTitle')}>
      <T v="h2">{t('td.wake.sheetTitle')}</T>
      <Small style={{ marginTop: -8 }}>{plan.driver ? t('td.wake.sheetDriver', { driver: plan.driver, time: plan.leave }) : t('td.wake.sheetLeave', { airport: plan.airport, time: plan.leave })}</Small>
      <View style={styles.stepper}>
        <Pressable testID="wake-earlier" accessibilityRole="button" accessibilityLabel={t('td.wake.earlier')} onPress={() => step(-5)} style={styles.stepBtn}><T style={styles.stepText}>−5</T></Pressable>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Num size={40} style={{ letterSpacing: -1.2 }}>{time}</Num>
          <Tiny>{time === plan.suggested ? t('td.wake.suggested') : t('td.wake.before', { n: minsBefore(time, plan.leave) })}</Tiny>
        </View>
        <Pressable testID="wake-later" accessibilityRole="button" accessibilityLabel={t('td.wake.later')} onPress={() => step(5)} style={styles.stepBtn}><T style={styles.stepText}>+5</T></Pressable>
      </View>
      {time !== plan.suggested ? <TextLink testID="wake-suggested" label={`${t('td.wake.suggested')}: ${plan.suggested}`} onPress={() => setTime(plan.suggested)} /> : null}
      <Button testID="wake-save" label={time === plan.time ? t('td.wake.keep', { time }) : t('td.wake.save', { time })} disabled={time === plan.time}
        onPress={() => onSave(time === plan.suggested ? null : time)} />
    </Sheet>
  );
}

/** Each platform, plainly, with this phone's marked. */
function WakeHowSheet({ open, onClose, method }: { open: boolean; onClose: () => void; method: WakeMethod }) {
  const rows: { id: WakeMethod[]; title: string; body: string }[] = [
    { id: ['ios-alarmkit'], title: t('td.wake.howIos26'), body: t('td.wake.howIos26Body') },
    { id: ['ios-notify'], title: t('td.wake.howIos'), body: t('td.wake.howIosBody') },
    { id: ['android-clock'], title: t('td.wake.howAndroid'), body: t('td.wake.howAndroidBody') },
  ];
  return (
    <Sheet visible={open} onClose={onClose} label={t('td.wake.howTitle')}>
      <T v="h2">{t('td.wake.howTitle')}</T>
      <Small style={{ marginTop: -8 }}>{t('td.wake.howBody')}</Small>
      <View style={{ gap: 8 }} testID="wake-how">
        {rows.map((r) => {
          const mine = r.id.includes(method);
          return (
            <View key={r.title} style={[styles.how, mine ? styles.howMine : null]}>
              <Row gap={8}><T style={{ fontFamily: ff.ui600, fontSize: 15, color: colors.green, flexShrink: 1 }}>{r.title}</T>{mine ? <Tag tone="gold" label={t('td.wake.thisPhone')} /> : null}</Row>
              <Tiny>{r.body}</Tiny>
            </View>
          );
        })}
      </View>
      <Button variant="secondary" label={t('common.okay')} onPress={onClose} />
    </Sheet>
  );
}

/**
 * The plan's wake-up row (prototype Today.jsx DayBefore): the time, an on/off switch, "Change time", and what this
 * phone will really do. Off until turned on. Lives in the plan's timeline, so it renders the time column itself.
 */
export function WakeRow({ trip, rail }: { trip: TripDetail; rail: React.ReactNode }) {
  const st = useWake(trip.id);
  const denied = useWakeStore((s) => s.alarmKitDenied);
  const plan = wakePlan(trip, st.time);
  const [sheet, setSheet] = useState<null | 'time' | 'how'>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<ArmResult['note'] | null>(null);
  const [clockHint, setClockHint] = useState(false);
  const method = st.armed?.method ?? currentMethod(denied);
  const refreshed = useRef(false);

  // The evening before: rewrite the notification with tonight's forecast. A moved pickup moves a suggested alarm
  // (Android's Clock alarm can't be moved for you: the row offers "Update Clock").
  useEffect(() => {
    if (!plan || !st.on || !st.armed) return;
    if (st.armed.time !== plan.time) { if (st.armed.method !== 'android-clock') void armWake(trip.id, plan); return; }
    if (!refreshed.current) { refreshed.current = true; void refreshNotice(trip.id, plan); }
  }, [plan?.time, st.on, st.armed?.time]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!plan) return null;

  const turn = async (on: boolean, p: WakePlan = plan) => {
    setBusy(true);
    buzz(on ? 'success' : 'select');
    try {
      if (on) {
        const r = await armWake(trip.id, p);
        setNote(r.note);
        if (!r.note) toast(t('td.wake.onToast', { time: p.time }));
      } else {
        const r = await disarmWake(trip.id, trip.city);
        setNote(null);
        toast(r.method === 'android-clock' ? t('td.wake.androidOffToast', { time: p.time }) : t('td.wake.offToast'));
      }
    } finally { setBusy(false); }
  };
  const saveTime = async (time: string | null) => {
    setSheet(null);
    const old = st.armed;
    useWakeStore.getState().patch(trip.id, { time });
    const next = wakePlan(trip, time)!;
    if (!st.on) { await turn(true, next); return; }
    const r = await armWake(trip.id, next);
    setNote(r.note);
    if (r.note) return;
    toast(old?.method === 'android-clock' && old.time !== next.time ? t('td.wake.androidOld', { old: old.time }) : t('td.wake.onToast', { time: next.time }));
  };
  const clock = async () => { if (!(await openClock())) setClockHint(true); };
  const stale = st.on && st.armed?.method === 'android-clock' && st.armed.time !== plan.time;
  const line = whatHappens(method, plan.time, note, st.on);

  return (
    <>
      <View style={styles.tl} testID="wake-row">
        <Num size={14} color={st.on ? colors.green : colors.ink3} style={{ width: 54, textAlign: textEnd(), paddingTop: 1, textDecorationLine: st.on ? 'none' : 'line-through' }}>{plan.time}</Num>
        {rail}
        <Grow gap={1} style={{ paddingBottom: 16 }}>
          <Row gap={10} align="flex-start">
            <Grow gap={1}>
              <T style={{ fontSize: 15, lineHeight: 20, fontFamily: ff.ui600, color: st.on ? colors.green : colors.ink2 }}>{st.on ? t('td.plan.wake') : t('td.plan.wakeOff')}</T>
              <Tiny>{st.on ? t('td.plan.wakeSub', { time: plan.time }) : t('td.plan.wakeOffSub', { time: plan.time })}</Tiny>
            </Grow>
            <Switch testID="wake-switch" accessibilityLabel={t('td.wake.switch', { time: plan.time })} value={st.on} disabled={busy}
              onValueChange={(v) => { void turn(v); }} trackColor={{ false: '#d6cec2', true: colors.gold }} thumbColor={colors.paper}
              {...({ activeThumbColor: colors.paper } as object)} />
          </Row>
          <Tiny color={note ? colors.badInk : colors.inkSoft} style={{ marginTop: 4 }}>{stale ? t('td.wake.stale', { old: st.armed!.time, time: plan.time }) : line}</Tiny>
          {clockHint ? <Tiny color={colors.inkSoft}>{t('td.wake.clockSteps', { time: plan.time })}</Tiny> : null}
          <Row gap={16} style={{ flexWrap: 'wrap' }}>
            <TextLink testID="wake-change" label={t('td.wake.change')} onPress={() => setSheet('time')} />
            {stale ? <TextLink testID="wake-update" label={t('td.wake.update')} onPress={() => { void armWake(trip.id, plan); }} /> : null}
            {st.on && (method === 'ios-notify' || note === 'notifyOff' || note === 'noClock') ? <TextLink testID="wake-clock" label={t('td.wake.openClock')} onPress={() => { void clock(); }} /> : null}
            <TextLink testID="wake-how-link" label={t('td.wake.how')} onPress={() => setSheet('how')} />
          </Row>
        </Grow>
      </View>
      <WakeTimeSheet plan={plan} open={sheet === 'time'} onClose={() => setSheet(null)} onSave={(x) => { void saveTime(x); }} />
      <WakeHowSheet open={sheet === 'how'} onClose={() => setSheet(null)} method={method} />
    </>
  );
}

const styles = StyleSheet.create({
  tl: { flexDirection: 'row', gap: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 10, borderRadius: 22, backgroundColor: colors.mist },
  stepText: { fontFamily: ff.ui600, fontSize: 17, color: colors.green },
  stepBtn: { width: 52, height: 52, borderRadius: 99, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  how: { borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: colors.mist, gap: 4 },
  howMine: { backgroundColor: '#f3ead8', borderWidth: 1.5, borderColor: colors.goldDeep },
});
