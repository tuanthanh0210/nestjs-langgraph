import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    env: {
      NODE_ENV: 'test',
      LLM_PROVIDER: 'mock',
      DATABASE_URL: '',
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
