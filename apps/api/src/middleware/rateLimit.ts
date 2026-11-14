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

// Limits requests per logged-in user (not per IP). Place it after requireAuth.
export function createUserLimiter(limit: number, windowMs = 15 * 60 * 1000) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (_req, res) =>
      (res.locals.auth as { user: { id: string } } | undefined)?.user.id ?? 'anonymous',
    handler: (_req, _res, next) => {
      next(
        new AppError(
          429,
          'RATE_LIMITED',
          'Too many questions. Please wait a few minutes and try again.',
        ),
      );
    },
  });
}

// Limits FAILED sign-ins per account (email), whatever the IP address. Successful sign-ins never count.
// Place it after the body is validated, so the email is already trimmed and lower-cased.
export function createLoginAccountLimiter(limit: number, windowMs = 15 * 60 * 1000) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) =>
      `account:${String((req.body as { email?: unknown } | undefined)?.email ?? 'none').toLowerCase()}`,
    handler: (_req, _res, next) => {
      next(
        new AppError(
          429,
          'RATE_LIMITED',
          'Too many failed sign-in attempts for this account. Please wait a few minutes and try again.',
        ),
      );
    },
  });
}
