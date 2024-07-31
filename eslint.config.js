import neostandard, { resolveIgnoresFromGitignore } from 'neostandard'
import tseslint from 'typescript-eslint'

export default [
  ...neostandard({
    files: [
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
    filesTs: [
      '**/*.ts',
      '**/*.mts',
      '**/*.cts',
    ],
    ts: true,
    ignores: [
      ...resolveIgnoresFromGitignore(),
    ],
  }),
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigDirName: import.meta.dirname,
      },
    },
  },
  {
    name: 'overrides',
    rules: {
      '@typescript-eslint/no-unsafe-method-access': 'off',
    },
  },
]
