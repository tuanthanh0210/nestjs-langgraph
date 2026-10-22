import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

describe('Agent API (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;

  beforeAll(async () => {
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
  });

  it('GET /api/health → ok', async () => {
    const response = await request(server).get('/api/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.uptime).toBeTypeOf('number');
  });

  it('GET /api/agent/info → mock provider and registered tools', async () => {
    const response = await request(server).get('/api/agent/info').expect(200);
    expect(response.body.provider).toBe('mock');
    expect(response.body.persistence).toBe('memory');
    expect(response.body.maxIterations).toBeGreaterThan(0);
    expect(response.body.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining(['calculator', 'current_time', 'get_weather']),
    );
  });

  it('POST /api/agent/chat → executes a tool and returns a final answer', async () => {
    const response = await request(server)
      .post('/api/agent/chat')
      .send({ message: 'Tính 12 * (3 + 1) giúp anh' })
      .expect(200);

    expect(response.body.threadId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    expect(response.body.iterations).toBe(2);
    expect(response.body.message.role).toBe('assistant');
    expect(response.body.message.content).toContain('12 * (3 + 1) = 48');
  });

  it('keeps multi-turn history and can delete a thread', async () => {
    const threadId = 'e2e-thread-history';

    await request(server)
      .post('/api/agent/chat')
      .send({ message: 'Tính 2 + 2', threadId })
      .expect(200);

    const second = await request(server)
      .post('/api/agent/chat')
      .send({ message: 'Còn 3 * 3 thì sao?', threadId })
      .expect(200);
    expect(second.body.threadId).toBe(threadId);

    const history = await request(server).get(`/api/agent/threads/${threadId}`).expect(200);
    expect(history.body.exists).toBe(true);
    expect(history.body.messages).toHaveLength(8);
    expect(history.body.messages[0]).toMatchObject({ role: 'user', content: 'Tính 2 + 2' });
    expect(history.body.messages.at(-1).role).toBe('assistant');

    await request(server).delete(`/api/agent/threads/${threadId}`).expect(204);

    const deleted = await request(server).get(`/api/agent/threads/${threadId}`).expect(200);
    expect(deleted.body.exists).toBe(false);
  });

  it('streams meta, tool and token events over SSE', async () => {
    const response = await request(server)
      .post('/api/agent/chat/stream')
      .send({ message: 'Mấy giờ rồi?' })
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
    expect(response.body).toContain('event: token');
    expect(response.body).toContain('event: done');
    expect(response.body).toContain('current_time');
  });

  it('validates request bodies and params', async () => {
    await request(server).post('/api/agent/chat').send({ message: '' }).expect(400);
    await request(server)
      .post('/api/agent/chat')
      .send({ message: 'hello', threadId: 'bad id!' })
      .expect(400);
    await request(server).post('/api/agent/chat').send({ message: 'hi', extra: true }).expect(400);
    await request(server).get('/api/agent/threads/bad%20id!').expect(400);
  });
});
