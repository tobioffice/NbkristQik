import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // the web app has its own package + vitest config
    include: ['tests/**/*.test.ts'],
    // never let a stray real TURSO_DATABASE_URL point tests at production
    env: {
      TURSO_DATABASE_URL: 'file::memory:',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // floor ~2 points below the measured total (2026-11-04:
      // statements 72.22, branches 76.85, functions 84.02, lines 72.22),
      // so ordinary test churn does not flip CI; raise as coverage improves
      thresholds: {
        statements: 70,
        branches: 75,
        functions: 82,
        lines: 70,
      },
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        'src/web/',
        '.claude/',
        'scripts/',
        '**/*.config.ts',
        '**/*.config.js',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});