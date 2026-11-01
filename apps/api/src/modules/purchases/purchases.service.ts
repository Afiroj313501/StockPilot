import { Prisma, type PurchaseStatus } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { prismaCode } from '../../utils/prismaErrors';
import type { PurchaseOrderInput } from './purchases.schemas';

const include = {
  supplier: { select: { id: true, name: true, phone: true, email: true } },
  items: { include: { product: { select: { id: true, name: true, sku: true } } } },
} satisfies Prisma.PurchaseOrderInclude;
type OrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof include }>;

function dto(order: OrderRow) {
  const total = order.items.reduce(
    (sum, line) => sum.plus(line.unitCost.times(line.quantityOrdered)),
    new Prisma.Decimal(0),
  );
  return {
    id: order.id,
    number: order.number,
    supplier: order.supplier,
    status: order.status,
    notes: order.notes,
    createdById: order.createdById,
    approvedById: order.approvedById,
    createdAt: order.createdAt.toISOString(),
    submittedAt: order.submittedAt?.toISOString() ?? null,
    approvedAt: order.approvedAt?.toISOString() ?? null,
    total: total.toFixed(2),
    items: order.items.map((line) => ({
      id: line.id,
      productId: line.productId,
      productName: line.product.name,
      productSku: line.product.sku,
      quantityOrdered: line.quantityOrdered,
      quantityReceived: line.quantityReceived,
      unitCost: line.unitCost.toFixed(2),
      lineTotal: line.unitCost.times(line.quantityOrdered).toFixed(2),
    })),
  };
}

async function validateReferences(
  tx: Prisma.TransactionClient,
  storeId: string,
  input: PurchaseOrderInput,
) {
  const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, storeId } });
  if (!supplier) throw new AppError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found');
  if (!supplier.isActive)
    throw new AppError(409, 'SUPPLIER_ARCHIVED', 'Archived suppliers cannot receive new orders');
  const products = await tx.product.findMany({
    where: { storeId, id: { in: input.lines.map((line) => line.productId) }, isActive: true },
    select: { id: true },
  });
  if (products.length !== input.lines.length)
    throw new AppError(
      400,
      'INVALID_PRODUCT',
      'Every line must reference an active product in this store',
    );
}

async function nextNumber(tx: Prisma.TransactionClient, storeId: string) {
  const rows = await tx.$queryRaw<{ nextPurchaseNumber: number }[]>`
    UPDATE stores
    SET "nextPurchaseNumber" = "nextPurchaseNumber" + 1
    WHERE id = ${storeId}
    RETURNING "nextPurchaseNumber" - 1 AS "nextPurchaseNumber"`;
  if (rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Store not found');
  return rows[0]!.nextPurchaseNumber;
}

export async function listPurchaseOrders(storeId: string) {
  const rows = await prisma.purchaseOrder.findMany({
    where: { storeId },
    include,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map(dto);
}

export async function getPurchaseOrder(storeId: string, id: string) {
  const row = await prisma.purchaseOrder.findFirst({ where: { id, storeId }, include });
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Purchase order not found');
  return dto(row);
}

export async function createPurchaseOrder(
  storeId: string,
  actorUserId: string,
  input: PurchaseOrderInput,
) {
  const row = await prisma.$transaction(async (tx) => {
    await validateReferences(tx, storeId, input);
    const number = await nextNumber(tx, storeId);
    return tx.purchaseOrder.create({
      data: {
        storeId,
        supplierId: input.supplierId,
        number,
        notes: input.notes ?? null,
        createdById: actorUserId,
        items: {
          create: input.lines.map((line) => ({
            productId: line.productId,
            quantityOrdered: line.quantityOrdered,
            unitCost: new Prisma.Decimal(line.unitCost.toFixed(2)),
          })),
        },
      },
      include,
    });
  });
  return dto(row);
}

export async function updatePurchaseOrder(storeId: string, id: string, input: PurchaseOrderInput) {
  const row = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id} AND "storeId" = ${storeId} FOR UPDATE`;
    const order = await tx.purchaseOrder.findFirst({
      where: { id, storeId },
      select: { status: true },
    });
    if (!order) throw new AppError(404, 'NOT_FOUND', 'Purchase order not found');
    if (order.status !== 'DRAFT')
      throw new AppError(409, 'ORDER_NOT_DRAFT', 'Only draft orders can be edited');
    await validateReferences(tx, storeId, input);
    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
    return tx.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: input.supplierId,
        notes: input.notes ?? null,
        items: {
          create: input.lines.map((line) => ({
            productId: line.productId,
            quantityOrdered: line.quantityOrdered,
            unitCost: new Prisma.Decimal(line.unitCost.toFixed(2)),
          })),
        },
      },
      include,
    });
  });
  return dto(row);
}

async function transition(
  storeId: string,
  id: string,
  actorUserId: string,
  from: PurchaseStatus[],
  to: PurchaseStatus,
) {
  const data =
    to === 'SUBMITTED'
      ? { status: to, submittedAt: new Date() }
      : to === 'APPROVED'
        ? { status: to, approvedById: actorUserId, approvedAt: new Date() }
        : { status: to, cancelledAt: new Date() };
  const result = await prisma.purchaseOrder.updateMany({
    where: { id, storeId, status: { in: from } },
    data,
  });
  if (result.count === 0)
    throw new AppError(
      409,
      'INVALID_ORDER_STATE',
      'The purchase order changed or cannot make that transition',
    );
  return getPurchaseOrder(storeId, id);
}

export const submitPurchaseOrder = (storeId: string, id: string, actorUserId: string) =>
  transition(storeId, id, actorUserId, ['DRAFT'], 'SUBMITTED');
export const approvePurchaseOrder = (storeId: string, id: string, actorUserId: string) =>
  transition(storeId, id, actorUserId, ['SUBMITTED'], 'APPROVED');
export const cancelPurchaseOrder = (storeId: string, id: string, actorUserId: string) =>
  transition(storeId, id, actorUserId, ['DRAFT', 'SUBMITTED', 'APPROVED'], 'CANCELLED');

export function purchaseOrderError(err: unknown): never {
  if (prismaCode(err) === 'P2025') throw new AppError(404, 'NOT_FOUND', 'Purchase order not found');
  throw err;
}
