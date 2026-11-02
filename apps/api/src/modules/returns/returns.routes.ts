import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { uuidParam } from '../../utils/params';
import { getAuth, requireAuth } from '../auth/auth.middleware';
import { requireRole } from '../auth/rbac';
import { getStore, requireStore } from '../auth/store.middleware';
import {
  createReturnSchema,
  listReturnsQuery,
  previewReturnSchema,
  type CreateReturnInput,
  type PreviewReturnInput,
} from './returns.schemas';
import { createReturn, getReturn, getSaleReturnable, listReturns, previewReturn } from './returns.service';

export const returnsRouter = Router();

// Managers and owners only. The role check runs before any validation or database access.
returnsRouter.use(requireAuth, requireStore, requireRole('MANAGER'));

returnsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listReturns(getStore(res).storeId, listReturnsQuery.parse(req.query)));
  }),
);

returnsRouter.get(
  '/by-sale/:saleId',
  asyncHandler(async (req, res) => {
    res.json(await getSaleReturnable(getStore(res).storeId, uuidParam.parse(req.params.saleId)));
  }),
);

// Works out the refund without saving anything. Uses the same rules as the real return.
returnsRouter.post(
  '/preview',
  validateBody(previewReturnSchema),
  asyncHandler(async (req, res) => {
    res.json(await previewReturn(getStore(res).storeId, req.body as PreviewReturnInput));
  }),
);

returnsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await getReturn(getStore(res).storeId, uuidParam.parse(req.params.id)));
  }),
);

returnsRouter.post(
  '/',
  validateBody(createReturnSchema),
  asyncHandler(async (req, res) => {
    const { result, replayed } = await createReturn(
      getStore(res).storeId,
      getAuth(res).user.id,
      req.body as CreateReturnInput,
    );
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(replayed ? 200 : 201).json(result);
  }),
);