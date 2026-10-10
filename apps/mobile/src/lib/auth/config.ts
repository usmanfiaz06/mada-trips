import { API_MODE } from '../config';

/*
 * Sign-in through Supabase Auth (docs/app/AUTH.md). EXPO_PUBLIC_* values are inlined at build time.
 *   EXPO_PUBLIC_SUPABASE_URL          https://<project>.supabase.co
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY     the project's publishable (anon) key. Safe in the app; RLS isn't used for app data.
 *   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID  Google OAuth "Web application" client id (its ID tokens are what Supabase checks)
 *   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID  Google OAuth iOS client id
 * Without a project (or with EXPO_PUBLIC_API_MODE=mock) the app uses its stand-in (mock.ts): codes are always 123456,
 * Apple and Google answer at once. The Core API accepts its tokens only outside production.
 */
export const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';

export const AUTH_MODE: 'supabase' | 'mock' = API_MODE === 'mock' || !SUPABASE_URL || !SUPABASE_ANON_KEY ? 'mock' : 'supabase';

/** Supabase's own wait between codes to one number or address (Auth › Rate limits). The mock keeps the same. */
export const CODE_RESEND_SECONDS = 60;
