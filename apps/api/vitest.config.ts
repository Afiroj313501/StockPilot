import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      SESSION_SECRET: 'test_secret_that_is_at_least_32_characters_long',
      WEB_ORIGIN: 'http://localhost:5173',
    },
  },
});
