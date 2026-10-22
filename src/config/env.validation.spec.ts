import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.validation.js';

describe('validateEnv', () => {
  it('applies safe defaults without any environment variables', () => {
    const env = validateEnv({});
    expect(env.PORT).toBe(3000);
    expect(env.LLM_PROVIDER).toBeUndefined(); // ChatModelService falls back based on the API key.
    expect(env.OPENAI_MODEL).toBe('gpt-4o-mini');
    expect(env.AGENT_MAX_ITERATIONS).toBe(8);
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.SWAGGER_ENABLED).toBe(true);
    expect(env.STORE_NAME).toBe('NestShop');
    expect(env.PRODUCTS_FILE).toBe('./data/products.csv');
    expect(env.ORDERS_FILE).toBe('./data/orders/orders.jsonl');
    expect(env.SHIPPING_FEE).toBe(30_000);
    expect(env.FREE_SHIPPING_THRESHOLD).toBe(500_000);
    expect(env.ORDER_PREFIX).toBe('ORD');
  });

  it('requires an API key when the openai provider is explicit', () => {
    expect(() => validateEnv({ LLM_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
  });

  it('accepts an OpenAI-compatible base URL', () => {
    const env = validateEnv({
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
      OPENAI_MODEL: 'deepseek-chat',
    });
    expect(env.OPENAI_BASE_URL).toBe('https://api.deepseek.com/v1');
    expect(env.OPENAI_MODEL).toBe('deepseek-chat');
  });

  it('treats an empty DATABASE_URL as disabled', () => {
    expect(validateEnv({ DATABASE_URL: '' }).DATABASE_URL).toBeUndefined();
    expect(() => validateEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/postgres/);
  });

  it('rejects invalid numeric values and booleans', () => {
    expect(() => validateEnv({ PORT: '70000' })).toThrow(/Invalid environment configuration/);
    expect(() => validateEnv({ AGENT_MAX_ITERATIONS: '0' })).toThrow(
      /Invalid environment configuration/,
    );
    expect(validateEnv({ SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED).toBe(false);
  });

  it('validates the order prefix', () => {
    expect(validateEnv({ ORDER_PREFIX: 'shop' }).ORDER_PREFIX).toBe('SHOP');
    expect(() => validateEnv({ ORDER_PREFIX: 'x' })).toThrow(/ORDER_PREFIX/);
    expect(() => validateEnv({ ORDER_PREFIX: 'bad prefix' })).toThrow(/ORDER_PREFIX/);
  });

  it('validates the default time zone', () => {
    expect(validateEnv({ DEFAULT_TIMEZONE: 'Asia/Ho_Chi_Minh' }).DEFAULT_TIMEZONE).toBe(
      'Asia/Ho_Chi_Minh',
    );
    expect(() => validateEnv({ DEFAULT_TIMEZONE: 'Mars/Olympus' })).toThrow(/IANA time zone/);
  });

  it('rejects empty values for required strings', () => {
    expect(() => validateEnv({ OPENAI_MODEL: '' })).toThrow(/Invalid environment configuration/);
  });
});
