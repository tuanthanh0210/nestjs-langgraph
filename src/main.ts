import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { Env } from './config/env.validation.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  configureApp(app);

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');

  logger.log(`API        → http://localhost:${port}/api`);
  logger.log(`Demo UI    → http://localhost:${port}/ui/`);
  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    logger.log(`Swagger UI → http://localhost:${port}/docs`);
  }
}

await bootstrap();
