// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint configuration for the whole workspace.
 *
 * `turbo run lint` previously reported success for all seven packages while
 * running nothing at all — Turborepo's dry-run showed `command: "<NONEXISTENT>"`
 * for every one, because the task was declared in `turbo.json` but no package
 * had a `lint` script. That is the same silent-success failure as the test and
 * typecheck gaps, so it is fixed the same way: by making the task real.
 *
 * The rule set is deliberately narrow. TypeScript in strict mode already
 * catches the large majority of what a linter would, so the value here is in
 * the things the compiler cannot see — floating promises, unnecessary
 * conditions, unsafe `!`. Rules that merely restate a compiler error, or that
 * are stylistic, are omitted: a lint run nobody trusts gets disabled, and a
 * disabled lint run is worth less than no lint run at all.
 */
export default tseslint.config(
  {
    // Generated output and dependencies are never linted. Listed first so the
    // ignore applies globally rather than per-block.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      '**/tsconfig.tsbuildinfo',
      'Unity/**',
    ],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        /**
         * Type-aware linting, pointed at the *typecheck* configs rather than at
         * `tsconfig.json`.
         *
         * This is the same fix as the typecheck task, for the same reason. A
         * package's `tsconfig.json` includes only `src/**`, so the project
         * service could not place any file under `test/` and every test file
         * failed to parse. `tsconfig.typecheck.json` includes both, so lint and
         * typecheck now see exactly the same set of files — there is no
         * combination of inputs where one covers something the other misses.
         */
        project: [
          './packages/*/tsconfig.typecheck.json',
          './apps/*/tsconfig.typecheck.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /**
       * The single most valuable rule in this config.
       *
       * The event bus deliberately does not await handlers, and the codebase is
       * full of `void promise.catch(...)`. That pattern is correct exactly
       * where it is intended and a dropped error everywhere else, and only a
       * type-aware linter can tell the two apart.
       */
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      /** `any` is banned by convention; this makes it enforced rather than reviewed. */
      '@typescript-eslint/no-explicit-any': 'error',

      /**
       * Off, deliberately.
       *
       * `require-await` flags an `async` method with no `await` in it — which
       * describes every correct implementation of an asynchronous interface
       * that happens not to need one. `RecordingEventBus.publish` returns
       * `Promise<void>` because `EventPublisher` says it does, not because it
       * awaits anything, and rewriting it to satisfy this rule would mean
       * either a pointless `await` or dropping the `async` keyword and
       * hand-rolling the promise. Both are worse than the thing being flagged.
       */
      '@typescript-eslint/require-await': 'off',

      /**
       * Downgraded to warnings: these fire on legitimate boundary code where a
       * value genuinely is `unknown` until proven otherwise — parsing a model
       * response, reading a column. Errors there would push contributors toward
       * casting, which is worse than the thing being flagged.
       */
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',

      /** Unused values are usually a half-finished edit. `_` prefix opts out. */
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  {
    // Config files are not part of any package's TS project.
    files: ['*.config.js', '*.config.ts', 'scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
);
