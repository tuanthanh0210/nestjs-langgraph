# NestJS × LangGraph — Agentic AI Starter

Một repo khởi đầu **chạy được ngay** để xây app AI agentic bằng **NestJS 12 + LangGraph 1.x + TypeScript**, có tool calling, memory theo thread, streaming SSE, Postgres checkpointer, Swagger và giao diện chat demo.

> Trạng thái: đã build, lint, typecheck và test (unit + e2e) pass. Chạy được **không cần API key** ở chế độ mock.

![Demo UI](docs/screenshot.png)

![Chat with a tool call](docs/screenshot-chat.png)

---

## Mục lục

- [Có gì trong repo](#có-gì-trong-repo)
- [Kiến trúc](#kiến-trúc)
- [Chạy nhanh](#chạy-nhanh)
- [Dùng LLM thật](#dùng-llm-thật)
- [API](#api)
- [LangGraph hoạt động thế nào](#langgraph-hoạt-động-thế-nào)
- [Thêm tool mới](#thêm-tool-mới)
- [Memory & Postgres](#memory--postgres)
- [Cấu hình](#cấu-hình)
- [Test](#test)
- [Docker](#docker)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Lên production](#lên-production)
- [Troubleshooting](#troubleshooting)

---

## Có gì trong repo

| Thành phần | Mô tả |
| --- | --- |
| **Agentic loop** | `StateGraph` tự viết: `agent → tools → agent …`, có guard chống lặp vô hạn |
| **Tool calling** | `calculator`, `current_time`, `get_weather` (Open-Meteo, không cần key) |
| **Streaming** | SSE: `meta`, `token`, `tool_start`, `tool_end`, `done`, `error` |
| **Memory** | LangGraph checkpointer theo `thread_id`; in-memory hoặc Postgres |
| **API** | REST + SSE, DTO validation, Swagger tại `/docs` |
| **Demo UI** | Chat UI tại `/ui/`: streaming, tool cards, thread persistence, mock banner |
| **Chế độ mock** | Model offline deterministic — boot/test ngay không cần credential |
| **Chất lượng** | TypeScript strict, ESLint, Prettier, unit test + e2e test (Vitest) |
| **Hạ tầng** | Dockerfile multi-stage, `docker-compose.yml` (app + Postgres) |
| **Tracing** | Hỗ trợ LangSmith qua biến môi trường |

Điểm quan trọng: phần orchestration nằm ở [`agent.graph.ts`](src/agent/agent.graph.ts) và được viết bằng `StateGraph` thuần, không phải helper “hộp đen”. Đây là nơi bạn thêm routing, sub-agent, human-in-the-loop hoặc retry policy.

---

## Kiến trúc

```mermaid
flowchart LR
  A([START]) --> B[agent node<br/>LLM + tools]
  B -->|có tool_calls<br/>và còn budget| C[tools node<br/>ToolNode]
  C --> B
  B -->|câu trả lời cuối| D([END])
  B -->|hết maxIterations| E[limit node] --> D
```

```text
Browser / Client
      │  HTTP + SSE
      ▼
NestJS Controller  ── ValidationPipe ──►  AgentService
                                              │
                                              ▼
                                    LangGraph StateGraph
                                    ├─ agent  (ChatOpenAI | Mock)
                                    ├─ tools  (ToolNode)
                                    └─ limit  (loop guard)
                                              │
                                              ▼
                              Checkpointer (Memory | Postgres)
```

**Luồng một request**

1. `POST /api/agent/chat` (hoặc `/chat/stream`) → `ValidationPipe` kiểm tra DTO.
2. `AgentService` tạo/định danh `thread_id`, nạp state cũ từ checkpointer.
3. Node `agent` gọi model kèm system prompt + tool schemas + lịch sử.
4. Nếu model trả `tool_calls`, conditional edge chuyển sang node `tools`; `ToolNode` chạy song song các tool, ghi kết quả dưới dạng `ToolMessage`.
5. Quay lại `agent` cho tới khi có câu trả lời cuối hoặc hết `AGENT_MAX_ITERATIONS`.
6. Mỗi bước được checkpointer lưu lại; response trả `threadId` để client dùng cho lượt sau.

---

## Chạy nhanh

**Yêu cầu:** Node.js ≥ 22.12, pnpm 11.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Mở:

- Demo UI: <http://localhost:3000> (redirect sang `/ui/`)
- Swagger: <http://localhost:3000/docs>
- Health: <http://localhost:3000/api/health>

Mặc định `.env.example` đặt `LLM_PROVIDER=mock`. Agent vẫn thực hiện **đúng vòng lặp tool thật**:

- “Tính 12 * (3 + 1) giúp anh” → gọi `calculator`
- “Mấy giờ ở Hà Nội rồi?” → gọi `current_time`
- “Thời tiết ở Hà Nội hôm nay?” → gọi `get_weather`

Mock model trả lời theo kịch bản cố định và không gọi mạng; riêng tool `get_weather` gọi Open-Meteo nên cần internet. Đổi sang LLM thật ở bước dưới.

---

## Dùng LLM thật

Repo dùng `ChatOpenAI`, nên **mọi endpoint OpenAI-compatible** đều chạy được.

### OpenAI

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

### DeepSeek

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-chat
```

### OpenRouter

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-or-v1-...
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=anthropic/claude-sonnet-4
```

### Ollama (local)

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=ollama
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_MODEL=llama3.1
```

> Model phải hỗ trợ **tool calling**. Nếu không, agent vẫn trả lời nhưng sẽ không gọi được tool.

Sau khi sửa `.env`, restart `pnpm dev`. UI sẽ hiện badge `openai · <model>` thay vì `mock`.

---

## API

Base URL: `http://localhost:3000`

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness probe |
| `GET` | `/api/agent/info` | Provider, model, persistence, danh sách tool |
| `POST` | `/api/agent/chat` | Chạy agent, trả câu trả lời cuối |
| `POST` | `/api/agent/chat/stream` | Chạy agent, stream SSE |
| `GET` | `/api/agent/threads/:threadId` | Lịch sử hội thoại |
| `DELETE` | `/api/agent/threads/:threadId` | Xoá thread + checkpoints |

### Chat (JSON)

```bash
curl -s http://localhost:3000/api/agent/chat \
  -H 'content-type: application/json' \
  -d '{"message":"Tính 12 * (3 + 1) giúp anh"}'
```

```json
{
  "threadId": "6f1a9d6e-3a7b-4f1e-9c2a-4d2e8b7c1a90",
  "message": {
    "role": "assistant",
    "content": "Kết quả là 48."
  },
  "iterations": 2,
  "usage": { "inputTokens": 812, "outputTokens": 96, "totalTokens": 908 }
}
```

Gửi lại `threadId` để nối tiếp hội thoại:

```bash
curl -s http://localhost:3000/api/agent/chat \
  -H 'content-type: application/json' \
  -d '{"message":"Còn 3 * 3 thì sao?","threadId":"6f1a9d6e-3a7b-4f1e-9c2a-4d2e8b7c1a90"}'
```

### Chat (SSE)

```bash
curl -N http://localhost:3000/api/agent/chat/stream \
  -H 'content-type: application/json' \
  -d '{"message":"Mấy giờ ở Hà Nội rồi?"}'
```

```text
event: meta
data: {"type":"meta","threadId":"…","provider":"openai","model":"gpt-4o-mini"}

event: tool_start
data: {"type":"tool_start","name":"current_time","input":{"timezone":"Asia/Ho_Chi_Minh"}}

event: tool_end
data: {"type":"tool_end","name":"current_time","output":"{…}"}

event: token
data: {"type":"token","content":"Bây"}

event: done
data: {"type":"done","threadId":"…","message":{…},"iterations":2,"usage":{…},"durationMs":1840}
```

Mỗi frame có cả `event:` và JSON `type` để client dùng `EventSource` hoặc `fetch` stream đều được.

### Lịch sử & xoá thread

```bash
curl -s http://localhost:3000/api/agent/threads/<threadId>
curl -s -X DELETE http://localhost:3000/api/agent/threads/<threadId>
```

`threadId` do server sinh (UUID) nếu client không truyền. Chỉ chấp nhận `[A-Za-z0-9_-]{1,128}`.

---

## LangGraph hoạt động thế nào

### 1. State có reducer

[`src/agent/agent.graph.ts`](src/agent/agent.graph.ts):

```ts
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
```

- `messages` dùng `messagesStateReducer`: append message mới, dedupe theo id, hỗ trợ `RemoveMessage`.
- `iterations` là bộ đếm model calls, dùng cho loop guard.

### 2. Node và conditional edge

```ts
new StateGraph(AgentState)
  .addNode('agent', callModel)
  .addNode('tools', toolNode)
  .addNode('limit', stopAtLimit)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', routeAfterAgent, ['tools', 'limit', END])
  .addEdge('tools', 'agent')
  .addEdge('limit', END)
  .compile({ checkpointer });
```

`routeAfterAgent` kiểm tra **message cuối có `tool_calls` không** và **đã chạm `AGENT_MAX_ITERATIONS` chưa**. Đây là guard bắt buộc với mọi agent loop.

### 3. Streaming-first

Node `agent` gọi `model.stream()` rồi aggregate chunks, thay vì `invoke()`. Nhờ vậy `graph.streamEvents(..., { version: 'v2' })` phát ra `on_chat_model_stream` cho **mọi** model — kể cả mock model — và SSE có token theo thời gian thực.

### 4. Checkpointer = bộ nhớ hội thoại

Mỗi run truyền `configurable.thread_id`; checkpointer lưu toàn bộ state sau từng super-step. Lượt sau chỉ cần gửi thêm `HumanMessage`, graph tự nối lịch sử. Không cần tự quản lý mảng messages trong DB.

Muốn thêm long-term memory (facts xuyên thread), thêm LangGraph `Store` — điểm mở rộng tự nhiên là `AgentService`/`createAgentGraph`.

---

## Thêm tool mới

Ví dụ tool tra tỷ giá (minh hoạ cấu trúc):

```ts
// src/tools/exchange-rate.tool.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const exchangeRateTool = tool(
  async ({ base, quote }) => {
    const response = await fetch(`https://api.example.com/rate?from=${base}&to=${quote}`);
    if (!response.ok) return `Lookup failed with HTTP ${response.status}`;
    const data = (await response.json()) as { rate: number };
    return `1 ${base} = ${data.rate} ${quote}`;
  },
  {
    name: 'get_exchange_rate',
    description: 'Get the current exchange rate between two currencies.',
    schema: z.object({
      base: z.string().length(3).describe('ISO 4217 code, e.g. USD'),
      quote: z.string().length(3).describe('ISO 4217 code, e.g. VND'),
    }),
  },
);
```

Đăng ký trong [`src/tools/tools.service.ts`](src/tools/tools.service.ts):

```ts
this.toolList = [
  calculatorTool,
  createCurrentTimeTool(timezone),
  weatherTool,
  exchangeRateTool, // ← thêm ở đây
] as unknown as StructuredToolInterface[];
```

Graph, API và UI tự nhận tool mới. Lưu ý:

- `description` và `.describe()` là một phần prompt — viết rõ để model chọn đúng tool.
- Tool nên **trả về string** (hoặc nội dung serialize được) và **không throw** ra ngoài; trả message lỗi để agent tự xử lý. `ToolNode` đang bật `handleToolErrors: true`.
- Không đặt secret trong mô tả tool.

Đổi prompt: sửa [`agent.prompt.ts`](src/agent/agent.prompt.ts) hoặc đặt `AGENT_SYSTEM_PROMPT` trong `.env`. Prompt runtime (ngày giờ, budget) luôn được nối thêm.

---

## Memory & Postgres

Mặc định `DATABASE_URL` trống → `MemorySaver` (mất lịch sử khi restart, phù hợp dev/test).

Bật persistence thật:

```bash
docker compose up -d db
```

```dotenv
DATABASE_URL=postgresql://agent:agent@localhost:5432/agent
```

Restart app. `PostgresSaver.setup()` tự tạo schema/tables (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations`) — idempotent, chạy mỗi lần boot.

Kiểm tra:

```bash
curl -s http://localhost:3000/api/agent/info   # persistence: "postgres"
```

Lưu ý vận hành:

- Connection pool mặc định 10 (`DB_POOL_MAX`).
- Dùng managed Postgres thì thêm `?sslmode=require` vào URL nếu provider yêu cầu.
- Checkpoint có thể lớn theo độ dài hội thoại; với app thật nên có retention/cleanup hoặc tóm tắt lịch sử.
- `DELETE /api/agent/threads/:id` gọi `checkpointer.deleteThread()`.

---

## Cấu hình

Tất cả biến được validate bằng Zod khi boot ([`src/config/env.validation.ts`](src/config/env.validation.ts)). Sai định dạng → app fail-fast với message rõ ràng.

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `PORT` | `3000` | HTTP port |
| `CORS_ORIGINS` | `*` | Danh sách origin, phân tách bằng dấu phẩy |
| `LLM_PROVIDER` | auto | `openai` hoặc `mock`; auto = openai nếu có key, ngược lại mock |
| `OPENAI_API_KEY` | — | Bắt buộc khi provider `openai` |
| `OPENAI_BASE_URL` | — | Endpoint OpenAI-compatible |
| `OPENAI_MODEL` | `gpt-4o-mini` | Tên model |
| `LLM_TEMPERATURE` | `0.2` | 0–2 |
| `LLM_MAX_TOKENS` | `1024` | Giới hạn output |
| `AGENT_MAX_ITERATIONS` | `8` | Số model call tối đa mỗi run (1–20) |
| `AGENT_SYSTEM_PROMPT` | built-in | Override system prompt |
| `DEFAULT_TIMEZONE` | `Asia/Ho_Chi_Minh` | Timezone mặc định cho tool thời gian |
| `DATABASE_URL` | — | Bật Postgres checkpointer |
| `DB_POOL_MAX` | `10` | Pool size |
| `SWAGGER_ENABLED` | `true` | Bật/tắt `/docs` |
| `LANGCHAIN_TRACING_V2` | — | `true` để bật LangSmith |
| `LANGCHAIN_API_KEY` | — | LangSmith API key |
| `LANGCHAIN_PROJECT` | — | Tên project trên LangSmith |

---

## Test

```bash
pnpm test        # unit (evaluator, …)
pnpm test:e2e    # boot Nest app + gọi API thật qua supertest
pnpm test:cov    # coverage
pnpm lint
pnpm typecheck
pnpm build
```

E2E ([`test/agent.e2e-spec.ts`](test/agent.e2e-spec.ts)) chạy với `LLM_PROVIDER=mock`, `DATABASE_URL` rỗng và cover:

- health + info
- chat gọi tool và trả kết quả
- multi-turn memory + history + delete
- SSE có `meta`, `tool_start`, `token`, `done`
- validation body/param (400)

Evaluator test ([`expression-evaluator.spec.ts`](src/tools/expression-evaluator.spec.ts)) đảm bảo calculator **không dùng `eval()`** và chặn input độc hại.

---

## Docker

Chạy full stack (app + Postgres):

```bash
cp .env.example .env
docker compose up --build
```

- UI: <http://localhost:3000/ui/>
- API docs: <http://localhost:3000/docs>
- Compose tự set `DATABASE_URL` trỏ tới service `db`.

Chỉ chạy Postgres cho dev local:

```bash
docker compose up -d db
```

Sau đó đặt `DATABASE_URL=postgresql://agent:agent@localhost:5432/agent` trong `.env`.

Dockerfile là multi-stage, chạy bằng user `node`, có healthcheck.

---

## Cấu trúc thư mục

```text
src/
├── main.ts                     # bootstrap HTTP
├── app.module.ts               # Config, static UI, health, agent
├── app.setup.ts                # pipes/CORS/Swagger dùng chung cho main + e2e
├── config/
│   └── env.validation.ts       # schema Zod cho toàn bộ env
├── agent/
│   ├── agent.controller.ts     # REST + SSE endpoints
│   ├── agent.service.ts        # chạy graph, history, stream, lỗi
│   ├── agent.graph.ts          # StateGraph, nodes, conditional edges
│   ├── agent.prompt.ts         # system prompt + runtime context
│   ├── agent.types.ts          # DTO/event types
│   ├── chat-model.service.ts   # ChatOpenAI hoặc MockChatModel
│   ├── checkpointer.service.ts # MemorySaver / PostgresSaver
│   ├── message.utils.ts        # map message → JSON, usage, final answer
│   ├── models/
│   │   └── mock-chat.model.ts  # model offline deterministic
│   └── dto/                    # request/response DTO + Swagger decorators
├── tools/
│   ├── calculator.tool.ts
│   ├── current-time.tool.ts
│   ├── weather.tool.ts
│   ├── expression-evaluator.ts # parser an toàn, không eval()
│   └── tools.service.ts        # registry duy nhất
└── health/
public/index.html              # demo chat UI (không build step)
test/agent.e2e-spec.ts
```

**Vì sao import có đuôi `.js`?** NestJS 12 dùng ESM (`"type": "module"`). TypeScript NodeNext yêu cầu relative import ghi rõ `.js` dù source là `.ts`. Đừng xoá đuôi này.

---

## Lên production

Repo này là **starter**, chưa kèm auth. Trước khi public:

1. **Auth**: thêm API key/JWT guard cho `/api/agent/*`; truyền user id vào thread metadata để tránh lộ chéo hội thoại.
2. **Rate limit**: `@nestjs/throttler` theo IP/user; giới hạn độ dài message và số thread.
3. **Persistence**: bật `DATABASE_URL`, backup, retention cho checkpoints; không dùng `MemorySaver`.
4. **CORS**: đặt origin cụ thể, không để `*` nếu có cookie/auth.
5. **Observability**: bật LangSmith, log `threadId`/latency/token usage, thêm metrics + tracing.
6. **Resilience**: timeout cho tool HTTP, retry có giới hạn, circuit breaker cho provider; giữ `AGENT_MAX_ITERATIONS` thấp.
7. **SSE qua proxy**: tắt buffering (`proxy_buffering off` với nginx); app đã set `X-Accel-Buffering: no`. Tăng idle timeout của LB.
8. **Secrets**: inject qua secret manager, không commit `.env`.
9. **Cost**: đặt `LLM_MAX_TOKENS`, theo dõi usage, có thể chọn model rẻ cho routing và model mạnh cho câu trả lời.

Gợi ý mở rộng kiến trúc:

- **Human-in-the-loop**: dùng `interrupt()` trước tool nguy hiểm (write DB, gửi email) và resume bằng `Command`.
- **Multi-agent**: thêm subgraph (researcher/critic) làm node; giữ supervisor graph nhỏ.
- **RAG**: thêm retriever tool (pgvector) — giữ nguyên contract `tool()`.
- **Structured output**: dùng `withStructuredOutput()` ở một node riêng.
- **Long-term memory**: LangGraph `Store` + namespace theo user.

---

## Troubleshooting

| Lỗi | Nguyên nhân / cách xử lý |
| --- | --- |
| `OPENAI_API_KEY is required when LLM_PROVIDER=openai` | Đặt key, hoặc đổi `LLM_PROVIDER=mock` |
| `401` / `invalid_api_key` từ provider | Key sai/hết hạn; kiểm tra `OPENAI_BASE_URL` có đúng `/v1` |
| Agent không gọi tool | Model không hỗ trợ tool calling, hoặc `description`/schema chưa đủ rõ |
| `Weather lookup failed` | Máy không có internet hoặc Open-Meteo timeout; tool trả lỗi để agent xử lý |
| SSE chỉ hiện một cục text | Proxy đang buffer; tắt buffering hoặc kiểm tra `Content-Type: text/event-stream` |
| Mất lịch sử sau restart | Đang dùng `MemorySaver`; set `DATABASE_URL` |
| `ERR_MODULE_NOT_FOUND` | Thiếu đuôi `.js` ở relative import (ESM) |
| `[ERR_PNPM_IGNORED_BUILDS]` | Cảnh báo build script của dependency; có thể chạy `pnpm approve-builds` nếu cần |
| Port 3000 đã dùng | `PORT=3100 pnpm dev` |

---

## License

MIT — xem [LICENSE](LICENSE).
