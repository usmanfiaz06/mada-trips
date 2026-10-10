// Lint for the app workspace (apps/mobile, packages/shared). platform/ keeps its own setup (next build type-checks it).
import expoConfig from 'eslint-config-expo/flat.js';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  expoConfig,
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'apps/mobile/.expo/**', 'platform/**', 'docs/**', 'js/**', 'assets/**', 'Assets/**', 'tools/**', 'ar/**', 'css/**', 'apps/mobile/public/ocr/**'],
  },
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    settings: { 'import/resolver': { typescript: { project: 'apps/mobile/tsconfig.json' } } },
    rules: { 'import/no-unresolved': 'off' },
  },
  {
    // zod convention: a schema and its inferred type share one name.
    files: ['**/*.ts', '**/*.tsx'],
    rules: { '@typescript-eslint/no-redeclare': 'off' },
  },
]);
