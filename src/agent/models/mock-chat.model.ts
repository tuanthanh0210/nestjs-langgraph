import { randomUUID } from 'node:crypto';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
  type MessageContent,
  ToolMessage,
} from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';
import { evaluateExpression } from '../../tools/expression-evaluator.js';

function messageText(content: MessageContent): string {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part.type === 'text' && typeof part.text === 'string') return part.text;
        return '';
      })
      .join(' ')
      .trim();
  }

  return '';
}

function isVietnamese(text: string): boolean {
  return /[ăâđêôơư]|[àáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i.test(text);
}

function hasBalancedParentheses(value: string): boolean {
  let balance = 0;
  for (const char of value) {
    if (char === '(') balance += 1;
    if (char === ')') balance -= 1;
    if (balance < 0) return false;
  }
  return balance === 0;
}

/**
 * Finds the longest arithmetic-looking substring that the real calculator can
 * actually evaluate. Used only by the mock model to decide when to call a tool.
 */
function extractExpression(text: string): string | undefined {
  const candidates = text.match(/[0-9().+\-*/%^\s]{3,}/g) ?? [];
  const usable = candidates
    .map((candidate) => candidate.trim())
    .filter(
      (candidate) =>
        /\d/.test(candidate) && /[+\-*/%^]/.test(candidate) && hasBalancedParentheses(candidate),
    )
    .sort((a, b) => b.length - a.length);

  for (const candidate of usable) {
    try {
      evaluateExpression(candidate);
      return candidate;
    } catch {
      // Not a valid expression — try the next candidate.
    }
  }

  return undefined;
}

function extractLocation(text: string): string {
  const patterns = [
    /(?:weather|temperature|forecast)\s+(?:in|at|for)\s+([^?.!,]+)/i,
    /(?:thời tiết|nhiệt độ|dự báo)\s+(?:ở|tại|cho)\s+([^?.!,]+)/i,
    /thời tiết\s+([^?.!,]+)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const location = match?.[1]?.trim();
    if (location) {
      return location
        .replace(/\s+(hôm nay|today|now|hiện tại|thế nào|ra sao|how is it).*$/i, '')
        .trim();
    }
  }

  return 'Ho Chi Minh City';
}

interface PlannedToolCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Deterministic, offline chat model used when `LLM_PROVIDER=mock` (the default
 * when no API key is configured).
 *
 * It implements the same tool-calling contract as a real chat model, so the
 * whole LangGraph loop — model → tool node → model → answer — can be exercised
 * without network access or credentials. Replace it with ChatOpenAI for real
 * reasoning.
 */
export class MockChatModel extends BaseChatModel {
  constructor() {
    super({});
  }

  _llmType(): string {
    return 'mock';
  }

  private planToolCall(messages: BaseMessage[]): PlannedToolCall | undefined {
    const lastHumanIndex = messages.map((message) => message.getType()).lastIndexOf('human');
    const userText = messageText(messages[lastHumanIndex]?.content ?? '');
    const lower = userText.toLowerCase();

    if (/weather|temperature|forecast|thời tiết|nhiệt độ|dự báo/.test(lower)) {
      return { name: 'get_weather', args: { location: extractLocation(userText) } };
    }

    if (
      /(what|current).*(time|date)|mấy giờ|giờ rồi|ngày mấy|thứ mấy|thời gian hiện tại/.test(lower)
    ) {
      return {
        name: 'current_time',
        args: { timezone: isVietnamese(userText) ? 'Asia/Ho_Chi_Minh' : 'UTC' },
      };
    }

    const expression = extractExpression(userText);
    if (expression) {
      return { name: 'calculator', args: { expression } };
    }

    return undefined;
  }

  private toolMessagesSinceHuman(messages: BaseMessage[]): ToolMessage[] {
    const lastHumanIndex = messages.map((message) => message.getType()).lastIndexOf('human');
    return messages
      .slice(lastHumanIndex + 1)
      .filter((message): message is ToolMessage => message.getType() === 'tool');
  }

  private buildMessage(messages: BaseMessage[]): AIMessage {
    const lastHumanIndex = messages.map((message) => message.getType()).lastIndexOf('human');
    const userText = messageText(messages[lastHumanIndex]?.content ?? '');
    const vietnamese = isVietnamese(userText);
    const toolMessages = this.toolMessagesSinceHuman(messages);

    if (toolMessages.length > 0) {
      const results = toolMessages
        .map((message) => `\`${message.name ?? 'tool'}\`: ${messageText(message.content)}`)
        .join('\n');

      return new AIMessage({
        content: vietnamese
          ? `Kết quả từ công cụ:\n${results}\n\n_(Đây là mock model — đặt \`LLM_PROVIDER=openai\` để có câu trả lời do LLM thật tổng hợp.)_`
          : `Tool result:\n${results}\n\n_(This is the mock model — set \`LLM_PROVIDER=openai\` for a real LLM-written answer.)_`,
        usage_metadata: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        },
      });
    }

    const planned = this.planToolCall(messages);

    if (planned) {
      return new AIMessage({
        content: '',
        tool_calls: [
          {
            id: randomUUID(),
            name: planned.name,
            args: planned.args,
          },
        ],
        usage_metadata: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        },
      });
    }

    return new AIMessage({
      content: vietnamese
        ? 'Chế độ **mock** đang bật, nên em chưa gọi LLM thật. Em vẫn có thể minh hoạ vòng lặp agent với 3 công cụ:\n\n' +
          '• `calculator` — thử “Tính 12 * (3 + 1)”\n' +
          '• `current_time` — thử “Mấy giờ rồi?”\n' +
          '• `get_weather` — thử “Thời tiết ở Hà Nội”\n\n' +
          'Để dùng LLM thật, đặt `LLM_PROVIDER=openai` và `OPENAI_API_KEY` trong file `.env`, sau đó khởi động lại.'
        : 'The **mock** provider is active, so no real LLM is being called. The agent loop still works with 3 tools:\n\n' +
          '• `calculator` — try “Calculate 12 * (3 + 1)”\n' +
          '• `current_time` — try “What time is it?”\n' +
          '• `get_weather` — try “What is the weather in Hanoi?”\n\n' +
          'To use a real model, set `LLM_PROVIDER=openai` and `OPENAI_API_KEY` in `.env`, then restart.',
      usage_metadata: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      },
    });
  }

  async _generate(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const message = this.buildMessage(messages);
    const text = messageText(message.content);

    return {
      generations: [{ text, message }],
      llmOutput: { model: 'mock-agent' },
    };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const message = this.buildMessage(messages);
    const text = messageText(message.content);

    options.signal?.throwIfAborted();

    if (message.tool_calls?.length) {
      yield new ChatGenerationChunk({
        message: new AIMessageChunk({
          content: '',
          tool_call_chunks: message.tool_calls.map((call, index) => ({
            name: call.name,
            args: JSON.stringify(call.args),
            id: call.id,
            index,
            type: 'tool_call_chunk',
          })),
          usage_metadata: message.usage_metadata,
        }),
        text: '',
      });
      return;
    }

    for (const part of text.split(/(\s+)/).filter((value) => value.length > 0)) {
      options.signal?.throwIfAborted();
      const chunk = new ChatGenerationChunk({
        message: new AIMessageChunk({ content: part }),
        text: part,
      });

      yield chunk;

      // Required for LangGraph's `on_chat_model_stream` events (and LangSmith
      // token streaming). Real providers emit this callback themselves.
      await runManager?.handleLLMNewToken(part, undefined, undefined, undefined, undefined, {
        chunk,
      });
    }
  }
}
