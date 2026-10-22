import { AIMessage, type BaseMessage, type MessageContent } from '@langchain/core/messages';
import type { ChatMessage, ChatRole, TokenUsage, ToolCall } from './agent.types.js';

export function contentToText(content: MessageContent | unknown): string {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (
          part &&
          typeof part === 'object' &&
          'type' in part &&
          part.type === 'text' &&
          'text' in part &&
          typeof part.text === 'string'
        ) {
          return part.text;
        }
        return '';
      })
      .join(' ')
      .trim();
  }

  if (content == null) return '';
  return String(content);
}

function roleFromMessage(message: BaseMessage): ChatRole {
  switch (message.getType()) {
    case 'human':
      return 'user';
    case 'ai':
      return 'assistant';
    case 'system':
      return 'system';
    default:
      return 'tool';
  }
}

export function toChatMessage(message: BaseMessage): ChatMessage {
  const role = roleFromMessage(message);
  const chatMessage: ChatMessage = {
    role,
    content: contentToText(message.content),
  };

  if (message.name) {
    chatMessage.name = message.name;
  }

  if (AIMessage.isInstance(message) && message.tool_calls?.length) {
    chatMessage.toolCalls = message.tool_calls.map((call): ToolCall => ({
      id: call.id ?? '',
      name: call.name,
      args: (call.args ?? {}) as Record<string, unknown>,
    }));
  }

  return chatMessage;
}

export function findFinalAssistantMessage(messages: BaseMessage[]): AIMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      AIMessage.isInstance(message) &&
      !message.tool_calls?.length &&
      contentToText(message.content).trim().length > 0
    ) {
      return message;
    }
  }

  return undefined;
}

export function extractUsage(message: BaseMessage | undefined): TokenUsage | undefined {
  if (!message || !AIMessage.isInstance(message) || !message.usage_metadata) {
    return undefined;
  }

  const usage = message.usage_metadata;

  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
}
