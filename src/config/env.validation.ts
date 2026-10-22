import { z } from 'zod';

/**
 * Runtime configuration schema.
 *
 * Every environment variable is validated once at boot. Invalid values fail
 * fast with a readable message instead of surfacing later as odd runtime bugs.
 */
const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const timeZoneString = z
  .string()
  .min(1)
  .refine(
    (timeZone) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'must be a valid IANA time zone (e.g. "Asia/Ho_Chi_Minh" or "UTC")' },
  );

const booleanString = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return value;
}, z.boolean());

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    CORS_ORIGINS: z.string().min(1).default('*'),

    // LLM ------------------------------------------------------------------
    LLM_PROVIDER: z.enum(['openai', 'mock']).optional(),
    OPENAI_API_KEY: optionalString,
    OPENAI_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    OPENAI_MODEL: z.string().min(1).default('gpt-4o-mini'),
    LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
    LLM_MAX_TOKENS: z.coerce.number().int().min(1).max(32_768).default(1024),

    // Agent ----------------------------------------------------------------
    AGENT_MAX_ITERATIONS: z.coerce.number().int().min(1).max(20).default(8),
    AGENT_SYSTEM_PROMPT: optionalString,
    DEFAULT_TIMEZONE: timeZoneString.default('Asia/Ho_Chi_Minh'),

    // Persistence ----------------------------------------------------------
    DATABASE_URL: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .refine(
          (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
          'DATABASE_URL must be a postgres:// or postgresql:// connection string',
        )
        .optional(),
    ),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

    // Docs -----------------------------------------------------------------
    SWAGGER_ENABLED: booleanString.default(true),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENAI_API_KEY'],
        message: 'OPENAI_API_KEY is required when LLM_PROVIDER=openai',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration → ${details}`);
  }

  return result.data;
}
