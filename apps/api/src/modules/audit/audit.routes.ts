import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../auth/auth.middleware';
import { requireRole } from '../auth/rbac';
import { getStore, requireStore } from '../auth/store.middleware';
import { AUDIT_ACTIONS } from './actions';
import { listAuditQuery } from './audit.schemas';
import { listAuditLogs } from './audit.service';

export const auditRouter = Router();

auditRouter.use(requireAuth, requireStore, requireRole('OWNER'));

auditRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listAuditLogs(getStore(res).storeId, listAuditQuery.parse(req.query)));
  }),
);

auditRouter.get('/actions', (_req, res) => {
  res.json({ items: AUDIT_ACTIONS });
});
