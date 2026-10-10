import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { router, usePathname, type Href } from 'expo-router';
import { t, tn } from '@/lib/i18n';
import { useReduceMotion } from '@/lib/motion';
import { useGates } from '@/lib/net/gates';
import { useStorageHealth } from '@/lib/net/kv';
import { useOutboxStore } from '@/lib/net/outbox';
import { useNet } from '@/lib/net/state';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { colors, ff } from '@/theme';
import { Icon } from '../Icon';
import { T } from '../Text';

/*
 * The app-wide layer for when things go wrong, around the whole navigator:
 *   - the offline bar (prototype copy: "You're offline. Everything for your trips is on this phone."), green, across the
 *     status bar. It never covers anything: every screen below gets a taller top inset, so TopBars, back buttons and
 *     banners sit just under it, exactly as the prototype moves its top bar down;
 *   - after maintenance was set aside, the same bar in gold: "Booking is paused for a few minutes.";
 *   - a quiet toast on reconnect ("Back online.", or what the outbox is now sending), when the server asks us to wait,
 *     when the phone is too full to keep trips offline, and once when a newer version is ready;
 *   - the update and maintenance screens when the server says so.
 */

const BAR = 38; // one line of 13-point text with its padding

export function NetChrome({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const still = useReduceMotion();
  const status = useSession((s) => s.status);
  const inApp = status === 'signedIn' || status === 'guest';
  const online = useNet((s) => s.online);
  const maintenance = useGates((s) => s.maintenance);
  const maintenanceSetAside = useGates((s) => s.maintenanceDismissed);
  const offline = inApp && online === false;
  const paused = inApp && !offline && !!maintenance && maintenanceSetAside;
  const show = offline || paused;
  const [barH, setBarH] = useState(BAR);

  useReconnectToast(inApp);
  useGateRoutes(inApp);
  useQuietToasts(inApp);

  // Screens keep using useSafeAreaInsets()/useTopInset(): while the bar shows, "the top" is the bar's bottom edge.
  const statusTop = Math.max(insets.top, Platform.OS === 'web' ? 44 : 20);
  const shifted = show ? { ...insets, top: statusTop + barH } : insets;

  return (
    <View style={{ flex: 1 }}>
      <SafeAreaInsetsContext.Provider value={shifted}>{children}</SafeAreaInsetsContext.Provider>
      {show ? (
        <Animated.View
          entering={still ? FadeIn.duration(150) : SlideInUp.duration(320)} exiting={still ? FadeOut.duration(150) : SlideOutUp.duration(260)}
          style={[styles.bar, { paddingTop: statusTop + 8, backgroundColor: offline ? colors.green : colors.goldWash }]}
          onLayout={(e) => setBarH(Math.max(BAR, Math.round(e.nativeEvent.layout.height - statusTop)))}
          accessibilityRole="alert" accessibilityLiveRegion="polite" testID={offline ? 'offline-banner' : 'maintenance-banner'}>
          {offline ? <StatusBar style="light" /> : null}
          <Icon name={offline ? 'wifiOff' : 'lock'} size={16} color={offline ? colors.mist : colors.goldInk} />
          <T v="small" style={[styles.text, { color: offline ? colors.mist : colors.green }]}>
            {offline ? t('common.offline.banner') : t('maintenance.banner')}
          </T>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** "Back online." when the connection returns, or what the outbox is sending now. */
function useReconnectToast(inApp: boolean) {
  const online = useNet((s) => s.online);
  const wasOffline = useRef(false);
  useEffect(() => {
    if (online === false) { wasOffline.current = true; return; }
    if (online && wasOffline.current) {
      wasOffline.current = false;
      if (!inApp) return;
      const queued = useOutboxStore.getState().items.filter((i) => i.state === 'queued').length;
      toast(queued ? tn('net.back.sending', queued) : t('net.back'));
    }
  }, [online, inApp]);
}

/** The update and maintenance screens, when the server says so. */
function useGateRoutes(inApp: boolean) {
  const update = useGates((s) => (s.updateSetAside ? null : s.update));
  const maintenance = useGates((s) => s.maintenance);
  const setAside = useGates((s) => s.maintenanceDismissed);
  const path = usePathname();
  useEffect(() => {
    if (update && path !== '/update') router.push('/update' as Href);
  }, [update, path]);
  useEffect(() => {
    if (inApp && maintenance && !setAside && !update && path !== '/maintenance') router.push('/maintenance' as Href);
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
  bar: { position: 'absolute', top: 0, start: 0, end: 0, zIndex: 80, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16, paddingBottom: 9 },
  text: { fontFamily: ff.ui500, textAlign: 'center', flexShrink: 1 },
});
