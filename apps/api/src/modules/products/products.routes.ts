import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { uuidParam } from '../../utils/params';
import { requireAuth } from '../auth/auth.middleware';
import { requireRole } from '../auth/rbac';
import { getStore, requireStore } from '../auth/store.middleware';
import {
  createProductSchema,
  listProductsQuery,
  updateProductSchema,
  type CreateProductInput,
  type UpdateProductInput,
} from './products.schemas';
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from './products.service';

export const productsRouter = Router();
productsRouter.use(requireAuth, requireStore);

productsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const store = getStore(res);
    res.json(await listProducts(store.storeId, store.role, listProductsQuery.parse(req.query)));
  }),
);
productsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const store = getStore(res);
    res.json(await getProduct(store.storeId, store.role, uuidParam.parse(req.params.id)));
  }),
);
productsRouter.post(
  '/',
  requireRole('MANAGER'),
  validateBody(createProductSchema),
  asyncHandler(async (req, res) => {
    const store = getStore(res);
    res
      .status(201)
      .json(await createProduct(store.storeId, store.role, req.body as CreateProductInput));
  }),
);
productsRouter.patch(
  '/:id',
  requireRole('MANAGER'),
  validateBody(updateProductSchema),
  asyncHandler(async (req, res) => {
    const store = getStore(res);
    res.json(
      await updateProduct(
        store.storeId,
        store.role,
        uuidParam.parse(req.params.id),
        req.body as UpdateProductInput,
      ),
    );
  }),
);
productsRouter.delete(
  '/:id',
  requireRole('OWNER'),
  asyncHandler(async (req, res) => {
    await deleteProduct(getStore(res).storeId, uuidParam.parse(req.params.id));
    res.status(204).end();
  }),
);
