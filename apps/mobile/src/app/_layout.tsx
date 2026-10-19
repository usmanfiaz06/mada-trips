import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import Constants from 'expo-constants';
import { loadAsync as loadFonts, useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureRoot } from '@/components/GestureRoot';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary as AppErrorBoundary } from '@/components/states/ErrorBoundary';
import { CrashState } from '@/components/states/ErrorState';
import { NetChrome, preloadNetChrome } from '@/components/states/NetChrome';
import { later } from '@/components/Later';
import { preloadSheet } from '@/components/Sheet';
import { AppLockRoot } from '@/components/auth/AppLockRoot';
import { useGates } from '@/lib/net/gates';
import { registerShell, useShellUpdate } from '@/lib/net/shell';
import { slowLink } from '@/lib/net/slow-link';
import { useSignInAsk } from '@/lib/signin-ask';
import { useToast } from '@/lib/toast';
import { useOutboxPump } from '@/lib/net/outbox';
import { restoreCache, startPersistence } from '@/lib/net/persist';
import { useRemoteConfig } from '@/lib/net/remote';
import { initReporting } from '@/lib/net/report';
import { startNet } from '@/lib/net/state';
import { queryClient } from '@/lib/queries';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { colors } from '@/theme';
import { fontsFor } from '@/theme/fonts';
import { appLocale, bootLocale, getLocale, isRTL } from '@/lib/i18n';
import { setUpNotificationChannels } from '@/lib/notification-channels';

SplashScreen.preventAutoHideAsync().catch(() => {});
// When things go wrong (FLOWS.md §12): crash reports (Sentry, only with a DSN), the connection, the offline copy.
initReporting(Constants.expoConfig?.version);
startNet();
startPersistence();
// The web build: a reload with no signal opens the app and the trips saved on this device (public/sw.js).
registerShell();

/*
 * What sits over every screen, each in its own file until it first has something to show (components/Later.tsx):
 * none of it is needed to draw the first screen.
 */
const SessionExpired = later(() => import('@/components/states/SessionExpired').then((m) => m.SessionExpired));
const SignInSheet = later(() => import('@/components/auth/SignInSheet').then((m) => m.SignInSheet));
const UpdateBar = later(() => import('@/components/states/UpdateBar').then((m) => m.UpdateBar));
const ToastHost = later(() => import('@/components/Toast').then((m) => m.ToastHost));

/** expo-router's boundary for the layout itself: the same calm crash screen. */
export function ErrorBoundary({ retry }: { error: Error; retry: () => Promise<void> }) {
  return <View style={{ flex: 1, backgroundColor: colors.sand }}><CrashState onRestart={() => { void retry(); }} /></View>;
}

export default function RootLayout() {
  // Arabic loads IBM Plex Sans Arabic and Reem Kufi under the same family names (theme/fonts.ts).
  // On a slow or metered connection (web) the typefaces come after the first screen's own files (below).
  const [laterFonts] = useState(() => Platform.OS === 'web' && slowLink());
  const [fontsLoaded, fontError] = useFonts(laterFonts ? {} : fontsFor(getLocale()));
  // The web doesn't hold the first screen for the typefaces once everything else is ready: on a slow connection they
  // are the last ~190 KB, and the browser swaps them in as they land (docs/app/PERF.md). A fast one has them by then.
  const [fontWait, setFontWait] = useState(Platform.OS === 'web');
  // The language for this launch is confirmed before the first screen (a mismatch restarts once, behind the splash).
  const [localeReady, setLocaleReady] = useState(false);
  useEffect(() => { void bootLocale().then((ok) => { if (ok) setLocaleReady(true); }).catch(() => setLocaleReady(true)); }, []);
  const status = useSession((s) => s.status);
  const boot = useSession((s) => s.boot);
  const expired = useGates((s) => s.expired);
  const askingSignIn = useSignInAsk((s) => !!s.reason);
  const updateReady = useShellUpdate((s) => s.ready);
  const toastShown = useToast((s) => !!s.text);
  useEffect(() => { boot(); }, [boot]);

  // The offline copy goes back into the cache before the first screen draws (at most 400 ms).
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (status === 'loading') return;
    const cap = setTimeout(() => setRestored(true), 400);
    void restoreCache().finally(() => { clearTimeout(cap); setRestored(true); });
    return () => clearTimeout(cap);
  }, [status]);
  useRemoteConfig();
  useOutboxPump();
  // The server writes notifications, texts and emails in the language saved on the account: keep it this launch's.
  const savedLocale = useSession((s) => s.user?.locale);
  useEffect(() => {
    if (status === 'signedIn' && savedLocale && savedLocale !== appLocale()) void api.updateMe({ locale: appLocale() }).catch(() => {});
  }, [status, savedLocale]);

  const rest = status !== 'loading' && restored && localeReady;
  useEffect(() => {
    if (!rest || !fontWait) return;
    const cap = setTimeout(() => setFontWait(false), 600);
    return () => clearTimeout(cap);
  }, [rest, fontWait]);
  const ready = (fontsLoaded || !!fontError || (Platform.OS === 'web' && !fontWait)) && rest;
  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync().catch(() => {});
    // The web's first paint (public/index.html) gives way to the app.
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.getElementById('mada-boot')?.remove();
  }, [ready]);
  // Android: the channels pushes land in, named in the app's language (lib/notification-channels.ts).
  useEffect(() => { if (localeReady) void setUpNotificationChannels(); }, [localeReady]);
  // Today's file starts down as soon as the entry runs, alongside the rest of the start-up, not after it: it is where a
  // signed-in (or looking-around) open lands, and Welcome's first button ("Look around") goes there too.
  const inApp = status === 'signedIn' || status === 'guest';
  const [firstScreen] = useState<Promise<unknown> | null>(() => (Platform.OS === 'web' ? import('./(tabs)/today').catch(() => {}) : null));
  useEffect(() => {
    if (!laterFonts || !ready || !firstScreen) return;
    let gone = false;
    void firstScreen.then(() => { if (!gone) void loadFonts(fontsFor(getLocale())).catch(() => {}); });
    return () => { gone = true; };
  }, [laterFonts, ready, firstScreen]);
  // In the app, once the first screen is up, the offline pill's, the Outbox's, the toast's and the sheets' files come down quietly
  // (on a slow connection well after what the screen itself is fetching), so they're on the device when it drops.
  useEffect(() => {
    if (!ready || !inApp) return;
    const warm = setTimeout(() => { void preloadNetChrome(); void ToastHost.preload(); void preloadSheet(); }, slowLink() ? 20000 : 4000);
    return () => clearTimeout(warm);
  }, [ready, inApp]);
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.green }} />;

  return (
    // dir: react-native-web resolves start/end and mirrors from the nearest dir (native reads I18nManager).
    <GestureRoot style={{ flex: 1, backgroundColor: colors.sand }} {...({ dir: isRTL() ? 'rtl' : 'ltr' } as object)}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <AppErrorBoundary onRestart={() => queryClient.resetQueries()}>
            <NetChrome>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.sand }, animation: isRTL() ? 'slide_from_left' : 'slide_from_right' }}>
                <Stack.Screen name="index" options={{ animation: 'none' }} />
                <Stack.Screen name="(onboarding)" options={{ animation: 'fade' }} />
                <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
                <Stack.Screen name="ask" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                {/* Adding a passport rises over wherever it was asked for (a booking, the Wallet) and drops back to it. */}
                <Stack.Screen name="passport" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                <Stack.Screen name="update" options={{ animation: 'fade', gestureEnabled: false }} />
                <Stack.Screen name="maintenance" options={{ animation: 'fade', gestureEnabled: false }} />
                {/* Low battery: no animation in, none out. */}
                <Stack.Screen name="battery" options={{ animation: 'none', contentStyle: { backgroundColor: '#000' } }} />
              </Stack>
            </NetChrome>
          </AppErrorBoundary>
          <SessionExpired when={expired} />
          <SignInSheet when={askingSignIn} />
          {/* The lock is only ever over a signed-in app. */}
          <AppLockRoot when={status === 'signedIn'} />
          <UpdateBar when={updateReady} />
          <ToastHost when={toastShown} />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureRoot>
  );
}
