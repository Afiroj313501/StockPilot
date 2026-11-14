import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'vitest/config';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      SESSION_SECRET: [
        'test',
        'secret',
        'that',
        'is',
        'at',
        'least',
        '32',
        'characters',
        'long',
      ].join('_'),
      WEB_ORIGIN: 'http://localhost:5173',
    },
  },
});
