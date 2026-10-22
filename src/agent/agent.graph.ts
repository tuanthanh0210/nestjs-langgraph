import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
  SystemMessage,
} from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import {
  Annotation,
  type BaseCheckpointSaver,
  END,
  messagesStateReducer,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';

/**
 * Graph state.
 *
 * `messages` is the conversation channel, reduced with LangGraph's message
 * reducer (append + dedupe by id + RemoveMessage support). `iterations` counts
 * model calls and is used by the loop guard.
 */
const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[], BaseMessage | BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  iterations: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => 0,
  }),
});

export type AgentGraphState = typeof AgentState.State;

export interface CreateAgentGraphOptions {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  checkpointer: BaseCheckpointSaver;
  systemPrompt: () => string;
  maxIterations: number;
}

/**
 * The agent loop:
 *
 *   START → agent ──(tool calls & budget left)──→ tools → agent → …
 *              └──(final answer)──────────────────────────────→ END
 *              └──(budget exhausted)──→ limit ─────────────────→ END
 *
 * This is deliberately a hand-written StateGraph rather than a prebuilt helper:
 * it is the extension point where you add routing, sub-agents, approvals or
 * human-in-the-loop interrupts.
 */
export function createAgentGraph(options: CreateAgentGraphOptions) {
  const { model, tools, checkpointer, systemPrompt, maxIterations } = options;
  const modelWithTools = model.bindTools ? model.bindTools(tools) : model;
  const toolNode = new ToolNode(tools, { handleToolErrors: true });

  const callModel = async (state: AgentGraphState, config?: RunnableConfig) => {
    const input = [new SystemMessage(systemPrompt()), ...state.messages];

    // Stream inside the node and aggregate the chunks. Streaming at the graph
    // level (streamEvents) then surfaces token events even for models that do
    // not stream from `invoke()` — including the offline mock model.
    const stream = await modelWithTools.stream(input, config);
    let aggregated: AIMessageChunk | undefined;

    for await (const chunk of stream) {
      const aiChunk = chunk as AIMessageChunk;
      aggregated = aggregated ? (aggregated.concat(aiChunk) as AIMessageChunk) : aiChunk;
    }

    if (!aggregated) {
      throw new Error('The chat model returned an empty stream');
    }

    const message = new AIMessage({
      content: aggregated.content,
      tool_calls: aggregated.tool_calls,
      invalid_tool_calls: aggregated.invalid_tool_calls,
      usage_metadata: aggregated.usage_metadata,
      additional_kwargs: aggregated.additional_kwargs,
      response_metadata: aggregated.response_metadata,
      id: aggregated.id,
    });

    return {
      messages: [message],
      iterations: state.iterations + 1,
    };
  };

  const routeAfterAgent = (state: AgentGraphState): 'tools' | 'limit' | typeof END => {
    const lastMessage = state.messages.at(-1);

    if (!AIMessage.isInstance(lastMessage) || !lastMessage.tool_calls?.length) {
      return END;
    }

    return state.iterations >= maxIterations ? 'limit' : 'tools';
  };

  const stopAtLimit = async () => ({
    messages: [
      new AIMessage(
        `I stopped after ${maxIterations} reasoning steps to avoid an infinite loop. ` +
          'Please refine the request or raise AGENT_MAX_ITERATIONS.',
      ),
    ],
  });

  return new StateGraph(AgentState)
    .addNode('agent', callModel)
    .addNode('tools', toolNode)
    .addNode('limit', stopAtLimit)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', routeAfterAgent, ['tools', 'limit', END])
    .addEdge('tools', 'agent')
    .addEdge('limit', END)
    .compile({ checkpointer });
}

export type AgentGraph = ReturnType<typeof createAgentGraph>;
