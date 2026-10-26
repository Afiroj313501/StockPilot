import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Resource not found', requestId: res.locals.requestId },
  });
}

// Express recognises error handlers by their 4 arguments; keep all four.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error({ err, requestId: res.locals.requestId }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Quote the request ID when reporting this.',
      requestId: res.locals.requestId,
    },
  });
}
