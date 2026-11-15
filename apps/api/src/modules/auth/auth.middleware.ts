import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../utils/httpError';
import { clearSessionCookie, SESSION_COOKIE } from './auth.cookies';
import { resolveSession, type AuthContext } from './auth.service';

const ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED = new Set([
  '/api/v1/auth/me',
  '/api/v1/auth/change-password',
]);

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (res.locals.auth) {
      next();
      return;
    }
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length === 0) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    const auth = await resolveSession(token);
    if (!auth) {
      clearSessionCookie(res);
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    res.locals.auth = auth;
    if (
      auth.user.mustChangePassword &&
      !ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED.has(req.originalUrl.split('?')[0] ?? '')
    ) {
      throw new AppError(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'You must choose a new password before continuing.',
      );
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function getAuth(res: Response): AuthContext {
  return res.locals.auth as AuthContext;
}
