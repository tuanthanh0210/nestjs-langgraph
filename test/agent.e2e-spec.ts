import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

const ordersFile = join(process.cwd(), 'data/orders/e2e-orders.jsonl');

describe('Sales agent API (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;

  beforeAll(async () => {
    await rm(ordersFile, { force: true });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app, { swagger: false });
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    await rm(ordersFile, { force: true });
  });

  it('GET /api/health → ok', async () => {
    const response = await request(server).get('/api/health').expect(200);
    expect(response.body.status).toBe('ok');
  });

  it('GET /api/agent/info → store, catalog and sales tools', async () => {
    const response = await request(server).get('/api/agent/info').expect(200);

    expect(response.body.provider).toBe('mock');
    expect(response.body.store.name).toBe('NestShop');
    expect(response.body.catalog.products).toBe(14);
    expect(response.body.catalog.categories).toContain('Âm thanh');
    expect(response.body.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining([
        'search_products',
        'get_product',
        'preview_order',
        'create_order',
        'get_order_status',
        'search_store_info',
      ]),
    );
  });

  it('serves the product catalog over REST', async () => {
    const list = await request(server)
      .get('/api/catalog/products')
      .query({ q: 'tai nghe', limit: 5 })
      .expect(200);

    expect(list.body.total).toBe(2);
    expect(list.body.products.map((product: { name: string }) => product.name)).toContain(
      'Tai nghe Bluetooth AirBeat Pro',
    );

    const detail = await request(server).get('/api/catalog/products/SP001').expect(200);
    expect(detail.body).toMatchObject({
      id: 'SP001',
      price: 890000,
      inStock: true,
    });
    expect(detail.body.attributes['Kết nối']).toBe('Bluetooth 5.3');

    await request(server).get('/api/catalog/products/DOES-NOT-EXIST').expect(404);

    const categories = await request(server).get('/api/catalog/categories').expect(200);
    expect(categories.body.categories).toContain('Phụ kiện');
  });

  it('consults products in chat and keeps the tool trace in history', async () => {
    const threadId = 'e2e-consult-thread';
    const response = await request(server)
      .post('/api/agent/chat')
      .send({ message: 'Tư vấn tai nghe dưới 1 triệu giúp mình', threadId })
      .expect(200);

    expect(response.body.message.content).toContain('Tai nghe');
    expect(response.body.message.content).toContain('490.000');
    expect(response.body.iterations).toBe(2);

    const history = await request(server).get(`/api/agent/threads/${threadId}`).expect(200);
    expect(history.body.exists).toBe(true);
    expect(
      history.body.messages.some(
        (message: { role: string; name?: string }) =>
          message.role === 'tool' && message.name === 'search_products',
      ),
    ).toBe(true);
  });

  it('answers policy questions from the store-info file', async () => {
    const response = await request(server)
      .post('/api/agent/chat')
      .send({ message: 'Phí giao hàng và bảo hành thế nào?' })
      .expect(200);

    expect(response.body.message.content).toContain('Miễn phí giao hàng');
    expect(response.body.message.content).toContain('12 tháng');
  });

  it('runs the complete preview → confirm → order flow', async () => {
    const threadId = 'e2e-order-thread';

    const preview = await request(server)
      .post('/api/agent/chat')
      .send({
        threadId,
        message:
          'Mình muốn mua SP001, tên: Nguyễn Văn A, sđt: 0901234567, ' +
          'địa chỉ: 123 Lê Lợi, Quận 1, TP.HCM',
      })
      .expect(200);

    expect(preview.body.message.content).toContain('Đơn nháp');
    expect(preview.body.message.content).toContain('Tổng thanh toán');
    expect(preview.body.message.content).toContain('890.000');

    const confirmed = await request(server)
      .post('/api/agent/chat')
      .send({ threadId, message: 'Đồng ý' })
      .expect(200);

    expect(confirmed.body.message.content).toContain('Đã chốt đơn');
    const orderCode = /ORD-\d{8}-[A-F0-9]{6}/.exec(confirmed.body.message.content)?.[0];
    expect(orderCode).toBeDefined();

    const order = await request(server).get(`/api/orders/${orderCode}`).expect(200);
    expect(order.body).toMatchObject({
      orderCode,
      status: 'confirmed',
      customerName: 'Nguyễn Văn A',
      phoneMasked: '090****567',
      total: 890000,
    });
    expect(order.body.items[0]).toMatchObject({ productId: 'SP001', quantity: 1 });

    const product = await request(server).get('/api/catalog/products/SP001').expect(200);
    expect(product.body.stock).toBeLessThan(25);

    const history = await request(server).get(`/api/agent/threads/${threadId}`).expect(200);
    const createCall = history.body.messages
      .flatMap(
        (message: { toolCalls?: Array<{ name: string; args: Record<string, string> }> }) =>
          message.toolCalls ?? [],
      )
      .find((call: { name: string }) => call.name === 'create_order');
    expect(createCall.args.phone).toBe('090****567');
    expect(createCall.args.address).toBe('[hidden]');
  });

  it('streams sales-agent tool calls and tokens over SSE', async () => {
    const response = await request(server)
      .post('/api/agent/chat/stream')
      .send({ message: 'Tư vấn tai nghe bluetooth' })
      .buffer(true)
      .parse((res, callback) => {
        let payload = '';
        res.on('data', (chunk: Buffer) => {
          payload += chunk.toString();
        });
        res.on('end', () => callback(null, payload));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('event: meta');
    expect(response.body).toContain('event: tool_start');
    expect(response.body).toContain('search_products');
    expect(response.body).toContain('event: token');
    expect(response.body).toContain('event: done');
  });

  it('validates request bodies, params and unknown orders', async () => {
    await request(server).post('/api/agent/chat').send({ message: '' }).expect(400);
    await request(server)
      .post('/api/agent/chat')
      .send({ message: 'hello', threadId: 'bad id!' })
      .expect(400);
    await request(server).post('/api/agent/chat').send({ message: 'hi', extra: true }).expect(400);
    await request(server).get('/api/orders/ORD-20260101-ABC123').expect(404);
    await request(server).get('/api/catalog/products').query({ limit: 0 }).expect(400);
  });
});
