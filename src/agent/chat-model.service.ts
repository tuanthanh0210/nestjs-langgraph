import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import type { Env } from '../config/env.validation.js';
import { MockChatModel } from './models/mock-chat.model.js';

export type LlmProvider = 'openai' | 'mock';

/**
 * Creates the chat model once and shares it across requests.
 *
 * Any OpenAI-compatible endpoint works (OpenAI, DeepSeek, OpenRouter, Ollama,
 * vLLM, LiteLLM…) — point OPENAI_BASE_URL at it and keep using ChatOpenAI.
 */
@Injectable()
export class ChatModelService {
  private readonly logger = new Logger(ChatModelService.name);

  readonly provider: LlmProvider;
  readonly modelName: string;
  readonly model: BaseChatModel;

  constructor(config: ConfigService<Env, true>) {
    const apiKey = config.get('OPENAI_API_KEY', { infer: true });
    const explicitProvider = config.get('LLM_PROVIDER', { infer: true });

    this.provider = explicitProvider ?? (apiKey ? 'openai' : 'mock');

    if (this.provider === 'openai') {
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai');
      }

      const baseURL = config.get('OPENAI_BASE_URL', { infer: true });
      this.modelName = config.get('OPENAI_MODEL', { infer: true });

      this.model = new ChatOpenAI({
        model: this.modelName,
        apiKey,
        temperature: config.get('LLM_TEMPERATURE', { infer: true }),
        maxTokens: config.get('LLM_MAX_TOKENS', { infer: true }),
        streaming: true,
        ...(baseURL ? { configuration: { baseURL } } : {}),
      });

      this.logger.log(
        `LLM provider: openai | model: ${this.modelName} | baseURL: ${baseURL ?? 'default'}`,
      );
      return;
    }

    this.modelName = 'mock-agent';
    this.model = new MockChatModel();
    this.logger.warn(
      'LLM provider: mock (deterministic, offline). Set LLM_PROVIDER=openai + OPENAI_API_KEY for real intelligence.',
    );
  }
}
