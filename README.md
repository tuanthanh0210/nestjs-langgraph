# NestShop — AI Sales Agent (NestJS × LangGraph)

Agent tư vấn bán hàng chạy thật: đọc **file sản phẩm**, tư vấn theo nhu cầu/ngân sách, trả lời chính sách, hỏi **tên + SĐT + địa chỉ**, tính phí giao hàng và **chốt đơn sau khi khách xác nhận**.

Repo dùng **NestJS 12 + LangGraph 1.x + TypeScript**, có SSE streaming, Swagger, demo UI, Postgres checkpointer, Docker và test.

> Đã verify: build, lint, typecheck, 32 unit test, 8 e2e test, Docker image + compose (app/Postgres) healthy.

![Demo UI](docs/screenshot.png)

![Chat tư vấn sản phẩm](docs/screenshot-chat.png)

---

## Mục lục

- [Bài toán & phạm vi](#bài-toán--phạm-vi)
- [Chạy nhanh](#chạy-nhanh)
- [Thay file sản phẩm](#thay-file-sản-phẩm)
- [Sửa chính sách cửa hàng](#sửa-chính-sách-cửa-hàng)
- [Kiến trúc](#kiến-trúc)
- [Luồng chốt đơn](#luồng-chốt-đơn)
- [API](#api)
- [Cấu hình](#cấu-hình)
- [Dữ liệu & quyền riêng tư](#dữ-liệu--quyền-riêng-tư)
- [Test](#test)
- [Docker](#docker)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Tùy chỉnh & mở rộng](#tùy-chỉnh--mở-rộng)
- [Troubleshooting](#troubleshooting)
- [Lên production](#lên-production)

---

## Bài toán & phạm vi

Agent này xử lý 4 nhóm việc:

1. **Tư vấn sản phẩm**: hỏi nhu cầu/ngân sách → tìm trong catalog → gợi ý 2–3 sản phẩm phù hợp kèm giá và tồn kho.
2. **Giải đáp thắc mắc**: giao hàng, đổi trả, bảo hành, thanh toán, bảo mật, liên hệ — lấy từ file chính sách của shop.
3. **Chốt đơn trong chat**: xác nhận sản phẩm/số lượng → thu thập tên, SĐT, địa chỉ → đọc lại tổng tiền → khách đồng ý → tạo đơn.
4. **Tra cứu đơn**: khách đọc mã đơn, agent kiểm tra trạng thái.

**Chưa có trong repo** (và đã ghi rõ ở phần production): thanh toán online, xác thực người dùng, huỷ/hoàn tiền tự động, đồng bộ tồn kho với POS/ERP, gửi SMS/Zalo. Đây là starter để anh gắn nghiệp vụ thật vào.

Điểm quan trọng: **file sản phẩm là nguồn sự thật duy nhất**. Agent không được bịa giá/tồn kho; mọi câu trả lời về sản phẩm đi qua tool `search_products` / `get_product`.

---

## Chạy nhanh

**Yêu cầu:** Node.js ≥ 22.12, pnpm 11.

```bash
cd /Users/thanhle/Desktop/nestjs-langgraph
pnpm install
cp .env.example .env
pnpm dev
```

Mở:

- UI: <http://localhost:3000> (redirect `/ui/`)
- Swagger: <http://localhost:3000/docs>
- Health: <http://localhost:3000/api/health>

Mặc định `.env.example` dùng `LLM_PROVIDER=mock` nên chạy được **không cần API key**. Thử lần lượt:

```text
Tư vấn tai nghe dưới 1 triệu giúp mình
Mình muốn mua SP001, tên: Nguyễn Văn A, sđt: 0901234567, địa chỉ: 123 Lê Lợi, Quận 1, TP.HCM
Đồng ý
```

Mock model sẽ: tìm sản phẩm → gọi `preview_order` → đọc lại tổng tiền → chờ khách xác nhận → gọi `create_order` và trả mã đơn. Với LLM thật, hội thoại tự nhiên hơn nhưng cùng một quy trình.

### Dùng LLM thật

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

### Google Gemini

Lấy key tại <https://aistudio.google.com/apikey>, rồi:

```dotenv
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
```

`gemini-2.5-flash` là mặc định (nhanh, rẻ, đủ tốt cho tư vấn/đặt hàng). Có thể đổi sang `gemini-2.5-pro` nếu cần suy luận sâu hơn.

### DeepSeek

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-chat
```

### Ollama / OpenRouter / vLLM / LiteLLM

Dùng `LLM_PROVIDER=openai` + `OPENAI_BASE_URL` trỏ tới endpoint tương thích OpenAI. Model cần hỗ trợ **tool calling**.

> Nếu bỏ trống `LLM_PROVIDER`: app tự chọn `openai` khi có `OPENAI_API_KEY`, ngược lại `gemini` khi có `GEMINI_API_KEY`, còn không có key nào thì `mock`.

---

## Thay file sản phẩm

Anh đặt file thật vào `data/products.csv` (hoặc trỏ `PRODUCTS_FILE` sang file khác). File mẫu hiện có 14 sản phẩm để chạy thử; thay nội dung là xong.

### Định dạng hỗ trợ

- **CSV** (dấu phẩy, chấm phẩy hoặc tab — tự nhận).
- **JSON**: mảng sản phẩm hoặc `{ "products": [...] }`.
- Excel: mở bằng Excel/Google Sheets → **Save as CSV UTF-8**, rồi thay file.
- Có hỗ trợ field có dấu phẩy, dấu ngoặc kép, xuống dòng trong ô (chuẩn CSV).

### Các cột

| Cột (chuẩn) | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `id` | Nên có | Mã ổn định, dùng để đặt hàng. Nếu thiếu, hệ thống tự sinh `SP001`, `SP002`… |
| `name` | **Có** | Tên sản phẩm |
| `price` | **Có** | Số tiền; hiểu `890.000`, `1,290,000`, `890000` |
| `stock` | Không | Số nguyên; để trống = không quản lý tồn kho; `0` = hết hàng |
| `description` | Không | Mô tả dài |
| `category` | Không | Mặc định `Khác` |
| `tags` | Không | Cách nhau bởi `,` `;` hoặc `|`, phục vụ tìm kiếm |
| `attributes` | Không | `Màu:Đen|Bảo hành:12 tháng` hoặc JSON object |
| `image_url` | Không | URL ảnh (UI hiện chưa render ảnh) |
| `currency` | Không | Mặc định `VND` |

**Tên cột tiếng Việt được nhận tự động**, ví dụ:

- `Mã sản phẩm`, `Mã`, `SKU`
- `Tên sản phẩm`, `Tên`
- `Mô tả`, `Thông tin`
- `Giá`, `Giá bán`
- `Danh mục`, `Loại`
- `Tồn kho`, `Số lượng`
- `Thuộc tính`, `Thông số`
- `Từ khóa`, `Tags`
- `Hình ảnh`, `Ảnh`

Cột lạ vẫn được giữ và đưa vào `attributes`, nên file hiện tại của anh không cần đổi ngay — chỉ cần có `tên` và `giá`.

Ví dụ:

```csv
Mã sản phẩm,Tên sản phẩm,Mô tả,Giá,Danh mục,Tags,Tồn kho,Thuộc tính
SP001,"Tai nghe Bluetooth AirBeat Pro","Tai nghe không dây chống ồn, pin 30 giờ.",890.000,Âm thanh,"tai nghe,bluetooth,chống ồn",25,"Màu sắc:Đen|Bảo hành:12 tháng"
```

### Quy tắc dữ liệu

- `id` phải **duy nhất**; trùng ID → app báo lỗi ngay khi boot.
- Dòng thiếu tên/giá sẽ bị bỏ qua kèm warning trong log.
- File phải có ít nhất 1 sản phẩm hợp lệ.
- Giá nên là số nguyên VND. Nếu shop dùng USD, đặt `currency=USD` và kiểm tra lại format.
- Sửa file xong **restart app** (Docker đang mount file read-only nên chỉ cần restart container).
- Đường dẫn mặc định: `./data/products.csv`; đổi bằng `PRODUCTS_FILE`.

Nếu file thật của anh có cấu trúc khác (nhiều sheet, biến thể, file Excel gốc), gửi em file/mẫu — em map loader và cột cho đúng.

---

## Sửa chính sách cửa hàng

`data/store-info.md` chứa chính sách và được tool `search_store_info` tra theo từ khóa. Các section dùng heading `##`:

```md
## Giao hàng
- Miễn phí giao hàng cho đơn từ 500.000₫.
- Đơn dưới 500.000₫: phí 30.000₫.

## Đổi trả và bảo hành
- Đổi mới trong 7 ngày nếu lỗi nhà sản xuất.
- Bảo hành 12 tháng.
```

Thay nội dung mẫu bằng chính sách thật. Cập nhật thêm `.env`:

```dotenv
STORE_NAME=Tên shop của anh
STORE_HOTLINE=0909 123 456
STORE_EMAIL=hello@shop.vn
STORE_ADDRESS=Địa chỉ shop
```

**Lưu ý:** `SHIPPING_FEE` và `FREE_SHIPPING_THRESHOLD` trong `.env` phải khớp với chính sách trong file. Mặc định mẫu: phí 30.000₫, miễn phí từ 500.000₫. Server dùng hai biến này để tính tiền, không đọc từ markdown.

---

## Kiến trúc

```mermaid
flowchart LR
  U[Khách] -->|HTTP / SSE| API[NestJS API]
  API --> S[AgentService]
  S <--> CP[(Checkpointer<br/>Memory / Postgres)]
  S --> G[LangGraph StateGraph]
  G -->|tool_calls| T[Tools]
  T --> C[(data/products.csv)]
  T --> P[(data/store-info.md)]
  T --> O[(Orders JSONL)]
  T -->|ToolMessage| G
  G -->|câu trả lời cuối| S
```

Graph:

```mermaid
flowchart LR
  A([START]) --> B[agent node]
  B -->|có tool_calls + còn budget| C[tools node]
  C --> B
  B -->|câu trả lời cuối| D([END])
  B -->|hết AGENT_MAX_ITERATIONS| E[limit node] --> D
```

### Các tool

| Tool | Vai trò |
| --- | --- |
| `search_products` | Tìm theo từ khóa, danh mục, khoảng giá, tag, tồn kho. Trả về ID + giá + tồn kho. |
| `get_product` | Xem chi tiết một sản phẩm theo ID. |
| `search_store_info` | Tra chính sách giao hàng/đổi trả/bảo hành/thanh toán/liên hệ. |
| `preview_order` | Kiểm tra tồn kho và tính **tạm tính + phí ship + tổng** mà chưa tạo đơn. |
| `create_order` | Tạo đơn sau khi khách xác nhận; server kiểm tra lại toàn bộ. |
| `get_order_status` | Tra đơn theo mã. |

`preview_order` là mảnh quan trọng: agent **không tự cộng tiền**. Muốn đọc tổng cho khách thì gọi tool; muốn chốt thì gọi `create_order` và server tính lại.

---

## Luồng chốt đơn

1. Khách chọn sản phẩm + số lượng.
2. Agent hỏi **họ tên, số điện thoại Việt Nam, địa chỉ giao hàng** (và ghi chú nếu cần). Không hỏi thẻ/OTP/mật khẩu.
3. Agent gọi `preview_order` → server kiểm tra tồn kho, tính tạm tính, phí ship, tổng.
4. Agent đọc lại toàn bộ đơn + tổng tiền và hỏi rõ: “Bạn xác nhận đặt đơn này chứ?”.
5. Chỉ khi khách đồng ý, agent gọi `create_order` với `confirmed=true`.
6. Server kiểm tra lại stock/giá, tạo mã `ORD-YYYYMMDD-XXXXXX`, ghi file, trừ tồn kho.
7. Agent trả mã đơn + tổng tiền + hình thức thanh toán.

Server chịu trách nhiệm:

- Chuẩn hoá SĐT Việt Nam (`090 123 4567`, `+84…` → `0901234567`).
- Validate tên/địa chỉ/ghi chú/số lượng.
- Kiểm tra sản phẩm tồn tại, cùng currency, còn hàng.
- Tính subtotal, shipping, total.
- Mã đơn unique, lưu JSONL, trừ kho.
- Chống oversell trong một process bằng lock tuần tự.
- Khi restart, **replay đơn đã lưu** để trừ lại tồn kho từ baseline `products.csv`.

> `confirmed` vẫn do model gửi lên. Prompt + tool description ép agent chỉ gọi sau khi khách đồng ý, nhưng nếu cần chống 100% model gọi sớm, hãy dùng LangGraph `interrupt()`/HITL hoặc nút xác nhận ở UI trước khi gọi `create_order`.

---

## API

Base URL: `http://localhost:3000`

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness |
| `GET` | `/api/agent/info` | Provider, model, store, catalog, tools |
| `POST` | `/api/agent/chat` | Chat, trả câu trả lời cuối |
| `POST` | `/api/agent/chat/stream` | Chat + SSE |
| `GET` | `/api/agent/threads/:threadId` | Lịch sử thread |
| `DELETE` | `/api/agent/threads/:threadId` | Xoá thread + checkpoints |
| `GET` | `/api/catalog/products` | Tìm/lọc sản phẩm |
| `GET` | `/api/catalog/products/:id` | Chi tiết sản phẩm |
| `GET` | `/api/catalog/categories` | Danh mục |
| `GET` | `/api/orders/:orderCode` | Tra đơn (SĐT được mask, không trả địa chỉ) |

### Tư vấn

```bash
curl -s http://localhost:3000/api/agent/chat \
  -H 'content-type: application/json' \
  -d '{"message":"Tư vấn tai nghe dưới 1 triệu giúp mình"}'
```

```json
{
  "threadId": "6f1a9d6e-3a7b-4f1e-9c2a-4d2e8b7c1a90",
  "message": {
    "role": "assistant",
    "content": "Mình gợi ý 2 lựa chọn phù hợp:\n• Tai nghe TrueSound Lite — 490.000 ₫…"
  },
  "iterations": 2
}
```

### Chốt đơn

Lượt 1 — khách cung cấp đủ thông tin:

```bash
curl -s http://localhost:3000/api/agent/chat \
  -H 'content-type: application/json' \
  -d '{
    "threadId": "demo-order-1",
    "message": "Mình muốn mua SP001, tên: Nguyễn Văn A, sđt: 0901234567, địa chỉ: 123 Lê Lợi, Quận 1, TP.HCM"
  }'
```

Agent trả **đơn nháp** + tổng tiền + câu hỏi xác nhận. Lượt 2:

```bash
curl -s http://localhost:3000/api/agent/chat \
  -H 'content-type: application/json' \
  -d '{"threadId":"demo-order-1","message":"Đồng ý"}'
```

Kết quả có mã đơn, ví dụ `ORD-20261023-A1B2C3`. Tra đơn:

```bash
curl -s http://localhost:3000/api/orders/ORD-20261023-A1B2C3
```

### SSE streaming

```bash
curl -N http://localhost:3000/api/agent/chat/stream \
  -H 'content-type: application/json' \
  -d '{"message":"Tư vấn tai nghe bluetooth"}'
```

Các event: `meta`, `token`, `tool_start`, `tool_end`, `done`, `error`. Mỗi frame có JSON kèm `type` để client dùng `fetch` stream hoặc `EventSource` đều được.

### Catalog

```bash
curl 'http://localhost:3000/api/catalog/products?q=tai%20nghe&maxPrice=1000000&limit=5'
curl 'http://localhost:3000/api/catalog/products/SP001'
curl 'http://localhost:3000/api/catalog/categories'
```

---

## Cấu hình

Validate bằng Zod khi boot; sai định dạng → fail-fast với message rõ ràng.

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `PORT` | `3000` | HTTP port |
| `CORS_ORIGINS` | `*` | Origin được phép, phân tách bằng dấu phẩy |
| `LLM_PROVIDER` | auto | `openai`, `gemini` hoặc `mock`; auto theo API key |
| `OPENAI_API_KEY` | — | Bắt buộc khi provider `openai` |
| `OPENAI_BASE_URL` | — | Endpoint OpenAI-compatible |
| `OPENAI_MODEL` | `gpt-4o-mini` | Tên model OpenAI |
| `GEMINI_API_KEY` | — | Bắt buộc khi provider `gemini` |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Tên model Gemini |
| `LLM_TEMPERATURE` | `0.2` | 0–2 |
| `LLM_MAX_TOKENS` | `1024` | Giới hạn output |
| `AGENT_MAX_ITERATIONS` | `8` | Số model call tối đa mỗi lượt |
| `AGENT_SYSTEM_PROMPT` | built-in | Override prompt bán hàng |
| `STORE_NAME` | `NestShop` | Tên shop (UI + prompt) |
| `STORE_HOTLINE` | — | Hotline hiển thị trong prompt |
| `STORE_EMAIL` | — | Email |
| `STORE_ADDRESS` | — | Địa chỉ shop |
| `PRODUCTS_FILE` | `./data/products.csv` | File catalog |
| `STORE_INFO_FILE` | `./data/store-info.md` | File chính sách |
| `ORDERS_FILE` | `./data/orders/orders.jsonl` | Nơi lưu đơn |
| `ORDER_PREFIX` | `ORD` | Prefix mã đơn (2–8 ký tự) |
| `MAX_ORDER_ITEMS` | `20` | Số dòng sản phẩm tối đa/đơn |
| `SHIPPING_FEE` | `30000` | Phí ship (VND) |
| `FREE_SHIPPING_THRESHOLD` | `500000` | Ngưỡng freeship (0 = luôn thu phí) |
| `DATABASE_URL` | — | Bật Postgres checkpointer |
| `DB_POOL_MAX` | `10` | Pool size |
| `SWAGGER_ENABLED` | `true` | Bật `/docs` |
| `LANGCHAIN_TRACING_V2` | — | `true` để bật LangSmith |
| `LANGCHAIN_API_KEY` | — | LangSmith key |
| `LANGCHAIN_PROJECT` | — | Tên project LangSmith |

---

## Dữ liệu & quyền riêng tư

- Đơn hàng lưu tại `data/orders/orders.jsonl`, chứa **PII thật** (tên, SĐT, địa chỉ). File này đã nằm trong `.gitignore` và `.dockerignore`.
- Docker dùng named volume `orders` để đơn không mất khi recreate container.
- `GET /api/agent/threads/:id` trả lịch sử; với tool call `create_order`, SĐT được mask và địa chỉ đổi thành `[hidden]`.
- `GET /api/orders/:code` chỉ trả SĐT đã mask, không trả địa chỉ.
- Tool card trên UI cũng mask SĐT/địa chỉ.
- **Chưa có auth**: bất kỳ ai biết `threadId` có thể đọc lịch sử chat của thread đó. Trước khi public, thêm auth/authorization cho `/api/agent/*` và gắn thread với user.
- Không log nội dung PII; lỗi server chỉ log stack/mã lỗi.

---

## Test

```bash
pnpm test        # 32 unit tests
pnpm test:e2e    # 8 e2e tests (boot Nest app + gọi API thật)
pnpm test:cov
pnpm lint
pnpm typecheck
pnpm build
```

Coverage chính:

- Parse CSV/JSON, header tiếng Việt, price formats, duplicate ID, dòng lỗi.
- Search theo từ khóa/giá/danh mục/tồn kho.
- Preview tính tiền, freeship, validate SĐT, stock, lock chống oversell.
- Persist đơn, mask PII, replay stock khi restart.
- E2E: health/info, catalog, chat tư vấn, policy, **preview → Đồng ý → tạo đơn**, tra đơn, SSE, validation.
- Provider selection: Gemini key → Gemini; không key → mock; thiếu key khi ép provider → lỗi cấu hình.

---

## Docker

Chạy full stack:

```bash
cp .env.example .env
docker compose up --build
```

- UI: <http://localhost:3000/ui/>
- Swagger: <http://localhost:3000/docs>
- Postgres: service `db`; checkpointer dùng `DATABASE_URL` tự động.
- `data/products.csv` và `data/store-info.md` được mount read-only → sửa file rồi `docker compose restart app` là áp dụng.
- Đơn hàng nằm trong volume `orders`.
- Image chạy user `node`, có healthcheck.

Chỉ chạy Postgres cho dev local:

```bash
docker compose up -d db
# .env: DATABASE_URL=postgresql://agent:agent@localhost:5432/agent
```

---

## Cấu trúc thư mục

```text
data/
├── products.csv                 # catalog mẫu — thay bằng file thật
├── store-info.md                # chính sách mẫu — thay bằng chính sách thật
└── orders/                       # JSONL đơn hàng (gitignored, chứa PII)

src/
├── catalog/
│   ├── catalog.loader.ts         # CSV/JSON parser + alias cột tiếng Việt
│   ├── catalog.service.ts        # search, filter, stock, stats
│   ├── catalog.tools.ts          # search_products, get_product
│   ├── catalog.controller.ts     # /api/catalog
│   └── dto/
├── orders/
│   ├── order.service.ts          # preview/create, validate, JSONL, stock
│   ├── order.tools.ts            # preview_order, create_order, get_order_status
│   ├── order.controller.ts       # /api/orders/:code
│   └── dto/
├── store-info/
│   ├── store-info.service.ts     # đọc markdown + search section
│   └── store-info.tools.ts       # search_store_info
├── agent/
│   ├── agent.graph.ts            # StateGraph loop + guard
│   ├── agent.service.ts          # run/stream/history
│   ├── agent.prompt.ts           # prompt bán hàng + guardrails
│   ├── models/mock-chat.model.ts # mock model offline
│   ├── message.utils.ts          # map message, mask PII
│   └── ...
├── tools/tools.service.ts        # registry tool
├── config/env.validation.ts
└── ...
public/index.html                # demo UI
test/agent.e2e-spec.ts
```

---

## Tùy chỉnh & mở rộng

### Thêm tool

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const checkVoucherTool = tool(
  async ({ code }) => {
    // gọi DB/API thật, trả string
    return JSON.stringify({ code, valid: code === 'WELCOME10', discount: 10 });
  },
  {
    name: 'check_voucher',
    description: 'Validate a discount voucher code before applying it to an order.',
    schema: z.object({ code: z.string().min(2).max(30) }),
  },
);
```

Thêm vào registry [`src/tools/tools.service.ts`](src/tools/tools.service.ts). Nhớ cập nhật prompt nếu tool cần được gọi theo quy trình.

### Đổi prompt

Sửa [`src/agent/agent.prompt.ts`](src/agent/agent.prompt.ts) hoặc đặt `AGENT_SYSTEM_PROMPT`. Prompt hiện tại đã có guardrail: không bịa giá/tồn kho, không hỏi OTP/thẻ, chỉ tạo đơn sau xác nhận.

### Gợi ý nâng cấp

- **Human-in-the-loop**: dùng `interrupt()` trước `create_order` để nhân viên/khách xác nhận qua UI.
- **Đơn hàng thật**: thay JSONL bằng Postgres/MySQL, transaction + idempotency key + payment gateway.
- **Tồn kho thật**: sync POS/ERP; bỏ replay baseline.
- **Voucher/khuyến mãi**: thêm tool + bảng giá.
- **Giao hàng**: tích hợp GHN/GHTK/Viettel Post để tính phí theo địa chỉ.
- **Handoff**: tool `escalate_to_human` + thông báo Zalo/Slack.
- **Đa ngôn ngữ**: prompt đã yêu cầu trả lời theo ngôn ngữ khách.
- **RAG chính sách dài**: thay keyword search bằng vector store/pgvector khi file lớn.

---

## Troubleshooting

| Lỗi | Nguyên nhân / cách xử lý |
| --- | --- |
| `Product file not found` | Sai `PRODUCTS_FILE` hoặc chưa có `data/products.csv`; đường dẫn tính từ thư mục chạy app |
| `no valid products found` | Thiếu cột `tên`/`giá`, giá không parse được, hoặc file rỗng |
| `Duplicate product id` | Sửa ID trùng trong file catalog |
| Agent tư vấn sai/không tìm thấy | Thêm `tags`, mô tả rõ; thử `category`/`maxPrice`; xem tool result trong UI |
| `OPENAI_API_KEY is required` | Đặt key hoặc đổi `LLM_PROVIDER=mock` |
| `401` từ provider | Key sai/hết hạn; kiểm tra `OPENAI_BASE_URL` |
| SĐT không hợp lệ | Dùng 10 số bắt đầu bằng 0, hoặc `+84…`; server tự chuẩn hoá |
| `Order ... was not found` | Mã đơn sai hoặc file orders đã bị xoá |
| Tồn kho sai sau restart | `products.csv` là baseline; đơn trong `data/orders` được replay. Nếu sửa tay stock, cần đồng bộ lại orders |
| SSE bị buffer | Tắt proxy buffering; app đã set `X-Accel-Buffering: no` |
| `ERR_MODULE_NOT_FOUND` | Relative import ESM phải có đuôi `.js` |
| `[ERR_PNPM_IGNORED_BUILDS]` | Warning build script của dependency; có thể `pnpm approve-builds` nếu cần |

---

## Lên production

Repo này là **starter**, chưa đủ để chạy production cho khách thật. Checklist tối thiểu:

1. **Auth**: JWT/API key cho `/api/agent/*`, gắn thread với user; chặn đọc chéo lịch sử.
2. **Rate limit + abuse**: `@nestjs/throttler`, giới hạn độ dài message, số thread, số đơn/ngày.
3. **Xác nhận đơn**: dùng HITL/UI confirmation thay vì tin hoàn toàn vào `confirmed` của model.
4. **Đơn hàng & tồn kho**: DB transaction, idempotency, payment gateway, huỷ/hoàn tiền, đồng bộ kho.
5. **PII**: mã hoá file/DB, retention, quyền truy cập, xoá theo yêu cầu, không log SĐT/địa chỉ.
6. **Thông báo**: SMS/Zalo/email xác nhận đơn; webhook cho shop.
7. **Observability**: LangSmith, log `threadId`/latency/token usage, alert lỗi tool/order.
8. **Prompt safety**: coi nội dung khách là untrusted; không để prompt injection lộ dữ liệu/tool.
9. **Pháp lý**: chính sách đổi trả, bảo mật, đồng ý thu thập dữ liệu.
10. **Kiểm thử**: eval bộ câu hỏi thật, test đơn/stock, theo dõi hallucination.

Gợi ý thay `OrderService` bằng repository DB + transaction:

```text
BEGIN
  SELECT ... FOR UPDATE  (khoá sản phẩm)
  kiểm tra stock
  INSERT order + order_items
  UPDATE stock
COMMIT
```

---

## License

MIT — xem [LICENSE](LICENSE).
