// Flat ESLint config for the backend (Node 22 + TypeScript, ESM).
// Strict `tsc` already does the heavy lifting; ESLint adds the lint-only checks
// tsc doesn't (unused vars, unsafe patterns, consistency). Kept to the
// non-type-checked recommended set so it runs fast in CI without a second
// program build.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.data/**', 'node_modules/**', 'dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    rules: {
      // Underscore-prefixed args/vars are intentional (interface-required params
      // we don't use, e.g. `_newVersions` in the checkpointer's put()).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
);
