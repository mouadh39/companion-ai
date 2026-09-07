import { defineConfig, mergeConfig } from 'vitest/config';
import { baseTestConfig } from '../../vitest.base.js';

/**
 * Test configuration for `@nexa/self`.
 *
 * Globs are package-relative, so Turborepo running this from the package
 * directory finds exactly this package's tests and no others.
 */
export default mergeConfig(
  baseTestConfig,
  defineConfig({ test: { name: '@nexa/self' } }),
);
