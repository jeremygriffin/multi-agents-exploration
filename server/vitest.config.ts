import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: true,
    setupFiles: [],
    typecheck: {
      tsconfig: './tsconfig.vitest.json',
    },
  },
});
