import rateLimit from 'express-rate-limit';
import { AppError } from '../utils/httpError';

export function createAuthLimiter(limit: number) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.'));
    },
  });
}
