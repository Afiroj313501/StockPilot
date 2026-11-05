import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { uuidParam } from '../../utils/params';
import { getAuth, requireAuth } from '../auth/auth.middleware';
import { requireRole } from '../auth/rbac';
import { getStore, requireStore } from '../auth/store.middleware';
import {
  approveSchema,
  decisionSchema,
  listQuery,
  paramsQuery,
  type ApproveInput,
  type DecisionInput,
} from './forecasting.schemas';
import {
  approveRecommendation,
  getRecommendation,
  listRecommendations,
  recordDecision,
} from './forecasting.service';

export const forecastingRouter = Router();

// Managers and owners only. The role check runs before any validation or database access.
forecastingRouter.use(requireAuth, requireStore, requireRole('MANAGER'));

forecastingRouter.get(
  '/recommendations',
  asyncHandler(async (req, res) => {
    const { includeHandled, ...params } = listQuery.parse(req.query);
    res.json(await listRecommendations(getStore(res).storeId, params, includeHandled));
  }),
);

// One product, fully explained.
forecastingRouter.get(
  '/products/:productId',
  asyncHandler(async (req, res) => {
    res.json(
      await getRecommendation(
        getStore(res).storeId,
        uuidParam.parse(req.params.productId),
        paramsQuery.parse(req.query),
      ),
    );
  }),
);

// "Approve" creates a DRAFT purchase order. Nothing is sent to a supplier.
forecastingRouter.post(
  '/products/:productId/approve',
  validateBody(approveSchema),
  asyncHandler(async (req, res) => {
    const { order, replayed } = await approveRecommendation(
      getStore(res).storeId,
      getAuth(res).user.id,
      uuidParam.parse(req.params.productId),
      req.body as ApproveInput,
    );
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(replayed ? 200 : 201).json(order);
  }),
);

forecastingRouter.post(
  '/products/:productId/dismiss',
  validateBody(decisionSchema),
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(
        await recordDecision(
          getStore(res).storeId,
          getAuth(res).user.id,
          uuidParam.parse(req.params.productId),
          'DISMISSED',
          req.body as DecisionInput,
        ),
      );
  }),
);

forecastingRouter.post(
  '/products/:productId/review',
  validateBody(decisionSchema),
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(
        await recordDecision(
          getStore(res).storeId,
          getAuth(res).user.id,
          uuidParam.parse(req.params.productId),
          'REVIEWED',
          req.body as DecisionInput,
        ),
      );
  }),
);
