import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts'],
    exclude: ['e2e/**', '.output/**', 'node_modules/**'],
    coverage: {
      include: ['lib/**'],
      exclude: ['lib/**/*.test.ts'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname),
        '~': path.resolve(__dirname),
      },
    },
  },
});
