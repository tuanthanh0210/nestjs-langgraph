import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CatalogService } from '../catalog/catalog.service.js';
import type { Env } from '../config/env.validation.js';
import { maskPhone, normalizePhone, OrderService } from './order.service.js';

let directory: string;
let catalog: CatalogService;
let orders: OrderService;

function config(values: Partial<Env>): ConfigService<Env, true> {
  return {
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>;
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'orders-'));

  const productsFile = join(directory, 'products.csv');
  writeFileSync(
    productsFile,
    'id,name,price,stock\n' +
      'P1,Sản phẩm một,100000,2\n' +
      'P2,Sản phẩm hai,600000,1\n' +
      'P3,Sản phẩm ba,50000,0\n',
    'utf8',
  );

  catalog = new CatalogService(config({ PRODUCTS_FILE: productsFile }));
  catalog.onModuleInit();

  orders = new OrderService(
    config({
      ORDERS_FILE: join(directory, 'orders.jsonl'),
      SHIPPING_FEE: 30000,
      FREE_SHIPPING_THRESHOLD: 500000,
      MAX_ORDER_ITEMS: 20,
      ORDER_PREFIX: 'ORD',
    }),
    catalog,
  );
  await orders.onModuleInit();
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const customer = {
  customerName: 'Nguyễn Văn A',
  phone: '0901234567',
  address: '123 Lê Lợi, Quận 1, TP.HCM',
  confirmed: true,
} as const;

describe('OrderService', () => {
  it('previews totals without creating an order', () => {
    const preview = orders.previewOrder([{ productId: 'P1', quantity: 1 }]);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    expect(preview.subtotal).toBe(100000);
    expect(preview.shippingFee).toBe(30000);
    expect(preview.total).toBe(130000);
    expect(orders.getOrder('missing')).toBeUndefined();
  });

  it('applies free shipping above the threshold', () => {
    const preview = orders.previewOrder([{ productId: 'P2', quantity: 1 }]);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    expect(preview.subtotal).toBe(600000);
    expect(preview.shippingFee).toBe(0);
    expect(preview.total).toBe(600000);
  });

  it('rejects invalid or unconfirmed checkouts', async () => {
    const unconfirmed = await orders.createOrder({
      ...customer,
      confirmed: false,
      items: [{ productId: 'P1', quantity: 1 }],
    });
    expect(unconfirmed.ok).toBe(false);

    const badPhone = await orders.createOrder({
      ...customer,
      phone: '12345',
      items: [{ productId: 'P1', quantity: 1 }],
    });
    expect(badPhone.ok).toBe(false);

    const outOfStock = await orders.createOrder({
      ...customer,
      items: [{ productId: 'P3', quantity: 1 }],
    });
    expect(outOfStock.ok).toBe(false);
  });

  it('creates and persists an order, decrements stock and masks PII', async () => {
    const result = await orders.createOrder({
      ...customer,
      items: [{ productId: 'P1', quantity: 1 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.order.orderCode).toMatch(/^ORD-\d{8}-[A-F0-9]{6}$/);
    expect(result.order.total).toBe(130000);
    expect(result.order.paymentMethod).toBe('cod');
    expect(catalog.getById('P1')?.stock).toBe(1);

    const file = readFileSync(join(directory, 'orders.jsonl'), 'utf8');
    expect(file).toContain(result.order.orderCode);
    expect(file).toContain('0901234567');

    const publicOrder = orders.getPublicOrder(result.order.orderCode);
    expect(publicOrder?.customer.phone).toBe('0901234567');
    expect(maskPhone('0901234567')).toBe('090****567');
  });

  it('replays persisted orders into stock on boot', async () => {
    const first = await orders.createOrder({
      ...customer,
      items: [{ productId: 'P1', quantity: 1 }],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const restoredCatalog = new CatalogService(
      config({ PRODUCTS_FILE: join(directory, 'products.csv') }),
    );
    restoredCatalog.onModuleInit();

    const restoredOrders = new OrderService(
      config({
        ORDERS_FILE: join(directory, 'orders.jsonl'),
        SHIPPING_FEE: 30000,
        FREE_SHIPPING_THRESHOLD: 500000,
        MAX_ORDER_ITEMS: 20,
        ORDER_PREFIX: 'ORD',
      }),
      restoredCatalog,
    );
    await restoredOrders.onModuleInit();

    expect(restoredCatalog.getById('P1')?.stock).toBe(1);
    expect(restoredOrders.getPublicOrder(first.order.orderCode)).toBeDefined();
  });

  it('serializes concurrent checkouts to prevent overselling', async () => {
    const [first, second] = await Promise.all([
      orders.createOrder({ ...customer, items: [{ productId: 'P1', quantity: 2 }] }),
      orders.createOrder({ ...customer, items: [{ productId: 'P1', quantity: 2 }] }),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(catalog.getById('P1')?.stock).toBe(0);
  });
});

describe('phone helpers', () => {
  it('normalizes Vietnamese phone formats', () => {
    expect(normalizePhone('090 123 4567')).toBe('0901234567');
    expect(normalizePhone('+84 901 234 567')).toBe('0901234567');
    expect(normalizePhone('12345')).toBeNull();
  });
});
