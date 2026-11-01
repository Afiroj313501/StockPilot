import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { uuidParam } from '../../utils/params';
import { getAuth, requireAuth } from '../auth/auth.middleware';
import { requireRole } from '../auth/rbac';
import { getStore, requireStore } from '../auth/store.middleware';
import { receivePurchaseSchema, type ReceivePurchaseInput } from './receiving.schemas';
import { receivePurchase } from './receiving.service';
import {
  cancelPurchaseSchema,
  createPurchaseSchema,
  listPurchasesQuery,
  updatePurchaseSchema,
  type CancelPurchaseInput,
  type CreatePurchaseInput,
  type UpdatePurchaseInput,
} from './purchases.schemas';
import {
  approvePurchase,
  cancelPurchase,
  createPurchase,
  getPurchase,
  listPurchases,
  submitPurchase,
  updatePurchase,
} from './purchases.service';

export const purchasesRouter = Router();
purchasesRouter.use(requireAuth, requireStore, requireRole('MANAGER'));

purchasesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listPurchases(getStore(res).storeId, listPurchasesQuery.parse(req.query)));
  }),
);

purchasesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await getPurchase(getStore(res).storeId, uuidParam.parse(req.params.id)));
  }),
);

purchasesRouter.post(
  '/',
  validateBody(createPurchaseSchema),
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(
        await createPurchase(
          getStore(res).storeId,
          getAuth(res).user.id,
          req.body as CreatePurchaseInput,
        ),
      );
  }),
);

purchasesRouter.patch(
  '/:id',
  validateBody(updatePurchaseSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await updatePurchase(
        getStore(res).storeId,
        uuidParam.parse(req.params.id),
        req.body as UpdatePurchaseInput,
      ),
    );
  }),
);

purchasesRouter.post(
  '/:id/submit',
  asyncHandler(async (req, res) => {
    res.json(await submitPurchase(getStore(res).storeId, uuidParam.parse(req.params.id)));
  }),
);

purchasesRouter.post(
  '/:id/approve',
  requireRole('OWNER'),
  asyncHandler(async (req, res) => {
    res.json(
      await approvePurchase(
        getStore(res).storeId,
        uuidParam.parse(req.params.id),
        getAuth(res).user.id,
      ),
    );
  }),
);

purchasesRouter.post(
  '/:id/cancel',
  validateBody(cancelPurchaseSchema),
  asyncHandler(async (req, res) => {
    const { reason } = req.body as CancelPurchaseInput;
    res.json(await cancelPurchase(getStore(res).storeId, uuidParam.parse(req.params.id), reason));
  }),
);

// Managers and owners can receive stock against an approved order.
purchasesRouter.post(
  '/:id/receive',
  validateBody(receivePurchaseSchema),
  asyncHandler(async (req, res) => {
    const { order, replayed } = await receivePurchase(
      getStore(res).storeId,
      getAuth(res).user.id,
      uuidParam.parse(req.params.id),
      req.body as ReceivePurchaseInput,
    );
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(replayed ? 200 : 201).json(order);
  }),
);