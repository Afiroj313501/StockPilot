import { execSync } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';

export default function setup(): void {
  dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test(\?|$)/.test(url)) {
    throw new Error('Refusing to migrate a database whose name does not end in _test');
  }
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
