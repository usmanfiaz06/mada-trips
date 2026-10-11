import { Linking, Platform } from 'react-native';
import { API_PREFIX } from '@mada/shared';
import { API_ORIGIN } from './config';
import { useFeature } from './net/gates';

/*
 * The beta's switches, as GET /config says (platform/src/lib/app/switches.ts), and files from the desk.
 *   flightsByRequest   Ask turns a flight search into "Tell us where and when", a request Mada quotes by hand
 *   bookingNeedsPhone  off while phone codes aren't live: the pay sheet asks for a number to reach you instead
 */
export const useFlightsByRequest = () => useFeature('flightsByRequest', false);
export const useBookingNeedsPhone = () => useFeature('bookingNeedsPhone', true);

/** A signed file link from the server is relative to the Core API (/files/…); data: and https: links pass as they are. */
export function fileUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^(https?:|data:|blob:)/.test(url)) return url;
  return `${API_ORIGIN}${API_PREFIX}${url.startsWith('/') ? url : `/${url}`}`;
}

/** Open a photo or PDF the desk sent: the browser's viewer on the web, the system's on a phone. */
export async function openFile(url: string | null | undefined): Promise<boolean> {
  const u = fileUrl(url);
  if (!u) return false;
  if (Platform.OS === 'web') {
    const w = (globalThis as { open?: (u: string, t?: string) => unknown }).open;
    if (w) { w(u, '_blank'); return true; }
  }
  try { await Linking.openURL(u); return true; } catch { return false; }
}

/** "1.2 MB", "340 KB". */
export function fileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}
