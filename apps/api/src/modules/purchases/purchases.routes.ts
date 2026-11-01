import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { uuidParam } from '../../utils/params';
import { getAuth, requireAuth } from '../auth/auth.middleware';
import { requireRole } from '../auth/rbac';
import { getStore, requireStore } from '../auth/store.middleware';
import { purchaseOrderSchema, type PurchaseOrderInput } from './purchases.schemas';
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  submitPurchaseOrder,
  updatePurchaseOrder,
} from './purchases.service';

export const purchasesRouter = Router();
purchasesRouter.use(requireAuth, requireStore, requireRole('MANAGER'));
purchasesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ items: await listPurchaseOrders(getStore(res).storeId) });
  }),
);
purchasesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await getPurchaseOrder(getStore(res).storeId, uuidParam.parse(req.params.id)));
  }),
);
purchasesRouter.post(
  '/',
  validateBody(purchaseOrderSchema),
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(
        await createPurchaseOrder(
          getStore(res).storeId,
          getAuth(res).user.id,
          req.body as PurchaseOrderInput,
        ),
      );
  }),
);
purchasesRouter.patch(
  '/:id',
  validateBody(purchaseOrderSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await updatePurchaseOrder(
        getStore(res).storeId,
        uuidParam.parse(req.params.id),
        req.body as PurchaseOrderInput,
      ),
    );
  }),
);
purchasesRouter.post(
  '/:id/submit',
  asyncHandler(async (req, res) => {
    res.json(
      await submitPurchaseOrder(
        getStore(res).storeId,
        uuidParam.parse(req.params.id),
        getAuth(res).user.id,
      ),
    );
  }),
);
purchasesRouter.post(
  '/:id/approve',
  requireRole('OWNER'),
  asyncHandler(async (req, res) => {
    res.json(
      await approvePurchaseOrder(
        getStore(res).storeId,
        uuidParam.parse(req.params.id),
        getAuth(res).user.id,
      ),
    );
  }),
);
purchasesRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    res.json(
      await cancelPurchaseOrder(
        getStore(res).storeId,
        uuidParam.parse(req.params.id),
        getAuth(res).user.id,
      ),
    );
  }),
);
