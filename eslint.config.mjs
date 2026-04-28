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
      // Playwright Electron E2E (R4-Task12). The specs follow
      // Playwright's conventions (different globals, no i18n rules),
      // and they run outside the project lint pipeline.
      'e2e/**',
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
      // F5-T2: aria-label / placeholder / title / alt 도 감지하도록 강화.
      // markupOnly:false 로 attribute 도 검사하되, 기술/구조용 attribute 만 ignoreAttribute 에 둔다.
      // 사용자 노출 attribute (aria-label / placeholder / title / alt) 는 t() 경유 강제.
      'i18next/no-literal-string': [
        'warn',
        {
          markupOnly: false,
          ignoreAttribute: [
            'style',
            'className',
            'key',
            'to',
            'href',
            'type',
            'name',
            'id',
            'role',
            'method',
            'rel',
            'target',
            'autoComplete',
            'tabIndex',
            'onClick',
            'onChange',
            'onSubmit',
            'onSelect',
            'onFocus',
            'onBlur',
            'onKeyDown',
            'data-testid',
            'data-active',
            'data-role',
            'data-theme-variant',
            'data-provider-id',
            'data-status',
            'data-busy',
            'data-tone',
            'data-mode',
            'data-theme',
            'data-rejected',
            'data-empty',
            'data-readonly',
            'data-meeting-pulse',
            'data-skeleton',
            'data-loading',
            'data-error',
            'data-variant',
            'data-decision',
            'data-kind',
            'data-status-tone',
            'data-section',
            'data-state',
            'data-view',
            'aria-current',
            'aria-hidden',
            'aria-describedby',
            'aria-labelledby',
            'aria-controls',
            'aria-haspopup',
            'aria-expanded',
            'aria-modal',
            'aria-live',
            'aria-atomic',
            'aria-pressed',
            'aria-checked',
            'aria-disabled',
            'aria-busy',
            'aria-relevant',
            'aria-orientation',
            'aria-selected',
            'aria-sort',
            'aria-valuenow',
            'aria-valuemin',
            'aria-valuemax',
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

  // ── Build / asset / smoke tooling ──
  {
    files: ['tools/**/*.{ts,mjs,js,cjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
