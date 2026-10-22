import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { formatCurrency, resolveDataPath } from '../catalog/catalog.utils.js';
import type {
  CreateOrderInput,
  CreateOrderResult,
  Order,
  OrderItem,
  OrderItemInput,
  PaymentMethod,
  PreviewOrderResult,
} from './order.types.js';

export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[^\d+]/g, '');

  if (digits.startsWith('+84')) {
    digits = `0${digits.slice(3)}`;
  } else if (digits.startsWith('84') && digits.length === 11) {
    digits = `0${digits.slice(2)}`;
  }

  return /^0\d{9}$/.test(digits) ? digits : null;
}

export function maskPhone(phone: string): string {
  if (phone.length < 7) return '***';
  return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
}

@Injectable()
export class OrderService implements OnModuleInit {
  private readonly logger = new Logger(OrderService.name);
  private readonly ordersFile: string;
  private readonly shippingFee: number;
  private readonly freeShippingThreshold: number;
  private readonly maxOrderItems: number;
  private readonly orderPrefix: string;
  private readonly timezone: string;

  private readonly orders = new Map<string, Order>();
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly catalog: CatalogService,
  ) {
    this.ordersFile = resolveDataPath(config.get('ORDERS_FILE', { infer: true }));
    this.shippingFee = config.get('SHIPPING_FEE', { infer: true });
    this.freeShippingThreshold = config.get('FREE_SHIPPING_THRESHOLD', { infer: true });
    this.maxOrderItems = config.get('MAX_ORDER_ITEMS', { infer: true });
    this.orderPrefix = config.get('ORDER_PREFIX', { infer: true });
    this.timezone = config.get('DEFAULT_TIMEZONE', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await mkdir(dirname(this.ordersFile), { recursive: true });
    this.loadExistingOrders();

    if (this.orders.size > 0) {
      if (this.catalog.productCount === 0) this.catalog.load();

      // products.csv is the baseline stock. Replaying persisted orders keeps
      // inventory correct across restarts without mutating the CSV.
      for (const order of this.orders.values()) {
        this.catalog.commitStock(
          order.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        );
      }
      this.logger.log(`Replayed stock for ${this.orders.size} persisted order(s).`);
    }

    this.logger.log(
      `Order storage ready at ${this.ordersFile} (${this.orders.size} existing orders).`,
    );
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    // Serialize writes so two concurrent checkouts cannot oversell stock.
    return this.withLock(() => this.createOrderLocked(input));
  }

  /** Validate items and compute totals without creating an order or asking for PII. */
  previewOrder(items: OrderItemInput[] | undefined): PreviewOrderResult {
    return this.resolveItems(items);
  }

  getOrder(orderCode: string): Order | undefined {
    return this.orders.get(orderCode.trim().toUpperCase());
  }

  getPublicOrder(orderCode: string): Order | undefined {
    return this.getOrder(orderCode);
  }

  private async createOrderLocked(input: CreateOrderInput): Promise<CreateOrderResult> {
    if (input.confirmed !== true) {
      return {
        ok: false,
        error:
          'Đơn hàng chưa được xác nhận. Hãy tóm tắt sản phẩm, số lượng và tổng tiền, sau đó hỏi khách xác nhận trước khi tạo đơn.',
      };
    }

    const customerName = String(input.customerName ?? '').trim();
    const address = String(input.address ?? '').trim();
    const note = String(input.note ?? '').trim();
    const phone = normalizePhone(String(input.phone ?? ''));

    if (customerName.length < 2 || customerName.length > 80) {
      return { ok: false, error: 'Tên khách hàng cần từ 2 đến 80 ký tự.' };
    }
    if (!phone) {
      return {
        ok: false,
        error: 'Số điện thoại không hợp lệ. Vui lòng dùng số Việt Nam 10 chữ số, ví dụ 0901234567.',
      };
    }
    if (address.length < 8 || address.length > 300) {
      return { ok: false, error: 'Địa chỉ giao hàng cần từ 8 đến 300 ký tự.' };
    }
    if (note.length > 500) {
      return { ok: false, error: 'Ghi chú đơn hàng tối đa 500 ký tự.' };
    }

    const resolved = this.resolveItems(input.items);
    if (!resolved.ok) return resolved;

    const paymentMethod: PaymentMethod = input.paymentMethod ?? 'cod';
    if (paymentMethod !== 'cod' && paymentMethod !== 'bank_transfer') {
      return { ok: false, error: 'Phương thức thanh toán không hợp lệ.' };
    }

    const { items, subtotal, shippingFee, total, currency } = resolved;

    const order: Order = {
      orderCode: this.nextOrderCode(),
      status: 'confirmed',
      customer: { name: customerName, phone, address },
      items,
      subtotal,
      shippingFee,
      total,
      currency,
      paymentMethod,
      ...(note ? { note } : {}),
      createdAt: new Date().toISOString(),
    };

    try {
      await appendFile(this.ordersFile, `${JSON.stringify(order)}\n`, 'utf8');
    } catch (error) {
      this.logger.error(
        'Could not persist order',
        error instanceof Error ? error.stack : String(error),
      );
      return {
        ok: false,
        error: 'Không thể lưu đơn hàng lúc này. Vui lòng thử lại hoặc liên hệ hotline.',
      };
    }

    this.catalog.commitStock(
      items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    );
    this.orders.set(order.orderCode, order);

    const shippingLabel =
      shippingFee === 0
        ? 'Miễn phí giao hàng'
        : `Phí giao hàng ${formatCurrency(shippingFee, currency)}`;
    const paymentLabel =
      paymentMethod === 'cod' ? 'Thanh toán khi nhận hàng (COD)' : 'Chuyển khoản ngân hàng';

    return {
      ok: true,
      order,
      message:
        `Đã tạo đơn ${order.orderCode}. ` +
        `${items.length} sản phẩm, tạm tính ${formatCurrency(subtotal, currency)}. ` +
        `${shippingLabel}. Tổng thanh toán ${formatCurrency(total, currency)}. ` +
        `${paymentLabel}.`,
    };
  }

  private resolveItems(items: OrderItemInput[] | undefined): PreviewOrderResult {
    if (!Array.isArray(items) || items.length === 0) {
      return { ok: false, error: 'Đơn hàng cần ít nhất 1 sản phẩm.' };
    }
    if (items.length > this.maxOrderItems) {
      return { ok: false, error: `Mỗi đơn hàng tối đa ${this.maxOrderItems} dòng sản phẩm.` };
    }

    const merged = new Map<string, number>();
    for (const item of items) {
      const productId = String(item?.productId ?? '').trim();
      const quantity = Number(item?.quantity);

      if (!productId) return { ok: false, error: 'Thiếu mã sản phẩm trong đơn hàng.' };
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return { ok: false, error: `Số lượng cho "${productId}" phải là số nguyên từ 1 đến 99.` };
      }

      merged.set(productId, (merged.get(productId) ?? 0) + quantity);
    }

    const resolvedItems: OrderItem[] = [];
    let currency: string | undefined;

    for (const [productId, quantity] of merged) {
      const product = this.catalog.getById(productId);
      if (!product) {
        return {
          ok: false,
          error: `Không tìm thấy sản phẩm "${productId}". Hãy gọi search_products để lấy mã đúng.`,
        };
      }

      if (currency && product.currency !== currency) {
        return { ok: false, error: 'Các sản phẩm trong đơn phải cùng đơn vị tiền tệ.' };
      }
      currency = product.currency;

      resolvedItems.push({
        productId: product.id,
        name: product.name,
        quantity,
        unitPrice: product.price,
        lineTotal: product.price * quantity,
      });
    }

    const stockError = this.catalog.validateStock(
      resolvedItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    );
    if (stockError) return { ok: false, error: stockError };

    const subtotal = resolvedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const shippingFee =
      this.freeShippingThreshold > 0 && subtotal >= this.freeShippingThreshold
        ? 0
        : this.shippingFee;

    return {
      ok: true,
      items: resolvedItems,
      subtotal,
      shippingFee,
      total: subtotal + shippingFee,
      currency: currency ?? 'VND',
    };
  }

  private nextOrderCode(): string {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(new Date())
      .replace(/-/g, '');

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const suffix = randomBytes(3).toString('hex').toUpperCase();
      const code = `${this.orderPrefix}-${date}-${suffix}`;
      if (!this.orders.has(code)) return code;
    }

    throw new Error('Could not generate a unique order code');
  }

  private loadExistingOrders(): void {
    if (!existsSync(this.ordersFile)) return;

    const lines = readFileSync(this.ordersFile, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    let malformed = 0;
    for (const line of lines) {
      try {
        const order = JSON.parse(line) as Order;
        if (order?.orderCode && order?.status === 'confirmed') {
          this.orders.set(order.orderCode.toUpperCase(), order);
        } else {
          malformed += 1;
        }
      } catch {
        malformed += 1;
      }
    }

    if (malformed > 0) {
      this.logger.warn(`Skipped ${malformed} malformed order record(s).`);
    }
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
