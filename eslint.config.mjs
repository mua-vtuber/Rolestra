import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import i18next from 'eslint-plugin-i18next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  // ── Global ignores ──
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      '_legacy/**',
      'docs/Rolestra_sample/**',
      '.omx/**',
      '.playwright-cli/**',
      'output/**',
    ],
  },

  // ── Base: recommended JS + strict TS ──
  eslint.configs.recommended,
  ...tseslint.configs.strict,

  // ── Global settings ──
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // Allow unused vars with _ prefix (common pattern for intentionally unused params)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ── Main process ──
  {
    files: ['src/main/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/renderer/*', '**/renderer'],
              message: 'main -> renderer direct import is forbidden. Use IPC.',
            },
          ],
        },
      ],
    },
  },

  // ── Test files ──
  {
    files: [
      'src/**/__tests__/**/*.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
      'src/**/*.spec.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-this-alias': 'off',
    },
  },

  // ── Preload ──
  {
    files: ['src/preload/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/main/*', '**/main'],
              message: 'preload -> main direct import is forbidden. Only shared is allowed.',
            },
            {
              group: ['**/renderer/*', '**/renderer'],
              message:
                'preload -> renderer direct import is forbidden. Only shared is allowed.',
            },
          ],
        },
      ],
    },
  },

  // ── Renderer ──
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      i18next,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/main/*', '**/main'],
              message:
                'renderer -> main direct import is forbidden. Use IPC.',
            },
          ],
        },
      ],
      'i18next/no-literal-string': [
        'warn',
        {
          markupOnly: true,
          ignoreAttribute: [
            'style',
            'className',
            'key',
            'data-testid',
            'to',
            'href',
            'type',
            'name',
            'id',
            'aria-label',
          ],
        },
      ],
    },
  },

  // ── Shared ──
  {
    files: ['src/shared/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // ── Config files (JS) ──
  {
    files: ['eslint.config.mjs', 'electron.vite.config.ts', 'vitest.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
