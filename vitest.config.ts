import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { maxForks: 4, minForks: 1 } },
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
