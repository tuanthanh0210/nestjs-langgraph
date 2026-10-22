import { randomUUID } from 'node:crypto';
import { BadGatewayException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { Env } from '../config/env.validation.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { ToolsService } from '../tools/tools.service.js';
import { createAgentGraph, type AgentGraph } from './agent.graph.js';
import { buildSystemPrompt } from './agent.prompt.js';
import type { AgentInfo, AgentRunResult, AgentStreamEvent, ThreadHistory } from './agent.types.js';
import { ChatModelService } from './chat-model.service.js';
import { CheckpointerService } from './checkpointer.service.js';
import {
  contentToText,
  extractUsage,
  findFinalAssistantMessage,
  toChatMessage,
} from './message.utils.js';

export interface RunAgentInput {
  message: string;
  threadId?: string;
}

const FRIENDLY_ERROR =
  'The agent could not complete this request. Please try again — check the server logs for details.';

@Injectable()
export class AgentService implements OnModuleInit {
  private readonly logger = new Logger(AgentService.name);
  private graph!: AgentGraph;

  constructor(
    private readonly chatModel: ChatModelService,
    private readonly checkpointer: CheckpointerService,
    private readonly tools: ToolsService,
    private readonly catalog: CatalogService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.checkpointer.ensureReady();

    this.graph = createAgentGraph({
      model: this.chatModel.model,
      tools: this.tools.getTools(),
      checkpointer: this.checkpointer.checkpointer,
      maxIterations: this.maxIterations,
      systemPrompt: () =>
        buildSystemPrompt({
          customPrompt: this.config.get('AGENT_SYSTEM_PROMPT', { infer: true }),
          timezone: this.config.get('DEFAULT_TIMEZONE', { infer: true }),
          maxIterations: this.maxIterations,
          storeName: this.config.get('STORE_NAME', { infer: true }),
          storeHotline: this.config.get('STORE_HOTLINE', { infer: true }),
          storeAddress: this.config.get('STORE_ADDRESS', { infer: true }),
          catalogSize: this.catalog.productCount,
          categories: this.catalog.getCategories(),
        }),
    });

    this.logger.log(
      `Agent graph compiled | provider=${this.chatModel.provider} | persistence=${this.checkpointer.kind} | maxIterations=${this.maxIterations}`,
    );
  }

  get maxIterations(): number {
    return this.config.get('AGENT_MAX_ITERATIONS', { infer: true });
  }

  getInfo(): AgentInfo {
    const stats = this.catalog.getStats();

    return {
      provider: this.chatModel.provider,
      model: this.chatModel.modelName,
      persistence: this.checkpointer.kind,
      maxIterations: this.maxIterations,
      store: {
        name: this.config.get('STORE_NAME', { infer: true }),
        ...(this.config.get('STORE_HOTLINE', { infer: true })
          ? { hotline: this.config.get('STORE_HOTLINE', { infer: true }) }
          : {}),
        ...(this.config.get('STORE_EMAIL', { infer: true })
          ? { email: this.config.get('STORE_EMAIL', { infer: true }) }
          : {}),
        ...(this.config.get('STORE_ADDRESS', { infer: true })
          ? { address: this.config.get('STORE_ADDRESS', { infer: true }) }
          : {}),
      },
      catalog: {
        products: stats.productCount,
        categories: stats.categories,
      },
      tools: this.tools.describe(),
    };
  }

  async run(input: RunAgentInput): Promise<AgentRunResult> {
    const threadId = input.threadId ?? randomUUID();
    const config = this.threadConfig(threadId);

    try {
      const state = await this.graph.invoke(
        { messages: [new HumanMessage(input.message)] },
        config,
      );

      const messages = state.messages as BaseMessage[];
      const finalMessage = findFinalAssistantMessage(messages);

      if (!finalMessage) {
        throw new Error('Agent finished without a final assistant message');
      }

      return {
        threadId,
        message: toChatMessage(finalMessage),
        iterations: state.iterations,
        usage: extractUsage(finalMessage),
      };
    } catch (error) {
      this.logger.error(
        `Agent run failed for thread ${threadId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new BadGatewayException(FRIENDLY_ERROR);
    }
  }

  async *stream(input: RunAgentInput, signal: AbortSignal): AsyncGenerator<AgentStreamEvent> {
    const threadId = input.threadId ?? randomUUID();
    const startedAt = Date.now();

    yield {
      type: 'meta',
      threadId,
      provider: this.chatModel.provider,
      model: this.chatModel.modelName,
    };

    try {
      const events = this.graph.streamEvents(
        { messages: [new HumanMessage(input.message)] },
        {
          version: 'v2',
          configurable: { thread_id: threadId },
          recursionLimit: this.recursionLimit,
          signal,
        },
      );

      for await (const event of events) {
        if (signal.aborted) return;

        switch (event.event) {
          case 'on_chat_model_stream': {
            const token = contentToText(event.data.chunk?.content);
            if (token) {
              yield { type: 'token', content: token };
            }
            break;
          }
          case 'on_tool_start': {
            yield {
              type: 'tool_start',
              name: event.name,
              input: event.data.input,
            };
            break;
          }
          case 'on_tool_end': {
            yield {
              type: 'tool_end',
              name: event.name,
              output: contentToText(
                (event.data.output as { content?: unknown } | undefined)?.content ??
                  event.data.output,
              ),
            };
            break;
          }
          default:
            break;
        }
      }

      const snapshot = await this.graph.getState({
        configurable: { thread_id: threadId },
      });
      const messages = snapshot.values.messages as BaseMessage[];
      const finalMessage = findFinalAssistantMessage(messages);

      yield {
        type: 'done',
        threadId,
        message: finalMessage ? toChatMessage(finalMessage) : { role: 'assistant', content: '' },
        iterations: snapshot.values.iterations,
        usage: extractUsage(finalMessage),
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return;
      }

      this.logger.error(
        `Streaming agent run failed for thread ${threadId}`,
        error instanceof Error ? error.stack : String(error),
      );
      yield { type: 'error', message: FRIENDLY_ERROR };
    }
  }

  async getHistory(threadId: string): Promise<ThreadHistory> {
    const snapshot = await this.graph.getState({
      configurable: { thread_id: threadId },
    });
    const messages = (snapshot.values.messages ?? []) as BaseMessage[];

    return {
      threadId,
      exists: messages.length > 0,
      messages: messages.map(toChatMessage),
      createdAt: snapshot.createdAt,
      next: snapshot.next,
    };
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.checkpointer.checkpointer.deleteThread(threadId);
  }

  private get recursionLimit(): number {
    return this.maxIterations * 2 + 5;
  }

  private threadConfig(threadId: string) {
    return {
      configurable: { thread_id: threadId },
      recursionLimit: this.recursionLimit,
    };
  }
}
