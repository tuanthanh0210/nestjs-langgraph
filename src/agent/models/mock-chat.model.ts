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
import { normalizeText } from '../../catalog/catalog.utils.js';

interface SearchProduct {
  id: string;
  name: string;
  priceFormatted: string;
  description?: string;
  stock?: number | null;
  inStock?: boolean;
}

interface SearchResult {
  products?: SearchProduct[];
  total?: number;
}

interface PreviewItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

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

function parseJson(content: MessageContent): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(messageText(content));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function extractPhone(text: string): string | undefined {
  return /(?:\+84|0)(?:[\s.-]?\d){9}/.exec(text)?.[0];
}

function extractAddress(text: string): string | undefined {
  const match = /(?:địa chỉ(?:\s+giao hàng)?|giao đến|giao tại|address)\s*[:-]?\s*([^\n]+)/i.exec(
    text,
  );
  if (!match) return undefined;

  const address = match[1]
    .split(/\s*(?:sđt|sdt|điện thoại|phone)\b/i)[0]
    .replace(/\s+(ạ|nhé|nha|giúp mình|giùm mình)\.?$/i, '')
    .trim();

  if (address.length < 8) return undefined;
  if (!/\d/.test(address) && !/,/.test(address)) return undefined;
  if (/(shop|cửa hàng|ở đâu)/i.test(address) && !/\d/.test(address)) return undefined;

  return address;
}

function extractName(text: string): string | undefined {
  const match =
    /(?:họ tên|tên người nhận|tên|người nhận)\s*[:-]\s*([^,;\n]{2,60})/i.exec(text) ??
    /(?:tôi là|mình là|em là)\s+([^,;\n]{2,60})/i.exec(text);

  if (!match) return undefined;
  const name = match[1].replace(/\s+(sđt|sdt|điện thoại|phone)\b.*$/i, '').trim();
  return name.length >= 2 ? name : undefined;
}

function extractQuantity(text: string): number {
  const match =
    /(?:số lượng|mua|đặt)\s*(\d{1,2})\s*(?:cái|chiếc|sản phẩm|sp|hộp)?/i.exec(text) ??
    /(\d{1,2})\s*(?:cái|chiếc|sản phẩm|sp|hộp)/i.exec(text);
  const quantity = match ? Number.parseInt(match[1], 10) : 1;
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 99 ? quantity : 1;
}

function extractMaxPrice(text: string): number | undefined {
  const match =
    /(?:dưới|tối đa|không quá|max|ngân sách|budget|khoảng|tầm)\s*(\d+(?:[.,]\d+)?)\s*(triệu|tr|k|nghìn|ngàn|vnd|đ)?/i.exec(
      text,
    );
  if (!match) return undefined;

  const amount = Number.parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return undefined;

  const unit = (match[2] ?? '').toLowerCase();
  if (['triệu', 'tr'].includes(unit)) return Math.round(amount * 1_000_000);
  if (['k', 'nghìn', 'ngàn'].includes(unit)) return Math.round(amount * 1_000);
  return Math.round(amount);
}

function isPurchaseIntent(text: string): boolean {
  return /mua|đặt hàng|đặt đơn|chốt đơn|chốt|order|checkout|thanh toán/i.test(text);
}

function isConfirmation(text: string): boolean {
  if (/không|chưa|no\b|chưa đâu/i.test(text)) return false;
  return /(^|[\s,.!])(ok|oke|okay|đồng ý|dong y|xác nhận|xac nhan|chốt|chot|yes|y|ừ|u|đúng|dung|đặt đi|chốt đơn)(?=\s|$|[,.!])/i.test(
    text.trim(),
  );
}

function isPolicyIntent(text: string): boolean {
  return /giao hàng|ship|phí|đổi trả|bảo hành|thanh toán|chuyển khoản|\bcod\b|hotline|liên hệ|bảo mật|hoàn tiền|khiếu nại|địa chỉ shop|ở đâu/i.test(
    text,
  );
}

function isProductIntent(text: string): boolean {
  return /tư vấn|sản phẩm|tai nghe|loa|sạc|chuột|bàn phím|webcam|đèn|bình|balo|đồng hồ|quạt|giá đỡ|cáp|quà|gợi ý|tìm|giá|mua/i.test(
    text,
  );
}

function isGreeting(text: string): boolean {
  return /^(xin chào|chào|hello|hi|hey|alo)\b/i.test(text.trim());
}

const ORDINALS: Record<string, number> = {
  '1': 0,
  '2': 1,
  '3': 2,
  '4': 3,
  '5': 4,
  'thứ nhất': 0,
  'thứ hai': 1,
  'thứ ba': 2,
  'thứ tư': 3,
  'thứ năm': 4,
};

export class MockChatModel extends BaseChatModel {
  constructor() {
    super({});
  }

  _llmType(): string {
    return 'mock';
  }

  private buildMessage(messages: BaseMessage[]): AIMessage {
    const lastHumanIndex = messages.map((message) => message.getType()).lastIndexOf('human');
    const userText = messageText(messages[lastHumanIndex]?.content ?? '');
    const toolMessages = messages
      .slice(lastHumanIndex + 1)
      .filter((message): message is ToolMessage => message.getType() === 'tool');

    if (toolMessages.length > 0) {
      return this.replyToTool(toolMessages[toolMessages.length - 1]);
    }

    return this.handleUserMessage(messages, userText);
  }

  private handleUserMessage(messages: BaseMessage[], text: string): AIMessage {
    const lastSearch = this.findLastTool(messages, 'search_products');
    const lastPreview = this.findLastTool(messages, 'preview_order');
    const lastCreate = this.findLastTool(messages, 'create_order');
    const lastPreviewIndex = lastPreview ? messages.lastIndexOf(lastPreview) : -1;
    const lastCreateIndex = lastCreate ? messages.lastIndexOf(lastCreate) : -1;
    const createdAfterPreview =
      lastCreateIndex > lastPreviewIndex && Boolean(parseJson(lastCreate?.content ?? '')?.ok);

    const customer = this.collectCustomer(messages);
    const product = this.selectProduct(text, lastSearch);
    const quantity = extractQuantity(text);

    if (isConfirmation(text)) {
      if (createdAfterPreview) {
        return this.text('Đơn hàng đã được tạo trước đó rồi. Bạn cần kiểm tra mã đơn không?');
      }

      const preview = lastPreview ? parseJson(lastPreview.content) : undefined;
      if (preview?.ok && Array.isArray(preview.items) && preview.items.length > 0) {
        if (!customer.phone || !customer.address) {
          return this.text('Mình cần thêm số điện thoại và địa chỉ giao hàng để chốt đơn ạ.');
        }

        return this.toolCall('create_order', {
          customerName: customer.name,
          phone: customer.phone,
          address: customer.address,
          items: (preview.items as PreviewItem[]).map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
          paymentMethod: 'cod',
          confirmed: true,
        });
      }

      return this.text(
        'Mình chưa có đơn nháp nào để xác nhận. Bạn cho mình biết sản phẩm và số lượng muốn mua trước nhé.',
      );
    }

    const currentPhone = extractPhone(text);
    const currentAddress = extractAddress(text);
    const wantsOrder = Boolean(currentPhone || currentAddress || isPurchaseIntent(text));
    const phone = currentPhone ?? (wantsOrder ? customer.phone : undefined);
    const address = currentAddress ?? (wantsOrder ? customer.address : undefined);

    if (phone || address || (isPurchaseIntent(text) && !isPolicyIntent(text) && Boolean(product))) {
      if (!product) {
        return this.text(
          'Bạn muốn mua sản phẩm nào ạ? Bạn cho mình tên sản phẩm hoặc nói "tư vấn tai nghe" để mình gợi ý nhé.',
        );
      }

      if (!phone || !address) {
        return this.text(
          `Sản phẩm: **${product.name}** — ${product.priceFormatted}.\n\n` +
            'Để chốt đơn, bạn cho mình thêm:\n' +
            `${phone ? '' : '• Họ tên người nhận\n• Số điện thoại\n'}` +
            `${!phone ? '• Số điện thoại\n' : ''}` +
            `${address ? '' : '• Địa chỉ giao hàng đầy đủ\n'}` +
            '\nBạn gửi đủ thông tin giúp mình nhé.',
        );
      }

      return this.toolCall('preview_order', {
        items: [{ productId: product.id, quantity }],
      });
    }

    const orderCode = /\b[A-Z0-9]{2,8}-\d{8}-[A-Z0-9]{4,}\b/i.exec(text)?.[0];
    if (orderCode && /đơn|trạng thái|status|kiểm tra/i.test(text)) {
      return this.toolCall('get_order_status', { orderCode: orderCode.toUpperCase() });
    }

    if (isPolicyIntent(text)) {
      return this.toolCall('search_store_info', { query: text });
    }

    if (isPurchaseIntent(text)) {
      return this.text(
        product
          ? `Bạn muốn mua **${product.name}** — ${product.priceFormatted} phải không ạ? ` +
              'Bạn cho mình họ tên, số điện thoại và địa chỉ giao hàng để mình lên đơn nhé.'
          : 'Bạn muốn mua sản phẩm nào ạ? Bạn cho mình tên sản phẩm hoặc nhu cầu để mình tư vấn trước nhé.',
      );
    }

    if (isProductIntent(text)) {
      const maxPrice = extractMaxPrice(text);
      return this.toolCall('search_products', {
        query: text,
        limit: 5,
        ...(maxPrice ? { maxPrice } : {}),
      });
    }

    if (isGreeting(text)) {
      return this.text(
        'Chào bạn! Mình là trợ lý bán hàng. Bạn đang tìm sản phẩm gì, hoặc cần tư vấn theo nhu cầu/ngân sách nào ạ?',
      );
    }

    return this.text(
      'Mình có thể giúp bạn tìm sản phẩm, so sánh giá, kiểm tra tồn kho và chốt đơn ngay trong chat. ' +
        'Bạn đang quan tâm đến sản phẩm gì ạ?',
    );
  }

  private replyToTool(tool: ToolMessage): AIMessage {
    const data = parseJson(tool.content);

    switch (tool.name) {
      case 'search_products':
        return this.text(this.formatSearch(data as SearchResult | undefined));
      case 'get_product':
        return this.text(this.formatProduct(data));
      case 'search_store_info':
        return this.text(this.formatStoreInfo(data));
      case 'preview_order':
        return this.text(this.formatPreview(data));
      case 'create_order':
        return this.text(this.formatCreateOrder(data));
      case 'get_order_status':
        return this.text(this.formatOrderStatus(data));
      default:
        return this.text('Mình đã nhận kết quả từ hệ thống. Bạn cần mình hỗ trợ thêm gì không ạ?');
    }
  }

  private formatSearch(data: SearchResult | undefined): string {
    const products = data?.products ?? [];
    if (products.length === 0) {
      return (
        'Mình chưa tìm thấy sản phẩm phù hợp với mô tả đó. ' +
        'Bạn có thể cho mình biết ngân sách hoặc nhu cầu cụ thể hơn (dùng để làm gì, ưu tiên điều gì) không ạ?'
      );
    }

    const lines = products
      .slice(0, 3)
      .map(
        (product) =>
          `• **${product.name}** — ${product.priceFormatted}` +
          `${product.inStock === false ? ' (tạm hết hàng)' : ''}`,
      )
      .join('\n');

    return (
      `Mình gợi ý ${Math.min(products.length, 3)} lựa chọn phù hợp:\n${lines}\n\n` +
      'Bạn thích mẫu nào, hoặc muốn mình so sánh thêm điểm nổi bật của từng mẫu không ạ?'
    );
  }

  private formatProduct(data: Record<string, unknown> | undefined): string {
    if (!data || data.error) {
      return String(
        data?.error ?? 'Mình chưa lấy được thông tin sản phẩm. Bạn thử lại giúp mình nhé.',
      );
    }

    const attributes = data.attributes as Record<string, string> | undefined;
    const attributeText = attributes
      ? Object.entries(attributes)
          .map(([key, value]) => `${key}: ${value}`)
          .join(' · ')
      : '';

    return (
      `**${String(data.name)}** — ${String(data.priceFormatted)}\n` +
      `Tồn kho: ${data.stock === null ? 'đang cập nhật' : `${String(data.stock)} sản phẩm`}\n\n` +
      `${String(data.description ?? '')}` +
      `${attributeText ? `\n\nThông số: ${attributeText}` : ''}\n\n` +
      'Bạn muốn mình tư vấn thêm hoặc lên đơn mẫu này không ạ?'
    );
  }

  private formatStoreInfo(data: Record<string, unknown> | undefined): string {
    const sections =
      (data?.sections as Array<{ title: string; content: string }> | undefined) ?? [];
    if (sections.length === 0) {
      return String(
        data?.message ??
          'Mình chưa có thông tin chính sách này. Bạn vui lòng liên hệ hotline của shop để được hỗ trợ chính xác ạ.',
      );
    }

    return sections.map((section) => `**${section.title}**\n${section.content}`).join('\n\n');
  }

  private formatPreview(data: Record<string, unknown> | undefined): string {
    if (!data || data.ok !== true) {
      return `Mình chưa lên được đơn nháp: ${String(data?.error ?? 'lỗi không xác định')}. Bạn kiểm tra lại sản phẩm giúp mình nhé.`;
    }

    const items = (data.items as PreviewItem[] | undefined) ?? [];
    const itemLines = items
      .map(
        (item) => `• ${item.quantity} × ${item.name} — ${item.lineTotal.toLocaleString('vi-VN')}₫`,
      )
      .join('\n');

    return (
      `Đơn nháp của bạn:\n${itemLines}\n\n` +
      `Tạm tính: ${String(data.subtotalFormatted)}\n` +
      `Phí giao hàng: ${String(data.shippingFeeFormatted)}\n` +
      `Tổng thanh toán: **${String(data.totalFormatted)}**\n` +
      'Hình thức: Thanh toán khi nhận hàng (COD)\n\n' +
      'Bạn xác nhận đặt đơn này chứ ạ? Nếu đúng, bạn trả lời "Đồng ý" để mình chốt đơn.'
    );
  }

  private formatCreateOrder(data: Record<string, unknown> | undefined): string {
    if (!data || data.ok !== true) {
      return (
        `Mình chưa tạo được đơn: ${String(data?.error ?? 'lỗi không xác định')}.\n` +
        'Bạn kiểm tra lại thông tin giúp mình, hoặc cho mình biết để hỗ trợ thêm nhé.'
      );
    }

    return (
      `Đã chốt đơn **${String(data.orderCode)}** 🎉\n` +
      `Tổng thanh toán: **${String(data.totalFormatted)}**\n` +
      `Hình thức: ${data.paymentMethod === 'bank_transfer' ? 'Chuyển khoản' : 'Thanh toán khi nhận hàng (COD)'}.\n\n` +
      'Shop sẽ liên hệ xác nhận và giao hàng trong thời gian sớm nhất. Cảm ơn bạn đã mua sắm!'
    );
  }

  private formatOrderStatus(data: Record<string, unknown> | undefined): string {
    if (!data || data.error) {
      return String(
        data?.error ?? 'Mình không tìm thấy đơn hàng này. Bạn kiểm tra lại mã đơn giúp mình nhé.',
      );
    }

    return (
      `Đơn **${String(data.orderCode)}** — trạng thái: ${String(data.status)}\n` +
      `Tổng tiền: ${String(data.totalFormatted)}\n` +
      `Ngày tạo: ${String(data.createdAt)}`
    );
  }

  private collectCustomer(messages: BaseMessage[]): {
    name: string;
    phone?: string;
    address?: string;
  } {
    let name: string | undefined;
    let phone: string | undefined;
    let address: string | undefined;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.getType() !== 'human') continue;

      const text = messageText(message.content);
      if (!phone) phone = extractPhone(text);
      if (!address) address = extractAddress(text);
      if (!name) name = extractName(text);
      if (phone && address) break;
    }

    return {
      name: name ?? 'Khách hàng',
      ...(phone ? { phone } : {}),
      ...(address ? { address } : {}),
    };
  }

  private selectProduct(
    text: string,
    lastSearch: ToolMessage | undefined,
  ): SearchProduct | undefined {
    const search = lastSearch
      ? (parseJson(lastSearch.content) as SearchResult | undefined)
      : undefined;
    const products = search?.products ?? [];
    const normalized = normalizeText(text);

    const explicit = products.find(
      (product) =>
        text.toLowerCase().includes(product.id.toLowerCase()) ||
        normalized.includes(normalizeText(product.name)),
    );
    if (explicit) return explicit;

    const idMatch = /\b[A-Za-z]{2,10}[-_]?\d{2,}\b/.exec(text);
    if (idMatch && !idMatch[0].toUpperCase().startsWith('ORD-')) {
      return {
        id: idMatch[0].toUpperCase(),
        name: idMatch[0].toUpperCase(),
        priceFormatted: '—',
      };
    }

    for (const [word, index] of Object.entries(ORDINALS)) {
      if (normalized.includes(`thu ${word}`) || normalized.includes(`so ${word}`)) {
        if (products[index]) return products[index];
      }
    }

    return products[0];
  }

  private findLastTool(messages: BaseMessage[], name: string): ToolMessage | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.getType() === 'tool' && (message as ToolMessage).name === name) {
        return message as ToolMessage;
      }
    }
    return undefined;
  }

  private text(content: string): AIMessage {
    return new AIMessage({
      content,
      usage_metadata: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    });
  }

  private toolCall(name: string, args: Record<string, unknown>): AIMessage {
    return new AIMessage({
      content: '',
      tool_calls: [{ id: randomUUID(), name, args }],
      usage_metadata: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
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
      llmOutput: { model: 'mock-sales-agent' },
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

      await runManager?.handleLLMNewToken(part, undefined, undefined, undefined, undefined, {
        chunk,
      });
    }
  }
}
