import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentModule } from './agent/agent.module.js';
import { AppController } from './app.controller.js';
import { validateEnv } from './config/env.validation.js';
import { HealthModule } from './health/health.module.js';

const currentDir = dirname(fileURLToPath(import.meta.url));

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(currentDir, '..', 'public'),
      serveRoot: '/ui',
    }),
    HealthModule,
    AgentModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
