import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFound } from './middleware/errorHandler';
import { originGuard } from './middleware/originGuard';
import { createAuthLimiter, createUserLimiter } from './middleware/rateLimit';
import { requestId } from './middleware/requestId';
import { createAuthRouter } from './modules/auth/auth.routes';
import { healthRouter } from './modules/health/health.routes';
import { storesRouter } from './modules/stores/stores.routes';
import { usersRouter } from './modules/users/users.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import { categoriesRouter } from './modules/categories/categories.routes';
import { productsRouter } from './modules/products/products.routes';
import { inventoryRouter } from './modules/inventory/inventory.routes';
import { suppliersRouter } from './modules/suppliers/suppliers.routes';
import { purchasesRouter } from './modules/purchases/purchases.routes';
import { salesRouter } from './modules/sales/sales.routes';
import { returnsRouter } from './modules/returns/returns.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { forecastingRouter } from './modules/forecasting/forecasting.routes';
import { createAiRouter } from './modules/ai/ai.routes';
import { resolveProvider, type ProviderStatus } from './modules/ai/config';
import type { AiProvider } from './modules/ai/provider';

export interface AppOptions {
  authRateLimitMax?: number;
  aiRateLimitMax?: number;
  // undefined = decide from the environment, null = built-in answers only (used by tests)
  aiProvider?: AiProvider | null;
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
  const envAi = resolveProvider(env);
  const aiStatus = (): ProviderStatus =>
    options.aiProvider === undefined
      ? envAi
      : {
          provider: options.aiProvider,
          reason: options.aiProvider ? 'ENABLED' : 'DISABLED',
          timeoutMs: env.AI_TIMEOUT_MS,
        };
  const aiLimiter = createUserLimiter(options.aiRateLimitMax ?? 20);
  app.use('/api/v1/health', healthRouter);
  app.use('/api/v1/auth', createAuthRouter(authLimiter));
  app.use('/api/v1/stores', storesRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/categories', categoriesRouter);
  app.use('/api/v1/products', productsRouter);
  app.use('/api/v1/inventory', inventoryRouter);
  app.use('/api/v1/suppliers', suppliersRouter);
  app.use('/api/v1/purchases', purchasesRouter);
  app.use('/api/v1/sales', salesRouter);
  app.use('/api/v1/returns', returnsRouter);
  app.use('/api/v1/reports', reportsRouter);
  app.use('/api/v1/forecasting', forecastingRouter);
  app.use('/api/v1/ai', createAiRouter({ limiter: aiLimiter, getStatus: aiStatus }));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
