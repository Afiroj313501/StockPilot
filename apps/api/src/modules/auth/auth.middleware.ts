import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../utils/httpError';
import { clearSessionCookie, SESSION_COOKIE } from './auth.cookies';
import { resolveSession, type AuthContext } from './auth.service';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
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
    next();
  } catch (err) {
    next(err);
  }
}

export function getAuth(res: Response): AuthContext {
  return res.locals.auth as AuthContext;
}
