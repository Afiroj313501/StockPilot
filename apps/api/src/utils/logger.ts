import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.apiKey'],
});
