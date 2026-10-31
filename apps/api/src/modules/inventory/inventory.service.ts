import { Prisma, type MovementType } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { uniqueViolationOn } from '../../utils/prismaErrors';
import type { CreateMovementInput, ListMovementsQuery, LowStockQuery } from './inventory.schemas';

const MAX_STOCK = 2_000_000_000;
const DEFAULT_LOW_STOCK_THRESHOLD = 5;
const movementInclude = {
  product: { select: { name: true, sku: true } },
  actor: { select: { name: true } },
} satisfies Prisma.StockMovementInclude;
type MovementRow = Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>;

function toDto(movement: MovementRow) {
  return {
    id: movement.id,
    productId: movement.productId,
    productName: movement.product.name,
    productSku: movement.product.sku,
    type: movement.type,
    quantityChange: movement.quantityChange,
    quantityBefore: movement.quantityBefore,
    quantityAfter: movement.quantityAfter,
    reason: movement.reason,
    actorName: movement.actor.name,
    createdAt: movement.createdAt.toISOString(),
  };
}

function computeChange(type: MovementType, quantity: number, current: number): number {
  switch (type) {
    case 'OPENING':
    case 'ADJUSTMENT':
      return quantity;
    case 'DAMAGED':
    case 'LOST':
      return -quantity;
    case 'RECONCILIATION':
      return quantity - current;
    default:
      throw new AppError(400, 'UNSUPPORTED_MOVEMENT', 'This movement type cannot be recorded here');
  }
}

function replayOf(existing: MovementRow, input: CreateMovementInput) {
  if (existing.productId !== input.productId || existing.type !== input.type) {
    throw new AppError(
      409,
      'IDEMPOTENCY_KEY_REUSED',
      'This idempotency key was already used for a different request',
    );
  }
  return { movement: toDto(existing), replayed: true };
}

export async function recordMovement(
  storeId: string,
  actorUserId: string,
  input: CreateMovementInput,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM products WHERE id = ${input.productId} AND "storeId" = ${storeId} FOR UPDATE`;
      if (locked.length === 0) throw new AppError(404, 'NOT_FOUND', 'Product not found');
      const existing = await tx.stockMovement.findUnique({
        where: { storeId_idempotencyKey: { storeId, idempotencyKey: input.idempotencyKey } },
        include: movementInclude,
      });
      if (existing) return replayOf(existing, input);
      const product = await tx.product.findUniqueOrThrow({
        where: { id: input.productId },
        select: { stockQuantity: true },
      });
      const current = product.stockQuantity;
      if (
        input.type === 'OPENING' &&
        (await tx.stockMovement.count({ where: { storeId, productId: input.productId } }))
      ) {
        throw new AppError(
          409,
          'OPENING_NOT_ALLOWED',
          'Opening stock can only be recorded once, before any other movement',
        );
      }
      const change = computeChange(input.type, input.quantity, current);
      const after = current + change;
      if (after > MAX_STOCK)
        throw new AppError(400, 'QUANTITY_TOO_LARGE', 'The resulting stock quantity is too large');
      if (after < 0) {
        const setting = await tx.storeSetting.findUnique({
          where: { storeId },
          select: { allowNegativeStock: true },
        });
        if (!setting?.allowNegativeStock)
          throw new AppError(
            409,
            'INSUFFICIENT_STOCK',
            `Only ${current} in stock. This would take the quantity below zero.`,
          );
      }
      await tx.product.update({ where: { id: input.productId }, data: { stockQuantity: after } });
      const created = await tx.stockMovement.create({
        data: {
          storeId,
          productId: input.productId,
          type: input.type,
          quantityChange: change,
          quantityBefore: current,
          quantityAfter: after,
          reason: input.reason ?? null,
          actorUserId,
          idempotencyKey: input.idempotencyKey,
        },
        include: movementInclude,
      });
      return { movement: toDto(created), replayed: false };
    });
  } catch (err) {
    if (uniqueViolationOn(err, 'idempotencyKey')) {
      const existing = await prisma.stockMovement.findUnique({
        where: { storeId_idempotencyKey: { storeId, idempotencyKey: input.idempotencyKey } },
        include: movementInclude,
      });
      if (existing) return replayOf(existing, input);
    }
    throw err;
  }
}

export async function listMovements(storeId: string, query: ListMovementsQuery) {
  const where: Prisma.StockMovementWhereInput = { storeId };
  if (query.productId) where.productId = query.productId;
  if (query.type) where.type = query.type;
  const [total, rows] = await prisma.$transaction([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      include: movementInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return {
    items: rows.map(toDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

export async function listLowStock(storeId: string, query: LowStockQuery) {
  const setting = await prisma.storeSetting.findUnique({
    where: { storeId },
    select: { defaultLowStockThreshold: true },
  });
  const threshold = setting?.defaultLowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
  const matches = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM products WHERE "storeId" = ${storeId} AND "isActive" = true
      AND "stockQuantity" <= COALESCE("reorderThreshold", ${threshold}::int)`;
  const rows = await prisma.product.findMany({
    where: { storeId, id: { in: matches.map((match) => match.id) } },
    orderBy: [{ stockQuantity: 'asc' }, { name: 'asc' }],
    take: query.limit,
  });
  return {
    total: matches.length,
    items: rows.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      stockQuantity: product.stockQuantity,
      threshold: product.reorderThreshold ?? threshold,
    })),
  };
}

export async function checkIntegrity(storeId: string) {
  const [sums, products] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ['productId'],
      where: { storeId },
      _sum: { quantityChange: true },
    }),
    prisma.product.findMany({
      where: { storeId },
      select: { id: true, sku: true, name: true, stockQuantity: true },
    }),
  ]);
  const expected = new Map(sums.map((sum) => [sum.productId, sum._sum.quantityChange ?? 0]));
  const mismatches = products
    .filter((product) => product.stockQuantity !== (expected.get(product.id) ?? 0))
    .map((product) => ({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      expected: expected.get(product.id) ?? 0,
      actual: product.stockQuantity,
    }));
  return { ok: mismatches.length === 0, checkedProducts: products.length, mismatches };
}
