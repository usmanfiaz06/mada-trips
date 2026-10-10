import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const stub = (f: string) => resolve(here, 'test/unit/stubs', f);

// Unit tests for the API client, the outbox and the resilience helpers (no device, no bundler): native modules stubbed.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: resolve(here, 'src/$1') },
      { find: /^@mada\/shared$/, replacement: resolve(here, '../../packages/shared/src/index.ts') },
      { find: /^react-native$/, replacement: stub('react-native.ts') },
      { find: /^expo-constants$/, replacement: stub('expo-constants.ts') },
      { find: /^expo-secure-store$/, replacement: stub('secure-store.ts') },
      { find: /^@react-native-async-storage\/async-storage$/, replacement: stub('async-storage.ts') },
      { find: /^@react-native-community\/netinfo$/, replacement: stub('netinfo.ts') },
      { find: /^\.\/mock-api$/, replacement: stub('mock-api.ts') },
    ],
  },
  test: { include: ['test/unit/**/*.test.ts'], environment: 'node', setupFiles: ['test/unit/setup.ts'] },
});
