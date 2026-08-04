import { defineConfig } from 'vitest/config';

/**
 * Shared test configuration, merged by every package's `vitest.config.ts`.
 *
 * The `include` glob is **relative to the package**, and that is the entire
 * point of this file existing. The previous setup put root-relative globs
 * (`packages/*​/test/**`) in a single root config; Turborepo runs each package's
 * `test` script with that package as the working directory, so Vitest re-rooted
 * those globs and looked for `packages/models/packages/*​/test/**`. Nothing
 * matched, every package reported "No test files found", and `--passWithNoTests`
 * turned each of those into a success.
 *
 * The result was a suite that reported 13/13 tasks passing while executing zero
 * tests. Package-relative globs make that failure impossible: a package either
 * has tests under `test/` and runs them, or genuinely has none.
 *
 * Tests run against each package's **built** `dist`, because imports resolve
 * through the package's `exports` map. That is deliberate — a test then
 * exercises exactly what other packages import, rather than a source-only
 * reality where the published entry point is never checked. It is why the
 * Turborepo `test` task depends on `build`.
 */
export const baseTestConfig = defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    /**
     * Packages with no tests are legitimate — `@nexa/shared` is types and small
     * pure helpers. This flag makes those honest zeros rather than failures.
     * It is safe *only* because the include glob above is now correct; paired
     * with a broken glob it is what hid the problem for three milestones.
     */
    passWithNoTests: true,
  },
});
