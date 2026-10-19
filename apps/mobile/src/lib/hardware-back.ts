import { useCallback } from 'react';
import { Alert, BackHandler, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';

/**
 * Android's back button (and back gesture) on a booking screen. While money is moving it does nothing but say so; on a
 * screen opened straight from a link or a notification, where back would close the app, it asks first and then goes
 * to `fallback` instead. Anywhere else it is the ordinary back. Open sheets close themselves first (Sheet's Modal).
 */
export function useBookingBack({ busy, busyText = 'back.busy', canGoBack, onLeave }: { busy: boolean; busyText?: 'back.busy' | 'back.saving'; canGoBack: () => boolean; onLeave: () => void }) {
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy) { toast(t(busyText)); return true; }
      if (canGoBack()) return false;
      Alert.alert(t('back.leave.title'), t('back.leave.body'), [
        { text: t('back.leave.stay'), style: 'cancel' },
        { text: t('back.leave.go'), style: 'destructive', onPress: onLeave },
      ]);
      return true;
    });
    return () => sub.remove();
  }, [busy, busyText, canGoBack, onLeave]));
}
