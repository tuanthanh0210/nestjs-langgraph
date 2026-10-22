import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    env: {
      NODE_ENV: 'test',
      LLM_PROVIDER: 'mock',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/*.spec.ts', 'src/**/*.dto.ts'],
    },
  },
});
