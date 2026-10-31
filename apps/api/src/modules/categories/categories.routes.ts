import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { uuidParam } from '../../utils/params';
import { requireAuth } from '../auth/auth.middleware';
import { requireRole } from '../auth/rbac';
import { getStore, requireStore } from '../auth/store.middleware';
import { categoryBodySchema, type CategoryBody } from './categories.schemas';
import {
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
} from './categories.service';

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth, requireStore);

categoriesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ items: await listCategories(getStore(res).storeId) });
  }),
);

categoriesRouter.post(
  '/',
  requireRole('MANAGER'),
  validateBody(categoryBodySchema),
  asyncHandler(async (req, res) => {
    const { name } = req.body as CategoryBody;
    res.status(201).json(await createCategory(getStore(res).storeId, name));
  }),
);

categoriesRouter.patch(
  '/:id',
  requireRole('MANAGER'),
  validateBody(categoryBodySchema),
  asyncHandler(async (req, res) => {
    const { name } = req.body as CategoryBody;
    res.json(await renameCategory(getStore(res).storeId, uuidParam.parse(req.params.id), name));
  }),
);

categoriesRouter.delete(
  '/:id',
  requireRole('MANAGER'),
  asyncHandler(async (req, res) => {
    await deleteCategory(getStore(res).storeId, uuidParam.parse(req.params.id));
    res.status(204).end();
  }),
);
