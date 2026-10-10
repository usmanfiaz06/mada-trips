import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, SlideInUp } from 'react-native-reanimated';
import { router, usePathname, type Href } from 'expo-router';
import { t, tn } from '@/lib/i18n';
import { useReduceMotion } from '@/lib/motion';
import { useGates } from '@/lib/net/gates';
import { useStorageHealth } from '@/lib/net/kv';
import { flushOutbox, useOutboxStore } from '@/lib/net/outbox';
import { useNet } from '@/lib/net/state';
import { useSession } from '@/lib/session';
import { buzz } from '@/lib/haptics';
import { toast } from '@/lib/toast';
import { colors, ff } from '@/theme';
import { Icon } from '../Icon';
import { T } from '../Text';
import { OutboxSheet } from './OutboxSheet';

/*
 * The app-wide layer for when things go wrong, around the whole navigator (prototype ui.jsx NetPill):
 *   - a small pill under the status bar: "Offline · your trips are on this phone", "Offline · 2 waiting to send",
 *     "Can't reach Mada right now" (the phone is online, our server isn't answering), "Sending 2 things…",
 *     "1 didn't send · open the Outbox", "Weak connection · loading slowly", "Maintenance until 03:00 · booking paused".
 *     Tap it for the Outbox. It never covers anything: while it shows, every screen's top inset grows by its strip, so
 *     TopBars, back buttons and banners sit just under it;
 *   - a quiet toast on reconnect ("Back online. Sent 2 things you did offline."), when the server asks us to wait, when
 *     the phone is too full to keep trips offline, and once when a newer version is ready;
 *   - the update and maintenance screens when the server says so.
 */

const STRIP = 40; // the strip under the status bar that holds the pill

type PillMode = 'offline' | 'down' | 'held' | 'sending' | 'weak' | 'maint';

export function NetChrome({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const still = useReduceMotion();
  const status = useSession((s) => s.status);
  const inApp = status === 'signedIn' || status === 'guest';
  const online = useNet((s) => s.online);
  const weak = useNet((s) => s.weak);
  const osOffline = useNet((s) => s.deviceOffline);
  const items = useOutboxStore((s) => s.items);
  const maintenance = useGates((s) => s.maintenance);
  const maintenanceSetAside = useGates((s) => s.maintenanceDismissed);
  const [outboxOpen, setOutboxOpen] = useState(false);

  useReconnectToast(inApp);
  useGateRoutes(inApp);
  useQuietToasts(inApp);

  const waiting = items.filter((i) => i.state !== 'failed').length;
  const failed = items.filter((i) => i.state === 'failed').length;
  const sending = items.filter((i) => i.state === 'sending').length;
  let mode: PillMode | null = null;
  if (!inApp) mode = null;
  else if (online === false) mode = osOffline ? 'offline' : 'down';
  else if (maintenance && maintenanceSetAside) mode = 'maint';
  else if (sending) mode = 'sending';
  else if (failed) mode = 'held';
  else if (weak) mode = 'weak';

  const until = maintenance?.until ? new Date(maintenance.until) : null;
  const untilText = until && Number.isFinite(until.getTime()) ? `${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}` : null;
  const text = mode === 'offline' ? (waiting ? t('pill.offlineWaiting', { count: waiting }) : t('pill.offline'))
    : mode === 'down' ? (waiting ? t('pill.downWaiting', { count: waiting }) : t('pill.down'))
    : mode === 'held' ? t('pill.held', { count: failed })
    : mode === 'sending' ? tn('pill.sending', sending)
    : mode === 'weak' ? t('pill.weak')
    : mode === 'maint' ? (untilText ? t('maintenance.bannerUntil', { time: untilText }) : t('maintenance.banner'))
    : '';

  // Screens keep using useSafeAreaInsets()/useTopInset(): while the pill shows, "the top" is under its strip, so it
  // never sits over a back button, a title or a banner.
  const statusTop = Math.max(insets.top, Platform.OS === 'web' ? 44 : 20);
  const shifted = mode ? { ...insets, top: statusTop + STRIP } : insets;
  const tone = PILL[mode ?? 'offline'];

  return (
    <View style={{ flex: 1 }}>
      <SafeAreaInsetsContext.Provider value={shifted}>{children}</SafeAreaInsetsContext.Provider>
      {mode ? (
        <Animated.View entering={still ? FadeIn.duration(150) : SlideInUp.duration(380)} exiting={still ? FadeOut.duration(150) : FadeOut.duration(200)}
          style={[styles.strip, { top: statusTop }]} pointerEvents="box-none">
          <Pressable
            onPress={() => { buzz('tap'); if (mode === 'maint') { useGates.setState({ maintenanceDismissed: false }); } else if (mode !== 'weak') setOutboxOpen(true); }}
            accessibilityRole="button" accessibilityLiveRegion="polite" accessibilityLabel={t('pill.a11y', { text })}
            style={({ pressed }) => [styles.pill, { backgroundColor: tone.bg }, mode === 'weak' ? styles.pillWeak : null, pressed ? { transform: [{ scale: 0.97 }] } : null]}
            testID={mode === 'offline' ? 'offline-banner' : mode === 'maint' ? 'maintenance-banner' : `net-pill-${mode}`}>
            {mode === 'sending' ? <ActivityIndicator size="small" color={tone.fg} style={{ transform: [{ scale: 0.7 }] }} /> : <View style={[styles.dot, { backgroundColor: tone.dot }]} />}
            <T v="caption" numberOfLines={1} style={[styles.text, { color: tone.fg }]}>{text}</T>
            {mode !== 'weak' && mode !== 'sending' ? <Icon name="chevron" size={14} color={tone.fg} /> : null}
          </Pressable>
        </Animated.View>
      ) : null}
      <OutboxSheet visible={outboxOpen} onClose={() => setOutboxOpen(false)} />
    </View>
  );
}

const PILL: Record<PillMode, { bg: string; fg: string; dot: string }> = {
  offline: { bg: colors.green, fg: colors.mist, dot: colors.gold },
  held: { bg: colors.green, fg: colors.mist, dot: colors.gold },
  sending: { bg: colors.green, fg: colors.mist, dot: colors.gold },
  down: { bg: '#3a3324', fg: '#f6eedd', dot: colors.gold },
  weak: { bg: 'rgba(255,253,249,0.94)', fg: colors.green, dot: colors.goldDeep },
  maint: { bg: colors.goldWash, fg: colors.green, dot: colors.goldDeep },
};

/** When the connection returns: "Back online.", or once the outbox has gone, "Back online. Sent 2 things you did offline." */
function useReconnectToast(inApp: boolean) {
  const online = useNet((s) => s.online);
  const wasOffline = useRef(false);
  useEffect(() => {
    if (online === false) { wasOffline.current = true; return; }
    if (online && wasOffline.current) {
      wasOffline.current = false;
      if (!inApp) return;
      const queued = useOutboxStore.getState().items.some((i) => i.state === 'queued');
      if (!queued) { toast(t('net.back')); return; }
      void flushOutbox().then((sent) => toast(sent ? tn('net.back.sending', sent) : t('net.back')));
    }
  }, [online, inApp]);
}

/* The path updates a moment after a push: don't push the same screen twice meanwhile. */
let lastPush = { to: '', at: 0 };
function pushOnce(to: string) {
  if (lastPush.to === to && Date.now() - lastPush.at < 2000) return;
  lastPush = { to, at: Date.now() };
  router.push(to as Href);
}

/** The update and maintenance screens, when the server says so. */
function useGateRoutes(inApp: boolean) {
  const update = useGates((s) => (s.updateSetAside ? null : s.update));
  const maintenance = useGates((s) => s.maintenance);
  const setAside = useGates((s) => s.maintenanceDismissed);
  const path = usePathname();
  useEffect(() => {
    if (update && path !== '/update') pushOnce('/update');
  }, [update, path]);
  useEffect(() => {
    if (inApp && maintenance && !setAside && !update && path !== '/maintenance') pushOnce('/maintenance');
  }, [inApp, maintenance, setAside, update, path]);
}

function useQuietToasts(inApp: boolean) {
  const busyUntil = useGates((s) => s.busyUntil);
  const full = useStorageHealth((s) => s.full);
  const updateReady = useGates((s) => s.updateReady);
  const told = useRef({ update: false });
  useEffect(() => {
    if (!busyUntil) return;
    const seconds = Math.max(1, Math.round((busyUntil - Date.now()) / 1000));
    toast(t('busy.wait', { seconds }));
  }, [busyUntil]);
  useEffect(() => { if (full && inApp) toast(`${t('storage.full.title')} ${t('storage.full.body')}`); }, [full, inApp]);
  useEffect(() => {
    if (updateReady && inApp && !told.current.update) { told.current.update = true; toast(t('update.soft')); }
  }, [updateReady, inApp]);
}

const styles = StyleSheet.create({
  strip: { position: 'absolute', start: 0, end: 0, height: STRIP, zIndex: 80, alignItems: 'center', justifyContent: 'center' },
  pill: { height: 30, maxWidth: '86%', paddingStart: 10, paddingEnd: 10, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 7, boxShadow: '0px 10px 24px -14px rgba(15,26,22,0.8)' },
  pillWeak: { borderWidth: 1, borderColor: 'rgba(30,53,45,0.08)' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { fontFamily: ff.ui600, fontSize: 12.5, flexShrink: 1 },
});
