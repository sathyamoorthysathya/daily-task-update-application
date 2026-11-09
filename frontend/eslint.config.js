// @ts-check
import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist', 'coverage', 'eslint.config.js']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  // Must stay last: disables stylistic rules that would conflict with Prettier.
  prettierConfig,
);
