import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { getAuth, requireAuth } from '../auth/auth.middleware';
import { requireRole } from '../auth/rbac';
import { getStore, requireStore } from '../auth/store.middleware';
import {
  createMovementSchema,
  listMovementsQuery,
  lowStockQuery,
  type CreateMovementInput,
} from './inventory.schemas';
import { checkIntegrity, listLowStock, listMovements, recordMovement } from './inventory.service';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth, requireStore, requireRole('MANAGER'));

inventoryRouter.post(
  '/movements',
  validateBody(createMovementSchema),
  asyncHandler(async (req, res) => {
    const result = await recordMovement(
      getStore(res).storeId,
      getAuth(res).user.id,
      req.body as CreateMovementInput,
    );
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(result.replayed ? 200 : 201).json(result.movement);
  }),
);
inventoryRouter.get(
  '/movements',
  asyncHandler(async (req, res) => {
    res.json(await listMovements(getStore(res).storeId, listMovementsQuery.parse(req.query)));
  }),
);
inventoryRouter.get(
  '/low-stock',
  asyncHandler(async (req, res) => {
    res.json(await listLowStock(getStore(res).storeId, lowStockQuery.parse(req.query)));
  }),
);
inventoryRouter.get(
  '/integrity',
  asyncHandler(async (_req, res) => {
    res.json(await checkIntegrity(getStore(res).storeId));
  }),
);
