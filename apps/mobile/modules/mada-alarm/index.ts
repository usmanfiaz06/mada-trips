import { requireOptionalNativeModule } from 'expo';

/*
 * The wake-up alarm's native side (README.md). Null on the web, in Expo Go and in builds made before the module was
 * added: the caller then falls back to a notification and says so.
 */
export type AlarmAuth = 'authorized' | 'denied' | 'notDetermined' | 'unavailable';

export type MadaAlarmNative = {
  /** iOS 26+ with AlarmKit. */
  isAlarmKitAvailable(): boolean;
  authorizationState(): Promise<AlarmAuth>;
  requestAuthorization(): Promise<AlarmAuth>;
  /** iOS: a one-time AlarmKit alarm. Resolves to its id. */
  schedule(id: string, epochMs: number, title: string, stopLabel: string): Promise<string>;
  cancel(id: string): Promise<void>;
  /** Android: the Clock app's new-alarm screen, filled in. */
  setClockAlarm(hour: number, minute: number, label: string, skipUi: boolean): Promise<boolean>;
  dismissClockAlarm(label: string): Promise<boolean>;
  showClockAlarms(): Promise<boolean>;
};

export const MadaAlarm = requireOptionalNativeModule<MadaAlarmNative>('MadaAlarm');
