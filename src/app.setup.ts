import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Env } from './config/env.validation.js';

export interface ConfigureAppOptions {
  swagger?: boolean;
}

/**
 * Shared HTTP bootstrap used by `main.ts` and the e2e tests, so validation,
 * CORS and docs behave identically in both.
 */
export function configureApp(app: INestApplication, options: ConfigureAppOptions = {}): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const swaggerEnabled = options.swagger ?? config.get('SWAGGER_ENABLED', { infer: true });

  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });
  app.enableCors({
    origin: corsOrigins === '*' ? true : corsOrigins.split(',').map((origin) => origin.trim()),
    credentials: corsOrigins !== '*',
  });

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('NestJS × LangGraph Agent API')
      .setDescription(
        'A stateful, tool-calling agent built with NestJS and LangGraph. ' +
          'Use POST /api/agent/chat for a single response or /api/agent/chat/stream for SSE.',
      )
      .setVersion('1.0.0')
      .addTag('agent', 'Agent conversations, streaming and thread history')
      .addTag('catalog', 'Product catalog search and details')
      .addTag('orders', 'Public order tracking')
      .addTag('health', 'Liveness checks')
      .build();

    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }
}
