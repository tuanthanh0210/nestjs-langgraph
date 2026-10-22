import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env.validation.js';
import { ChatModelService } from './chat-model.service.js';

function config(values: Partial<Env>): ConfigService<Env, true> {
  return {
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>;
}

describe('ChatModelService', () => {
  it('auto-selects Gemini when only a Gemini key is configured', () => {
    const service = new ChatModelService(
      config({
        GEMINI_API_KEY: 'fake-key',
        GEMINI_MODEL: 'gemini-3.8-flash',
        LLM_TEMPERATURE: 0.2,
        LLM_MAX_TOKENS: 1024,
      }),
    );

    expect(service.provider).toBe('gemini');
    expect(service.modelName).toBe('gemini-3.8-flash');
    expect(service.model).toBeDefined();
  });

  it('falls back to the offline mock model without keys', () => {
    const service = new ChatModelService(config({ LLM_TEMPERATURE: 0.2, LLM_MAX_TOKENS: 1024 }));

    expect(service.provider).toBe('mock');
    expect(service.modelName).toBe('mock-agent');
  });

  it('rejects an explicit Gemini provider without a key', () => {
    expect(
      () =>
        new ChatModelService(
          config({
            LLM_PROVIDER: 'gemini',
            LLM_TEMPERATURE: 0.2,
            LLM_MAX_TOKENS: 1024,
          }),
        ),
    ).toThrow(/GEMINI_API_KEY/);
  });
});
