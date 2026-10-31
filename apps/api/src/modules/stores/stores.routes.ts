import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware';
import { getStore, requireStore } from '../auth/store.middleware';

export const storesRouter = Router();

storesRouter.use(requireAuth, requireStore);

storesRouter.get('/current', (_req, res) => {
  const store = getStore(res);
  res.json({ id: store.storeId, name: store.storeName, role: store.role });
});
