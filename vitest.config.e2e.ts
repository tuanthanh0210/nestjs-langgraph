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
      PRODUCTS_FILE: './data/products.csv',
      STORE_INFO_FILE: './data/store-info.md',
      ORDERS_FILE: './data/orders/e2e-orders.jsonl',
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
