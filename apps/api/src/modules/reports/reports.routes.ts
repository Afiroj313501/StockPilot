import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { getAuth, requireAuth } from '../auth/auth.middleware';
import { requireRole } from '../auth/rbac';
import { getStore, requireStore } from '../auth/store.middleware';
import { buildExport } from './reports.export';
import {
  dashboardQuery,
  exportKindParam,
  exportQuery,
  productsQuery,
  rangeQuery,
  summaryQuery,
} from './reports.schemas';
import { getCategoryReport, getDashboard, getProductReport, getSummary, inventoryReport } from './reports.service';

export const reportsRouter = Router();

// Managers and owners only. The role check runs before any validation or database access.
reportsRouter.use(requireAuth, requireStore, requireRole('MANAGER'));

reportsRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    res.json(await getSummary(getStore(res).storeId, summaryQuery.parse(req.query)));
  }),
);

reportsRouter.get(
  '/products',
  asyncHandler(async (req, res) => {
    res.json(await getProductReport(getStore(res).storeId, productsQuery.parse(req.query)));
  }),
);

reportsRouter.get(
  '/categories',
  asyncHandler(async (req, res) => {
    res.json(await getCategoryReport(getStore(res).storeId, rangeQuery.parse(req.query)));
  }),
);

reportsRouter.get(
  '/inventory',
  asyncHandler(async (_req, res) => {
    res.json(await inventoryReport(getStore(res).storeId));
  }),
);

reportsRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const store = getStore(res);
    res.json(await getDashboard(store.storeId, store.role, getAuth(res).user.id, dashboardQuery.parse(req.query)));
  }),
);

reportsRouter.get(
  '/export/:kind',
  asyncHandler(async (req, res) => {
    const kind = exportKindParam.parse(req.params.kind);
    const { filename, csv } = await buildExport(getStore(res).storeId, kind, exportQuery.parse(req.query));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }),
);