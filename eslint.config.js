import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Type-aware rules for the TypeScript zones that ship to users (src/, worker/, shared/).
 * The program comes from tsconfig.eslint.json, which — unlike the build projects — also
 * includes the test files, so no linted file is "not found in any project".
 */
const typeAwareRules = {
  languageOptions: {
    parserOptions: {
      project: ['./tsconfig.eslint.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/require-await': 'error',
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/no-misused-promises': [
      'error',
      // JSX handlers such as onClick={async () => ...} are idiomatic React; checking them would
      // touch ~137 handlers in src/*.tsx for no runtime benefit.
      { checksVoidReturn: { attributes: false } },
    ],
    // Deliberately off — deferred follow-up. The no-unsafe-* family fires on every JSON.parse,
    // D1 row shape and WebSocket `event.data` boundary; enabling it means typing those
    // boundaries first, which is a domain refactor rather than a tooling change.
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
    '@typescript-eslint/no-unsafe-return': 'off',
  },
};

/** Cloudflare Workers (workerd) globals: the service-worker surface plus workerd additions. */
const workerdGlobals = {
  ...globals.serviceworker,
  WebSocketPair: 'readonly',
  DurableObject: 'readonly',
  Cloudflare: 'readonly',
};

export default defineConfig([
  globalIgnores([
    'dist',
    '.wrangler',
    'architecture-out',
    'test-results',
    'playwright-report',
    'worker-configuration.d.ts',
    'node_modules',
  ]),

  // Client: React 19 in the browser.
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      typeAwareRules,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // Worker: runs on workerd, never in a browser or Node.
  {
    files: ['worker/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended, typeAwareRules],
    languageOptions: {
      globals: workerdGlobals,
    },
  },

  // Shared domain and contracts: framework-free, so no environment globals at all.
  {
    files: ['shared/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended, typeAwareRules],
  },

  // Node scripts (deploy preparation, D1 checks, load tests) and root config files.
  {
    files: ['scripts/**/*.mjs', '*.mjs', '*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    files: ['*.ts', 'migrations/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Playwright scenarios run in Node; page.evaluate callbacks execute in the browser.
  {
    files: ['e2e/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // Tests: fixtures and mocks legitimately reach for `any`, `!`, unused placeholders and
  // `async` stubs that satisfy a Promise-returning interface without awaiting anything.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'react-refresh/only-export-components': 'off',
    },
  },

  // Must stay last so no formatting rule fights Prettier.
  eslintConfigPrettier,
]);
