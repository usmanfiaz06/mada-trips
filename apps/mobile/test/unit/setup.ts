(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
process.env.EXPO_PUBLIC_API_MODE = 'live';
// Unit tests never reach a real Supabase project: a developer's shell (or CI) may export one, which would flip the
// app's AUTH_MODE to 'supabase' and change what the stand-in offers (e.g. phone code channels before /config answers).
delete process.env.EXPO_PUBLIC_SUPABASE_URL;
delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
