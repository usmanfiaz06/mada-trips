import { requireOptionalNativeModule } from 'expo';

type EventSubscription = { remove(): void };

/*
 * The lock-screen flight's native side (ios/MadaLiveModule.swift). Null on the web, on Android, in Expo Go and in
 * builds made before the module was added: lib/live-activity.ts then uses an ongoing notification (Android) or
 * nothing at all, and Today says so.
 */
export type LiveRow = { activityId: string; segmentId: string; tripId: string; token?: string };

export type MadaLiveNative = {
  isSupported(): boolean;
  areActivitiesEnabled(): boolean;
  start(attributes: Record<string, unknown>, state: Record<string, unknown>): Promise<string>;
  update(id: string, state: Record<string, unknown>): Promise<void>;
  end(id: string, state: Record<string, unknown> | null, now: boolean): Promise<void>;
  running(): LiveRow[];
  setWidgetData(json: string | null): void;
  addListener(event: 'onPushToken', fn: (e: { activityId: string; segmentId: string; tripId: string; token: string }) => void): EventSubscription;
  addListener(event: 'onEnded', fn: (e: { activityId: string; segmentId: string; dismissed: boolean }) => void): EventSubscription;
};

export const MadaLive = requireOptionalNativeModule<MadaLiveNative>('MadaLive');
