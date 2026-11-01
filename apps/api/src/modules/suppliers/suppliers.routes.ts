import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { uuidParam } from '../../utils/params';
import { requireAuth } from '../auth/auth.middleware';
import { requireRole } from '../auth/rbac';
import { getStore, requireStore } from '../auth/store.middleware';
import {
  createSupplierSchema,
  listSuppliersQuery,
  updateSupplierSchema,
  type CreateSupplierInput,
  type UpdateSupplierInput,
} from './suppliers.schemas';
import { createSupplier, getSupplier, listSuppliers, updateSupplier } from './suppliers.service';

export const suppliersRouter = Router();

suppliersRouter.use(requireAuth, requireStore, requireRole('MANAGER'));

suppliersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listSuppliers(getStore(res).storeId, listSuppliersQuery.parse(req.query)));
  }),
);

suppliersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await getSupplier(getStore(res).storeId, uuidParam.parse(req.params.id)));
  }),
);

suppliersRouter.post(
  '/',
  validateBody(createSupplierSchema),
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(await createSupplier(getStore(res).storeId, req.body as CreateSupplierInput));
  }),
);

suppliersRouter.patch(
  '/:id',
  validateBody(updateSupplierSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await updateSupplier(
        getStore(res).storeId,
        uuidParam.parse(req.params.id),
        req.body as UpdateSupplierInput,
      ),
    );
  }),
);
