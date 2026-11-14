import { Router, type RequestHandler } from 'express';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/httpError';
import { recordAuthEvent, recordFailedLogin } from '../audit/audit.service';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from './auth.cookies';
import { getAuth, requireAuth } from './auth.middleware';
import { loginSchema, registerSchema, type LoginInput, type RegisterInput } from './auth.schemas';
import { getAccount, login, logout, registerOwner, resolveSession } from './auth.service';

export function createAuthRouter(authLimiter: RequestHandler, accountLimiter: RequestHandler): Router {
  const router = Router();
  router.post(
    '/register',
    authLimiter,
    validateBody(registerSchema),
    asyncHandler(async (req, res) => {
      const { userId, session } = await registerOwner(req.body as RegisterInput);
      setSessionCookie(res, session.token, session.expiresAt);
      await recordAuthEvent({
        userId,
        action: 'auth.register',
        summary: 'Created the account and the store',
        requestId: res.locals.requestId,
      });
      res.status(201).json(await getAccount(userId));
    }),
  );
  router.post(
    '/login',
    authLimiter,
    validateBody(loginSchema),
    accountLimiter,
    asyncHandler(async (req, res) => {
      const input = req.body as LoginInput;
      try {
        const { userId, session } = await login(input);
        setSessionCookie(res, session.token, session.expiresAt);
        await recordAuthEvent({
          userId,
          action: 'auth.login',
          summary: 'Signed in',
          requestId: res.locals.requestId,
        });
        res.json(await getAccount(userId));
      } catch (err) {
        if (err instanceof AppError && err.code === 'INVALID_CREDENTIALS') {
          await recordFailedLogin(input.email, res.locals.requestId);
        }
        throw err;
      }
    }),
  );
  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const token: unknown = req.cookies?.[SESSION_COOKIE];
      if (typeof token === 'string' && token.length > 0) {
        const auth = await resolveSession(token);
        if (auth) {
          await recordAuthEvent({
            userId: auth.user.id,
            action: 'auth.logout',
            summary: 'Signed out',
            requestId: res.locals.requestId,
          });
        }
        await logout(token);
      }
      clearSessionCookie(res);
      res.status(204).end();
    }),
  );
  router.get('/me', requireAuth, (_req, res) => {
    const auth = getAuth(res);
    res.json({ user: auth.user, memberships: auth.memberships });
  });
  return router;
}
