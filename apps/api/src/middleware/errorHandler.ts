import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/httpError';
import { logger } from '../utils/logger';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Resource not found', requestId: res.locals.requestId },
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = res.locals.requestId;

  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, requestId } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are invalid',
        details: err.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
        requestId,
      },
    });
    return;
  }

  if (
    typeof err === 'object' &&
    err !== null &&
    (err as { type?: string }).type === 'entity.parse.failed'
  ) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body', requestId } });
    return;
  }

  logger.error({ err, requestId }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Quote the request ID when reporting this.',
      requestId: res.locals.requestId,
    },
  });
}
