import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { uuidParam } from '../../utils/params';
import { requireAuth } from '../auth/auth.middleware';
import { requireRole } from '../auth/rbac';
import { getStore, requireStore } from '../auth/store.middleware';
import {
  supplierSchema,
  supplierUpdateSchema,
  type SupplierInput,
  type SupplierUpdateInput,
} from './suppliers.schemas';
import {
  archiveSupplier,
  createSupplier,
  listSuppliers,
  updateSupplier,
} from './suppliers.service';

export const suppliersRouter = Router();
suppliersRouter.use(requireAuth, requireStore, requireRole('MANAGER'));
suppliersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const includeArchived = req.query.includeArchived === 'true';
    res.json({ items: await listSuppliers(getStore(res).storeId, includeArchived) });
  }),
);
suppliersRouter.post(
  '/',
  validateBody(supplierSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createSupplier(getStore(res).storeId, req.body as SupplierInput));
  }),
);
suppliersRouter.patch(
  '/:id',
  validateBody(supplierUpdateSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await updateSupplier(
        getStore(res).storeId,
        uuidParam.parse(req.params.id),
        req.body as SupplierUpdateInput,
      ),
    );
  }),
);
suppliersRouter.post(
  '/:id/archive',
  asyncHandler(async (req, res) => {
    res.json(await archiveSupplier(getStore(res).storeId, uuidParam.parse(req.params.id)));
  }),
);
