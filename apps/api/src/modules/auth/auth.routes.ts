import { Router, type RequestHandler } from 'express';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from './auth.cookies';
import { getAuth, requireAuth } from './auth.middleware';
import { loginSchema, registerSchema, type LoginInput, type RegisterInput } from './auth.schemas';
import { getAccount, login, logout, registerOwner } from './auth.service';

export function createAuthRouter(authLimiter: RequestHandler): Router {
  const router = Router();
  router.post(
    '/register',
    authLimiter,
    validateBody(registerSchema),
    asyncHandler(async (req, res) => {
      const { userId, session } = await registerOwner(req.body as RegisterInput);
      setSessionCookie(res, session.token, session.expiresAt);
      res.status(201).json(await getAccount(userId));
    }),
  );
  router.post(
    '/login',
    authLimiter,
    validateBody(loginSchema),
    asyncHandler(async (req, res) => {
      const { userId, session } = await login(req.body as LoginInput);
      setSessionCookie(res, session.token, session.expiresAt);
      res.json(await getAccount(userId));
    }),
  );
  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const token: unknown = req.cookies?.[SESSION_COOKIE];
      if (typeof token === 'string' && token.length > 0) await logout(token);
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
