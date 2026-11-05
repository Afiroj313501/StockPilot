import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { formatMoney } from '../../utils/money';
import { uniqueViolationOn } from '../../utils/prismaErrors';
import { createPurchaseIn, loadDetail, reference } from '../purchases/purchases.service';
import { addDays, daysBetween, localToday } from '../reports/dateRange';
import { inRange } from '../reports/reports.service';
import {
  DEFAULT_PARAMS,
  type ApproveInput,
  type DecisionInput,
  type PlannerParams,
} from './forecasting.schemas';
import { buildPlan, type Confidence, type PlanStatus, type Urgency } from './reorder';

const SNOOZE_DAYS = 7;
const DAY_MS = 86_400_000;

type Db = Pick<
  Prisma.TransactionClient,
  '$queryRaw' | 'product' | 'purchaseOrderItem' | 'reorderReview' | 'storeSetting'
>;

export interface Recommendation {
  productId: string;
  name: string;
  sku: string;
  unit: string | null;
  status: PlanStatus;
  confidence: Confidence;
  urgency: Urgency;
  lowStock: boolean;
  currentStock: number;
  incomingStock: number;
  pendingOrderQuantity: number; // on draft or submitted orders (shown, not counted)
  position: number;
  supplier: { id: string; name: string; isActive: boolean } | null;
  leadTimeDays: number;
  leadTimeSource: 'SUPPLIER' | 'STORE_DEFAULT';
  safetyDays: number;
  coverageDays: number;
  inputs: {
    windowStart: string;
    windowEnd: string;
    observedDays: number;
    unitsSold: number;
    unitsReturned: number;
    eligibleUnits: number;
    transactions: number;
    lowStockThreshold: number;
  };
  averageDailyDemand: string;
  leadTimeDemand: number;
  safetyStock: number;
  coverageStock: number;
  reorderPoint: number;
  orderUpToLevel: number;
  daysOfCover: string | null;
  recommendedQuantity: number | null;
  unitCost: string;
  estimatedCost: string | null;
  reviewState: {
    status: 'DISMISSED' | 'REVIEWED' | 'ORDERED';
    createdAt: string;
    purchaseOrderId: string | null;
  } | null;
  steps: string[];
}

interface Evaluation {
  today: string;
  timeZone: string;
  items: Recommendation[];
}

const productNotFound = () => new AppError(404, 'NOT_FOUND', 'Product not found');
const keyReused = () =>
  new AppError(
    409,
    'IDEMPOTENCY_KEY_REUSED',
    'This idempotency key was already used for a different request',
  );

// Works out the recommendation for every active product (or one product, archived or not).
// It only reads data, so the same data and parameters always give the same answer.
async function evaluate(
  db: Db,
  storeId: string,
  params: PlannerParams,
  onlyProductId?: string,
): Promise<Evaluation> {
  const setting = await db.storeSetting.findUnique({
    where: { storeId },
    select: { timeZone: true, defaultLeadTimeDays: true, defaultLowStockThreshold: true },
  });
  const timeZone = setting?.timeZone ?? 'UTC';
  const defaultLead = setting?.defaultLeadTimeDays ?? 7;
  const defaultThreshold = setting?.defaultLowStockThreshold ?? 5;
  const today = localToday(timeZone);
  const windowStart = addDays(today, -(params.windowDays - 1));
  const range = { from: windowStart, to: today, timeZone, today };

  const products = await db.product.findMany({
    where: onlyProductId ? { id: onlyProductId, storeId } : { storeId, isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      unit: true,
      stockQuantity: true,
      reorderThreshold: true,
      costPrice: true,
      createdAt: true,
    },
  });
  if (products.length === 0) return { today, timeZone, items: [] };

  const ids = products.map((p) => p.id);
  const idList = Prisma.join(ids);

  const [sold, returned, openLines, supplierLines, reviews] = await Promise.all([
    db.$queryRaw<{ product_id: string; units: number; transactions: number }[]>(Prisma.sql`
      SELECT si."productId" AS product_id,
             SUM(si.quantity)::int AS units,
             COUNT(DISTINCT si."saleId")::int AS transactions
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE s."storeId" = ${storeId} AND s.status = 'COMPLETED'
        AND ${inRange(Prisma.sql`s."createdAt"`, range)}
        AND si."productId" IN (${idList})
      GROUP BY 1`),
    db.$queryRaw<{ product_id: string; units: number }[]>(Prisma.sql`
      SELECT ri."productId" AS product_id, SUM(ri.quantity)::int AS units
      FROM sale_return_items ri
      JOIN sale_returns r ON r.id = ri."returnId"
      WHERE r."storeId" = ${storeId}
        AND ${inRange(Prisma.sql`r."createdAt"`, range)}
        AND ri."productId" IN (${idList})
      GROUP BY 1`),
    db.purchaseOrderItem.findMany({
      where: {
        productId: { in: ids },
        purchaseOrder: {
          storeId,
          status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED'] },
        },
      },
      select: {
        productId: true,
        quantityOrdered: true,
        quantityReceived: true,
        purchaseOrder: { select: { status: true } },
      },
    }),
    db.purchaseOrderItem.findMany({
      where: {
        productId: { in: ids },
        purchaseOrder: {
          storeId,
          status: { in: ['SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'] },
        },
      },
      select: {
        productId: true,
        purchaseOrder: {
          select: {
            supplier: { select: { id: true, name: true, isActive: true, leadTimeDays: true } },
          },
        },
      },
      orderBy: { purchaseOrder: { createdAt: 'desc' } },
    }),
    db.reorderReview.findMany({
      where: {
        storeId,
        productId: { in: ids },
        OR: [
          {
            status: { in: ['DISMISSED', 'REVIEWED'] },
            createdAt: { gte: new Date(Date.now() - SNOOZE_DAYS * DAY_MS) },
          },
          { status: 'ORDERED', purchaseOrder: { status: { in: ['DRAFT', 'SUBMITTED'] } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { productId: true, status: true, createdAt: true, purchaseOrderId: true },
    }),
  ]);

  const soldBy = new Map(sold.map((r) => [r.product_id, r]));
  const returnedBy = new Map(returned.map((r) => [r.product_id, r.units]));

  const incoming = new Map<string, number>();
  const pending = new Map<string, number>();
  for (const l of openLines) {
    const remaining = Math.max(0, l.quantityOrdered - l.quantityReceived);
    const target =
      l.purchaseOrder.status === 'APPROVED' || l.purchaseOrder.status === 'PARTIALLY_RECEIVED'
        ? incoming
        : pending;
    target.set(l.productId, (target.get(l.productId) ?? 0) + remaining);
  }

  // The preferred supplier is the one on the most recent submitted, approved or received order.
  const supplierBy = new Map<string, (typeof supplierLines)[number]['purchaseOrder']['supplier']>();
  for (const l of supplierLines) {
    if (!supplierBy.has(l.productId)) supplierBy.set(l.productId, l.purchaseOrder.supplier);
  }
  const reviewBy = new Map<string, (typeof reviews)[number]>();
  for (const r of reviews) {
    if (!reviewBy.has(r.productId)) reviewBy.set(r.productId, r);
  }

  const items = products.map((p): Recommendation => {
    const s = soldBy.get(p.id);
    const unitsSold = s?.units ?? 0;
    const unitsReturned = returnedBy.get(p.id) ?? 0;
    const eligibleUnits = Math.max(0, unitsSold - unitsReturned);
    const transactions = s?.transactions ?? 0;

    // Only the days the product has existed can have had sales.
    const createdOn = localToday(timeZone, p.createdAt);
    const observedDays = Math.max(
      1,
      Math.min(params.windowDays, daysBetween(createdOn, today) + 1),
    );

    const supplier = supplierBy.get(p.id) ?? null;
    const leadTimeDays = supplier?.leadTimeDays ?? defaultLead;
    const lowStockThreshold = p.reorderThreshold ?? defaultThreshold;

    const plan = buildPlan({
      currentStock: p.stockQuantity,
      incomingStock: incoming.get(p.id) ?? 0,
      eligibleUnits,
      transactions,
      observedDays,
      leadTimeDays,
      safetyDays: params.safetyDays,
      coverageDays: params.coverageDays,
      lowStockThreshold,
    });

    const review = reviewBy.get(p.id);
    return {
      productId: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      status: plan.status,
      confidence: plan.confidence,
      urgency: plan.urgency,
      lowStock: plan.lowStock,
      currentStock: p.stockQuantity,
      incomingStock: incoming.get(p.id) ?? 0,
      pendingOrderQuantity: pending.get(p.id) ?? 0,
      position: plan.position,
      supplier: supplier
        ? { id: supplier.id, name: supplier.name, isActive: supplier.isActive }
        : null,
      leadTimeDays,
      leadTimeSource: supplier?.leadTimeDays != null ? 'SUPPLIER' : 'STORE_DEFAULT',
      safetyDays: params.safetyDays,
      coverageDays: params.coverageDays,
      inputs: {
        windowStart,
        windowEnd: today,
        observedDays,
        unitsSold,
        unitsReturned,
        eligibleUnits,
        transactions,
        lowStockThreshold,
      },
      averageDailyDemand: plan.averageDailyDemand,
      leadTimeDemand: plan.leadTimeDemand,
      safetyStock: plan.safetyStock,
      coverageStock: plan.coverageStock,
      reorderPoint: plan.reorderPoint,
      orderUpToLevel: plan.orderUpToLevel,
      daysOfCover: plan.daysOfCover,
      recommendedQuantity: plan.recommendedQuantity,
      unitCost: formatMoney(p.costPrice),
      estimatedCost: plan.recommendedQuantity
        ? formatMoney(p.costPrice.times(plan.recommendedQuantity))
        : null,
      reviewState: review
        ? {
            status: review.status,
            createdAt: review.createdAt.toISOString(),
            purchaseOrderId: review.purchaseOrderId,
          }
        : null,
      steps: plan.steps,
    };
  });

  return { today, timeZone, items };
}

const needsAttention = (r: Recommendation) =>
  r.status === 'REORDER' || (r.status === 'INSUFFICIENT_DATA' && r.lowStock);

const rank = (r: Recommendation) =>
  r.status === 'REORDER' ? (r.urgency === 'CRITICAL' ? 0 : 1) : 2;
const cover = (r: Recommendation) => (r.daysOfCover === null ? Infinity : Number(r.daysOfCover));
const byUrgency = (a: Recommendation, b: Recommendation) =>
  rank(a) - rank(b) || cover(a) - cover(b) || a.name.localeCompare(b.name);

export async function listRecommendations(
  storeId: string,
  params: PlannerParams,
  includeHandled: boolean,
) {
  const ev = await evaluate(prisma, storeId, params);
  const attention = ev.items.filter(needsAttention);
  const open = attention.filter((r) => !r.reviewState);
  return {
    today: ev.today,
    timeZone: ev.timeZone,
    params,
    counts: {
      evaluated: ev.items.length,
      reorder: open.filter((r) => r.status === 'REORDER').length,
      insufficientLowStock: open.filter((r) => r.status === 'INSUFFICIENT_DATA').length,
      handled: attention.length - open.length,
    },
    items: (includeHandled ? attention : open).sort(byUrgency),
  };
}

export async function getRecommendation(storeId: string, productId: string, params: PlannerParams) {
  const ev = await evaluate(prisma, storeId, params, productId);
  const item = ev.items[0];
  if (!item) throw productNotFound();
  return { today: ev.today, timeZone: ev.timeZone, params, item };
}

// The whole recommendation, saved with the decision so it can be explained and reproduced later.
function snapshotOf(
  rec: Recommendation,
  today: string,
  params: PlannerParams,
): Prisma.InputJsonObject {
  return JSON.parse(
    JSON.stringify({ ...rec, generatedFor: today, params }),
  ) as Prisma.InputJsonObject;
}

export async function approveRecommendation(
  storeId: string,
  actorUserId: string,
  productId: string,
  input: ApproveInput,
): Promise<{ order: Awaited<ReturnType<typeof loadDetail>>; replayed: boolean }> {
  const params = input.params ?? DEFAULT_PARAMS;

  const replay = async (existing: {
    productId: string;
    actorUserId: string;
    purchaseOrderId: string | null;
  }) => {
    if (
      existing.productId !== productId ||
      existing.actorUserId !== actorUserId ||
      !existing.purchaseOrderId
    ) {
      throw keyReused();
    }
    return { order: await loadDetail(prisma, storeId, existing.purchaseOrderId), replayed: true };
  };

  try {
    return await prisma.$transaction(async (tx) => {
      // 1. Lock the product row: parallel approvals for this product run one at a time.
      //    The storeId means another store's product is simply "not found".
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM products WHERE id = ${productId} AND "storeId" = ${storeId} FOR UPDATE`;
      if (locked.length === 0) throw productNotFound();

      // 2. Repeated request? Checked after the lock, so a parallel retry sees the first result.
      const existing = await tx.reorderReview.findUnique({
        where: { storeId_idempotencyKey: { storeId, idempotencyKey: input.idempotencyKey } },
        select: { productId: true, actorUserId: true, purchaseOrderId: true },
      });
      if (existing) {
        if (
          existing.productId !== productId ||
          existing.actorUserId !== actorUserId ||
          !existing.purchaseOrderId
        ) {
          throw keyReused();
        }
        return { order: await loadDetail(tx, storeId, existing.purchaseOrderId), replayed: true };
      }

      // 3. One planner order at a time per product.
      const open = await tx.reorderReview.findFirst({
        where: {
          storeId,
          productId,
          status: 'ORDERED',
          purchaseOrder: { status: { in: ['DRAFT', 'SUBMITTED'] } },
        },
        select: { purchaseOrder: { select: { number: true } } },
      });
      if (open?.purchaseOrder) {
        throw new AppError(
          409,
          'ALREADY_ORDERED',
          `A planner order (${reference(open.purchaseOrder.number)}) for this product is still waiting to be approved.`,
        );
      }

      // 4. Work out the recommendation again, from the data as it is now.
      const ev = await evaluate(tx, storeId, params, productId);
      const rec = ev.items[0];
      if (!rec || rec.status !== 'REORDER' || !rec.recommendedQuantity) {
        throw new AppError(
          409,
          'NOTHING_TO_ORDER',
          'This product does not need a reorder right now.',
        );
      }
      const supplierId = input.supplierId ?? rec.supplier?.id;
      if (!supplierId) {
        throw new AppError(
          400,
          'SUPPLIER_REQUIRED',
          'Choose a supplier: this product has no order history to take one from.',
        );
      }
      const quantity = input.quantity ?? rec.recommendedQuantity;

      // 5. A draft order only. Nothing is sent to a supplier.
      const order = await createPurchaseIn(tx, storeId, actorUserId, {
        supplierId,
        notes: `Created from the reorder planner on ${ev.today}.${input.note ? ` ${input.note}` : ''}`,
        expectedDate: addDays(ev.today, rec.leadTimeDays),
        items: [{ productId, quantityOrdered: quantity, unitCost: Number(rec.unitCost) }],
      });

      await tx.reorderReview.create({
        data: {
          storeId,
          productId,
          status: 'ORDERED',
          recommendedQuantity: rec.recommendedQuantity,
          orderedQuantity: quantity,
          purchaseOrderId: order.id,
          note: input.note ?? null,
          snapshot: snapshotOf(rec, ev.today, params),
          actorUserId,
          idempotencyKey: input.idempotencyKey,
        },
      });
      return { order, replayed: false };
    });
  } catch (err) {
    // The same key used on two different products can race past the check above;
    // the unique index settles it and we answer accordingly.
    if (uniqueViolationOn(err, 'idempotencyKey')) {
      const existing = await prisma.reorderReview.findUnique({
        where: { storeId_idempotencyKey: { storeId, idempotencyKey: input.idempotencyKey } },
        select: { productId: true, actorUserId: true, purchaseOrderId: true },
      });
      if (existing) return replay(existing);
    }
    throw err;
  }
}

// "Dismiss" and "mark as reviewed" both hide the product for a while and keep the evidence.
export async function recordDecision(
  storeId: string,
  actorUserId: string,
  productId: string,
  status: 'DISMISSED' | 'REVIEWED',
  input: DecisionInput,
) {
  const params = input.params ?? DEFAULT_PARAMS;
  const ev = await evaluate(prisma, storeId, params, productId);
  const rec = ev.items[0];
  if (!rec) throw productNotFound();

  const row = await prisma.reorderReview.create({
    data: {
      storeId,
      productId,
      status,
      recommendedQuantity: rec.recommendedQuantity,
      note: input.note ?? null,
      snapshot: snapshotOf(rec, ev.today, params),
      actorUserId,
    },
    select: { id: true, status: true, createdAt: true },
  });
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    hiddenForDays: SNOOZE_DAYS,
  };
}
