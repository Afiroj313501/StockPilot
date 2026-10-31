import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../auth/auth.middleware';
import { requireRole } from '../auth/rbac';
import { getStore, requireStore } from '../auth/store.middleware';
import { updateSettingsSchema, type UpdateSettingsInput } from './settings.schemas';
import { getSettings, updateSettings } from './settings.service';

export const settingsRouter = Router();

settingsRouter.use(requireAuth, requireStore);

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await getSettings(getStore(res).storeId));
  }),
);

settingsRouter.patch(
  '/',
  requireRole('OWNER'),
  validateBody(updateSettingsSchema),
  asyncHandler(async (req, res) => {
    res.json(await updateSettings(getStore(res).storeId, req.body as UpdateSettingsInput));
  }),
);
