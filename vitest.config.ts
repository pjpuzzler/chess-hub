import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so tests skip the React/Devvit build plugins.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
