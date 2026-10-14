import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/coverage/**',
      // Vendored holocss, replaced by the published package in M4 story 4.10.
      'apps/playground/src/vendor/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Empty `catch {}` is used deliberately to ignore optional WebGPU/CSS setup failures.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Playwright specs use a few patterns the strict rules disallow on purpose.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unsafe-finally': 'off',
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
      'no-empty-pattern': 'off',
    },
  },
  {
    // The `@mk7s/hologpu-react` wrapper registers the hooks rules its code disables by name.
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Scripts and config files run in Node; some drive a browser via Playwright.
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  prettier,
);
