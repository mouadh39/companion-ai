import { defineConfig } from 'vitest/config';

/**
 * Tests run from the repository root against each package's built output, so a
 * test exercises exactly what other packages import — not a parallel
 * source-only reality where the published entry point is never checked.
 */
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
