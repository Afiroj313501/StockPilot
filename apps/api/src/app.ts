import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFound } from './middleware/errorHandler';
import { originGuard } from './middleware/originGuard';
import { createAuthLimiter } from './middleware/rateLimit';
import { requestId } from './middleware/requestId';
import { createAuthRouter } from './modules/auth/auth.routes';
import { healthRouter } from './modules/health/health.routes';
import { storesRouter } from './modules/stores/stores.routes';
import { usersRouter } from './modules/users/users.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import { categoriesRouter } from './modules/categories/categories.routes';
import { productsRouter } from './modules/products/products.routes';

export interface AppOptions {
  authRateLimitMax?: number;
}

export function createApp(options: AppOptions = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(originGuard);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const authLimiter = createAuthLimiter(options.authRateLimitMax ?? 10);
  app.use('/api/v1/health', healthRouter);
  app.use('/api/v1/auth', createAuthRouter(authLimiter));
  app.use('/api/v1/stores', storesRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/categories', categoriesRouter);
  app.use('/api/v1/products', productsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
