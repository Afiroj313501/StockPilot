import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { uuidParam } from '../../utils/params';
import { getAuth, requireAuth } from '../auth/auth.middleware';
import { getStore, requireStore } from '../auth/store.middleware';
import {
  checkoutSchema,
  listSalesQuery,
  previewSaleSchema,
  type CheckoutInput,
  type PreviewInput,
} from './sales.schemas';
import { checkout, getSale, listSales, previewSale } from './sales.service';

export const salesRouter = Router();

// Every role can sell. Visibility of history is limited in the service (cashiers: own sales).
salesRouter.use(requireAuth, requireStore);

// Prices a cart without saving anything. Uses the same rules as checkout.
salesRouter.post(
  '/preview',
  validateBody(previewSaleSchema),
  asyncHandler(async (req, res) => {
    const store = getStore(res);
    res.json(await previewSale(store.storeId, store.role, req.body as PreviewInput));
  }),
);

salesRouter.post(
  '/',
  validateBody(checkoutSchema),
  asyncHandler(async (req, res) => {
    const store = getStore(res);
    const { sale, replayed } = await checkout(
      store.storeId,
      store.role,
      getAuth(res).user.id,
      req.body as CheckoutInput,
    );
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(replayed ? 200 : 201).json(sale);
  }),
);

salesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const store = getStore(res);
    res.json(await listSales(store.storeId, store.role, getAuth(res).user.id, listSalesQuery.parse(req.query)));
  }),
);

salesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const store = getStore(res);
    res.json(await getSale(store.storeId, store.role, getAuth(res).user.id, uuidParam.parse(req.params.id)));
  }),
);