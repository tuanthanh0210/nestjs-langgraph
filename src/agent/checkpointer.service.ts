import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseCheckpointSaver, MemorySaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Pool } from 'pg';
import type { Env } from '../config/env.validation.js';

export type PersistenceKind = 'memory' | 'postgres';

/**
 * Owns the LangGraph checkpointer (short-term memory).
 *
 * - No DATABASE_URL → MemorySaver. Great for local dev; history is lost on restart.
 * - DATABASE_URL    → PostgresSaver. Conversations survive restarts and deploys.
 *
 * Checkpoints store the full graph state per thread, which is what enables
 * multi-turn memory. `setup()` is idempotent and creates the required tables.
 */
@Injectable()
export class CheckpointerService implements OnModuleDestroy {
  private readonly logger = new Logger(CheckpointerService.name);
  private readonly postgresSaver?: PostgresSaver;

  readonly kind: PersistenceKind;
  readonly checkpointer: BaseCheckpointSaver;

  constructor(config: ConfigService<Env, true>) {
    const databaseUrl = config.get('DATABASE_URL', { infer: true });

    if (!databaseUrl) {
      this.kind = 'memory';
      this.checkpointer = new MemorySaver();
      this.logger.warn('Persistence: in-memory (conversations are lost on restart).');
      return;
    }

    const pool = new Pool({
      connectionString: databaseUrl,
      max: config.get('DB_POOL_MAX', { infer: true }),
    });

    this.postgresSaver = new PostgresSaver(pool);
    this.checkpointer = this.postgresSaver;
    this.kind = 'postgres';

    const parsed = new URL(databaseUrl);
    this.logger.log(`Persistence: postgres (${parsed.host}${parsed.pathname})`);
  }

  /** Creates the checkpoint tables on first use. Safe to call repeatedly. */
  async ensureReady(): Promise<void> {
    if (!this.postgresSaver) return;
    await this.postgresSaver.setup();
    this.logger.log('Postgres checkpointer schema is ready.');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.postgresSaver) {
      await this.postgresSaver.end();
    }
  }
}
