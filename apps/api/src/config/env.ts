import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a PostgreSQL URL'),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  AI_PROVIDER: z.string().default('none'),
  AI_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(`Invalid environment configuration:\n${problems}`);
    process.exit(1);
  }

  const env = result.data;
  if (env.NODE_ENV === 'production' && env.SESSION_SECRET.startsWith('replace_with')) {
    console.error(
      'Invalid environment configuration:\n  - SESSION_SECRET: placeholder value in production',
    );
    process.exit(1);
  }
  return env;
}

export const env = loadEnv();
