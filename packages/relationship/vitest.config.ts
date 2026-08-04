import { defineConfig, mergeConfig } from 'vitest/config';
import { baseTestConfig } from '../../vitest.base.js';

/**
 * Test configuration for `@nexa/relationship`.
 *
 * Globs are package-relative, so Turborepo running this from the package
 * directory finds exactly this package's tests and no others. The `name` is
 * what Vitest prints per project, which makes a skipped package visible in the
 * output instead of silent.
 */
export default mergeConfig(
  baseTestConfig,
  defineConfig({ test: { name: '@nexa/relationship' } }),
);
