import { Router, type RequestHandler } from 'express';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/httpError';
import { recordAuthEvent, recordFailedLogin } from '../audit/audit.service';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from './auth.cookies';
import { getAuth, requireAuth } from './auth.middleware';
import {
  changePasswordSchema,
  loginSchema,
  profileSchema,
  registerSchema,
  type ChangePasswordInput,
  type LoginInput,
  type ProfileInput,
  type RegisterInput,
} from './auth.schemas';
import {
  changePassword,
  getAccount,
  login,
  logout,
  registerOwner,
  resolveSession,
  updateProfile,
} from './auth.service';

export function createAuthRouter(
  authLimiter: RequestHandler,
  accountLimiter: RequestHandler,
  passwordLimiter: RequestHandler,
): Router {
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
        if (err instanceof AppError && err.code === 'INVALID_CREDENTIALS')
          await recordFailedLogin(input.email, res.locals.requestId);
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
        if (auth)
          await recordAuthEvent({
            userId: auth.user.id,
            action: 'auth.logout',
            summary: 'Signed out',
            requestId: res.locals.requestId,
          });
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
  router.post(
    '/change-password',
    requireAuth,
    passwordLimiter,
    validateBody(changePasswordSchema),
    asyncHandler(async (req, res) => {
      const auth = getAuth(res);
      const input = req.body as ChangePasswordInput;
      await changePassword(auth.user.id, auth.sessionId, input.currentPassword, input.newPassword);
      await recordAuthEvent({
        userId: auth.user.id,
        action: 'auth.password_change',
        summary: 'Changed their password',
        requestId: res.locals.requestId,
      });
      res.status(204).end();
    }),
  );
  router.patch(
    '/profile',
    requireAuth,
    validateBody(profileSchema),
    asyncHandler(async (req, res) => {
      const auth = getAuth(res);
      await updateProfile(auth.user.id, (req.body as ProfileInput).name);
      await recordAuthEvent({
        userId: auth.user.id,
        action: 'auth.profile_update',
        summary: 'Changed their name',
        requestId: res.locals.requestId,
      });
      res.json(await getAccount(auth.user.id));
    }),
  );
  return router;
}
