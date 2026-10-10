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
      // floor below the current baseline; raise as coverage improves
      thresholds: {
        statements: 25,
        branches: 55,
        functions: 40,
        lines: 25,
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