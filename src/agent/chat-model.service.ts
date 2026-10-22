import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import type { Env } from '../config/env.validation.js';
import { MockChatModel } from './models/mock-chat.model.js';

export type LlmProvider = 'openai' | 'gemini' | 'mock';

/**
 * Creates the chat model once and shares it across requests.
 *
 * Supports Google Gemini (native), OpenAI, and any OpenAI-compatible endpoint
 * (DeepSeek, OpenRouter, Ollama, vLLM, LiteLLM…) via OPENAI_BASE_URL.
 */
@Injectable()
export class ChatModelService {
  private readonly logger = new Logger(ChatModelService.name);

  readonly provider: LlmProvider;
  readonly modelName: string;
  readonly model: BaseChatModel;

  constructor(config: ConfigService<Env, true>) {
    const apiKey = config.get('OPENAI_API_KEY', { infer: true });
    const geminiKey = config.get('GEMINI_API_KEY', { infer: true });
    const explicitProvider = config.get('LLM_PROVIDER', { infer: true });

    this.provider = explicitProvider ?? (apiKey ? 'openai' : geminiKey ? 'gemini' : 'mock');

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

    if (this.provider === 'gemini') {
      if (!geminiKey) {
        throw new Error('GEMINI_API_KEY is required when LLM_PROVIDER=gemini');
      }

      this.modelName = config.get('GEMINI_MODEL', { infer: true });
      this.model = new ChatGoogleGenerativeAI({
        model: this.modelName,
        apiKey: geminiKey,
        temperature: config.get('LLM_TEMPERATURE', { infer: true }),
        maxOutputTokens: config.get('LLM_MAX_TOKENS', { infer: true }),
        streaming: true,
      });

      this.logger.log(`LLM provider: gemini | model: ${this.modelName}`);
      return;
    }

    this.modelName = 'mock-agent';
    this.model = new MockChatModel();
    this.logger.warn(
      'LLM provider: mock (deterministic, offline). Set LLM_PROVIDER=gemini + GEMINI_API_KEY, or openai + OPENAI_API_KEY, for real intelligence.',
    );
  }
}
