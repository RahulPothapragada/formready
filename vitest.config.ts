import { defineConfig } from 'vitest/config';

/**
 * One runner across the workspace. The engine's suites must stay runnable with
 * no browser environment at all — that is what keeps the package portable.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts', 'packages/*/tests/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@formready/engine': new URL('./packages/engine/src/index.ts', import.meta.url).pathname,
      '@formready/browser': new URL('./packages/browser/src/index.ts', import.meta.url).pathname,
    },
  },
});
