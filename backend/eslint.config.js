// @ts-check
import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist', 'coverage', 'src/generated', 'eslint.config.js']),
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      // supertest response bodies are typed as `any`.
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  // Must stay last: disables stylistic rules that would conflict with Prettier.
  prettierConfig,
);
