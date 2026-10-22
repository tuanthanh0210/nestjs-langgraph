export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AgentRunResult {
  threadId: string;
  message: ChatMessage;
  iterations: number;
  usage?: TokenUsage;
}

export interface StoreInfo {
  name: string;
  hotline?: string;
  email?: string;
  address?: string;
}

export interface CatalogInfo {
  products: number;
  categories: string[];
}

export interface AgentInfo {
  provider: 'openai' | 'gemini' | 'mock';
  model: string;
  persistence: 'memory' | 'postgres';
  maxIterations: number;
  store: StoreInfo;
  catalog: CatalogInfo;
  tools: Array<{ name: string; description: string }>;
}

export interface ThreadHistory {
  threadId: string;
  exists: boolean;
  messages: ChatMessage[];
  createdAt?: string;
  next: string[];
}

export type AgentStreamEvent =
  | {
      type: 'meta';
      threadId: string;
      provider: 'openai' | 'gemini' | 'mock';
      model: string;
    }
  | { type: 'token'; content: string }
  | { type: 'tool_start'; name: string; input: unknown }
  | { type: 'tool_end'; name: string; output: string }
  | {
      type: 'done';
      threadId: string;
      message: ChatMessage;
      iterations: number;
      usage?: TokenUsage;
      durationMs: number;
    }
  | { type: 'error'; message: string };
