import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { ToastHost } from '@/components/Toast';
import { ErrorBoundary as AppErrorBoundary } from '@/components/states/ErrorBoundary';
import { CrashState } from '@/components/states/ErrorState';
import { NetChrome } from '@/components/states/NetChrome';
import { SessionExpired } from '@/components/states/SessionExpired';
import { AppLock } from '@/components/auth/AppLock';
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
import { bootLocale, getLocale, isRTL } from '@/lib/i18n';

SplashScreen.preventAutoHideAsync().catch(() => {});
// When things go wrong (FLOWS.md §12): crash reports (Sentry, only with a DSN), the connection, the offline copy.
initReporting(Constants.expoConfig?.version);
startNet();
startPersistence();

/** expo-router's boundary for the layout itself: the same calm crash screen. */
export function ErrorBoundary({ retry }: { error: Error; retry: () => Promise<void> }) {
  return <View style={{ flex: 1, backgroundColor: colors.sand }}><CrashState onRestart={() => { void retry(); }} /></View>;
}

export default function RootLayout() {
  // Arabic loads IBM Plex Sans Arabic and Reem Kufi under the same family names (theme/fonts.ts).
  const [fontsLoaded, fontError] = useFonts(fontsFor(getLocale()));
  // The language for this launch is confirmed before the first screen (a mismatch restarts once, behind the splash).
  const [localeReady, setLocaleReady] = useState(false);
  useEffect(() => { void bootLocale().then((ok) => { if (ok) setLocaleReady(true); }).catch(() => setLocaleReady(true)); }, []);
  const status = useSession((s) => s.status);
  const boot = useSession((s) => s.boot);
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
    if (status === 'signedIn' && savedLocale && savedLocale !== getLocale()) void api.updateMe({ locale: getLocale() }).catch(() => {});
  }, [status, savedLocale]);

  const ready = (fontsLoaded || !!fontError) && status !== 'loading' && restored && localeReady;
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.green }} />;

  return (
    // dir: react-native-web resolves start/end and mirrors from the nearest dir (native reads I18nManager).
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.sand }} {...({ dir: isRTL() ? 'rtl' : 'ltr' } as object)}>
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
                <Stack.Screen name="update" options={{ animation: 'fade', gestureEnabled: false }} />
                <Stack.Screen name="maintenance" options={{ animation: 'fade', gestureEnabled: false }} />
              </Stack>
            </NetChrome>
          </AppErrorBoundary>
          <SessionExpired />
          <AppLock />
          <ToastHost />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
