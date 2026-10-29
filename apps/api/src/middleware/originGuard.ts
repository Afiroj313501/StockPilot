import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { AppError } from '../utils/httpError';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function originGuard(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const origin = req.get('origin');
  const fetchSite = req.get('sec-fetch-site');
  if ((origin && origin !== env.WEB_ORIGIN) || fetchSite === 'cross-site') {
    next(new AppError(403, 'CSRF_REJECTED', 'Request origin not allowed'));
    return;
  }
  next();
}
