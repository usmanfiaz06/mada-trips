import { Platform } from 'react-native';

/*
 * Build-time settings (EXPO_PUBLIC_* are inlined by Metro).
 *   EXPO_PUBLIC_API_URL   the Core API origin, e.g. https://madatrips.sa. Empty on web = same origin.
 *   EXPO_PUBLIC_API_MODE  "live" (default) or "mock": an in-app stand-in for the API with the same rules, for design work
 *                         and screenshots when no server is running.
 */
const fallbackOrigin = Platform.OS === 'web' ? '' : Platform.OS === 'android' ? 'http://10.0.2.2:3100' : 'http://localhost:3100';
export const API_ORIGIN = (process.env.EXPO_PUBLIC_API_URL ?? fallbackOrigin).replace(/\/$/, '');
export const API_MODE: 'live' | 'mock' = process.env.EXPO_PUBLIC_API_MODE === 'mock' ? 'mock' : 'live';
/** Development builds show the demo hints the prototype shows ("Demo code: 123456"). */
export const SHOW_DEMO_HINTS = __DEV__ || API_MODE === 'mock' || process.env.EXPO_PUBLIC_DEMO_HINTS === 'yes';
