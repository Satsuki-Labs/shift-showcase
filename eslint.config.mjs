import tseslint from 'typescript-eslint';

export const limits = { file: 400, function: 100 };
export const lineOptions = { skipBlankLines: true, skipComments: true };

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.wrangler/**', 'output/**'],
  },
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs,gs}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
    rules: {
      'max-lines': ['error', { max: limits.file, ...lineOptions }],
      'max-lines-per-function': ['error', { max: limits.function, ...lineOptions }],
    },
  },
];
