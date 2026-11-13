import { Router, type RequestHandler } from 'express';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../auth/auth.middleware';
import { requireRole } from '../auth/rbac';
import { getStore, requireStore } from '../auth/store.middleware';
import { exportQuery, importSchema, type ImportInput } from './import.schemas';
import { exportProducts, importProducts, previewImport } from './import.service';

export function createProductImportRouter(options: { limiter: RequestHandler }): Router {
  const router = Router();
  const guard: RequestHandler[] = [requireAuth, requireStore, requireRole('MANAGER')];

  router.get(
    '/export',
    ...guard,
    asyncHandler(async (req, res) => {
      const { status } = exportQuery.parse(req.query);
      const { filename, csv } = await exportProducts(getStore(res).storeId, status);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(csv);
    }),
  );

  router.post(
    '/import/preview',
    ...guard,
    options.limiter,
    validateBody(importSchema),
    asyncHandler(async (req, res) => {
      res.json(await previewImport(getStore(res).storeId, req.body as ImportInput));
    }),
  );

  router.post(
    '/import',
    ...guard,
    options.limiter,
    validateBody(importSchema),
    asyncHandler(async (req, res) => {
      const outcome = await importProducts(getStore(res).storeId, req.body as ImportInput);
      if (!outcome.imported) {
        res.status(422).json({
          error: {
            code: 'IMPORT_HAS_ERRORS',
            message:
              'The file has problems. Nothing was imported. Check the file and fix them first.',
            requestId: res.locals.requestId,
          },
          report: outcome.report,
        });
        return;
      }
      res.json(outcome.result);
    }),
  );

  return router;
}
