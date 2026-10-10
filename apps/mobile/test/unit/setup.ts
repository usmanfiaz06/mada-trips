(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
process.env.EXPO_PUBLIC_API_MODE = 'live';
