import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../auth/auth.middleware';
import { requireRole } from '../auth/rbac';
import { getStore, requireStore } from '../auth/store.middleware';
import { ask } from './assistant';
import { SUPPORTED_QUESTIONS } from './builtin';
import type { ProviderStatus } from './config';

export const askSchema = z
  .object({
    question: z.string().trim().min(1, 'Ask a question').max(500, 'Use at most 500 characters'),
  })
  .strict();

const PRIVACY =
  "When an AI provider is configured, your question and the results of the lookups it requests (product names, SKUs, sales, stock and cost figures, today's date, the currency and the time zone) are sent to that provider. Customer names, staff names, email addresses and the store name are never sent. Without a provider, nothing leaves this server.";

export function createAiRouter(options: {
  limiter: RequestHandler;
  getStatus: () => ProviderStatus;
}): Router {
  const router = Router();

  router.use(requireAuth, requireStore, requireRole('MANAGER'));

  router.get('/status', (_req, res) => {
    const status = options.getStatus();
    res.json({
      mode: status.provider ? 'AI' : 'BUILT_IN',
      reason: status.reason,
      providerName: status.provider?.name ?? null,
      supportedQuestions: SUPPORTED_QUESTIONS,
      privacy: PRIVACY,
    });
  });

  router.post(
    '/ask',
    options.limiter,
    validateBody(askSchema),
    asyncHandler(async (req, res) => {
      const store = getStore(res);
      const { question } = req.body as z.infer<typeof askSchema>;
      const result = await ask(
        { storeId: store.storeId, role: store.role },
        question,
        options.getStatus(),
        res.locals.requestId,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    }),
  );

  return router;
}
