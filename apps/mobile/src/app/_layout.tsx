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
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif/400Regular';
import { InterTight_400Regular } from '@expo-google-fonts/inter-tight/400Regular';
import { InterTight_500Medium } from '@expo-google-fonts/inter-tight/500Medium';
import { InterTight_600SemiBold } from '@expo-google-fonts/inter-tight/600SemiBold';
import { InterTight_700Bold } from '@expo-google-fonts/inter-tight/700Bold';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { ToastHost } from '@/components/Toast';
import { ErrorBoundary as AppErrorBoundary } from '@/components/states/ErrorBoundary';
import { CrashState } from '@/components/states/ErrorState';
import { NetChrome } from '@/components/states/NetChrome';
import { SessionExpired } from '@/components/states/SessionExpired';
import { useOutboxPump } from '@/lib/net/outbox';
import { restoreCache, startPersistence } from '@/lib/net/persist';
import { useRemoteConfig } from '@/lib/net/remote';
import { initReporting } from '@/lib/net/report';
import { startNet } from '@/lib/net/state';
import { queryClient } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { colors } from '@/theme';

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
  const [fontsLoaded, fontError] = useFonts({
    InstrumentSerif_400Regular, InterTight_400Regular, InterTight_500Medium, InterTight_600SemiBold, InterTight_700Bold, JetBrainsMono_400Regular,
  });
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

  const ready = (fontsLoaded || !!fontError) && status !== 'loading' && restored;
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.green }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.sand }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <AppErrorBoundary onRestart={() => queryClient.resetQueries()}>
            <NetChrome>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.sand }, animation: 'slide_from_right' }}>
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
          <ToastHost />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
