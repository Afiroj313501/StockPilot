import { Prisma, type PurchaseStatus } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { formatMoney, toDecimal } from '../../utils/money';
import type {
  CreatePurchaseInput,
  ListPurchasesQuery,
  UpdatePurchaseInput,
} from './purchases.schemas';

const listInclude = {
  supplier: { select: { id: true, name: true } },
  items: {
    include: { product: { select: { name: true, sku: true } } },
    orderBy: { product: { name: 'asc' } },
  },
} satisfies Prisma.PurchaseOrderInclude;

export const detailInclude = {
  ...listInclude,
  createdBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
  receipts: {
    orderBy: { createdAt: 'asc' },
    include: {
      receivedBy: { select: { name: true } },
      items: {
        include: { product: { select: { name: true, sku: true } } },
        orderBy: { product: { name: 'asc' } },
      },
    },
  },
} satisfies Prisma.PurchaseOrderInclude;

type ListRow = Prisma.PurchaseOrderGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.PurchaseOrderGetPayload<{ include: typeof detailInclude }>;
type Db = Pick<Prisma.TransactionClient, 'purchaseOrder'>;

export const reference = (n: number) => `PO-${String(n).padStart(4, '0')}`;
export const statusLabel = (s: PurchaseStatus) => s.toLowerCase().replace('_', ' ');
export const notFound = () => new AppError(404, 'NOT_FOUND', 'Purchase order not found');
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

function orderTotal(
  items: { quantityOrdered: number; unitCost: Prisma.Decimal }[],
): Prisma.Decimal {
  return items.reduce(
    (sum, i) => sum.plus(i.unitCost.times(i.quantityOrdered)),
    new Prisma.Decimal(0),
  );
}

function toSummary(o: ListRow) {
  return {
    id: o.id,
    number: o.number,
    reference: reference(o.number),
    status: o.status,
    supplierId: o.supplier.id,
    supplierName: o.supplier.name,
    itemCount: o.items.length,
    total: formatMoney(orderTotal(o.items)),
    expectedDate: dateOnly(o.expectedDate),
    createdAt: o.createdAt.toISOString(),
  };
}

function toDetail(o: DetailRow) {
  return {
    ...toSummary(o),
    notes: o.notes,
    createdByName: o.createdBy.name,
    submittedAt: o.submittedAt?.toISOString() ?? null,
    approvedByName: o.approvedBy?.name ?? null,
    approvedAt: o.approvedAt?.toISOString() ?? null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
    cancelReason: o.cancelReason,
    items: o.items.map((i) => ({
      productId: i.productId,
      productName: i.product.name,
      productSku: i.product.sku,
      quantityOrdered: i.quantityOrdered,
      quantityReceived: i.quantityReceived,
      quantityRemaining: i.quantityOrdered - i.quantityReceived,
      unitCost: formatMoney(i.unitCost),
      lineTotal: formatMoney(i.unitCost.times(i.quantityOrdered)),
    })),
    receipts: o.receipts.map((r) => ({
      id: r.id,
      receivedAt: r.createdAt.toISOString(),
      receivedByName: r.receivedBy.name,
      note: r.note,
      items: r.items.map((i) => ({
        productId: i.productId,
        productName: i.product.name,
        productSku: i.product.sku,
        quantity: i.quantity,
        unitCost: formatMoney(i.unitCost),
        lineTotal: formatMoney(i.unitCost.times(i.quantity)),
      })),
    })),
  };
}

async function assertSupplier(tx: Prisma.TransactionClient, storeId: string, supplierId: string) {
  const supplier = await tx.supplier.findFirst({
    where: { id: supplierId, storeId },
    select: { isActive: true },
  });
  if (!supplier) throw new AppError(400, 'INVALID_SUPPLIER', 'Supplier not found in this store');
  if (!supplier.isActive) {
    throw new AppError(
      409,
      'SUPPLIER_ARCHIVED',
      'This supplier is archived. Restore it before ordering.',
    );
  }
}

async function assertProducts(tx: Prisma.TransactionClient, storeId: string, productIds: string[]) {
  const found = await tx.product.findMany({
    where: { storeId, id: { in: productIds } },
    select: { id: true, isActive: true, name: true },
  });
  if (found.length !== productIds.length) {
    throw new AppError(400, 'INVALID_PRODUCT', 'One or more products were not found in this store');
  }
  const archived = found.find((p) => !p.isActive);
  if (archived) {
    throw new AppError(
      409,
      'PRODUCT_ARCHIVED',
      `“${archived.name}” is archived. Restore it before ordering.`,
    );
  }
}

export async function listPurchases(storeId: string, q: ListPurchasesQuery) {
  const where: Prisma.PurchaseOrderWhereInput = { storeId };
  if (q.status) where.status = q.status;
  if (q.supplierId) where.supplierId = q.supplierId;

  const [total, rows] = await prisma.$transaction([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      include: listInclude,
      orderBy: [{ number: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);

  return {
    items: rows.map(toSummary),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.ceil(total / q.pageSize),
  };
}

export async function loadDetail(db: Db, storeId: string, id: string) {
  const row = await db.purchaseOrder.findFirst({ where: { id, storeId }, include: detailInclude });
  if (!row) throw notFound();
  return toDetail(row);
}

export function getPurchase(storeId: string, id: string) {
  return loadDetail(prisma, storeId, id);
}

// The body of createPurchase, usable inside a caller's transaction (for example the reorder planner).
export async function createPurchaseIn(
  tx: Prisma.TransactionClient,
  storeId: string,
  actorUserId: string,
  input: CreatePurchaseInput,
) {
  await assertSupplier(tx, storeId, input.supplierId);
  await assertProducts(
    tx,
    storeId,
    input.items.map((i) => i.productId),
  );

  // The UPDATE locks the counter row, so concurrent creates get distinct numbers.
  // If anything below fails, the whole transaction (and the increment) rolls back.
  const counter = await tx.store.update({
    where: { id: storeId },
    data: { nextPurchaseNumber: { increment: 1 } },
    select: { nextPurchaseNumber: true },
  });

  const order = await tx.purchaseOrder.create({
    data: {
      storeId,
      supplierId: input.supplierId,
      number: counter.nextPurchaseNumber - 1,
      notes: input.notes ?? null,
      expectedDate: toDate(input.expectedDate),
      createdById: actorUserId,
      items: {
        create: input.items.map((i) => ({
          productId: i.productId,
          quantityOrdered: i.quantityOrdered,
          unitCost: toDecimal(i.unitCost),
        })),
      },
    },
    include: detailInclude,
  });
  return toDetail(order);
}

export function createPurchase(storeId: string, actorUserId: string, input: CreatePurchaseInput) {
  return prisma.$transaction((tx) => createPurchaseIn(tx, storeId, actorUserId, input));
}

export async function updatePurchase(storeId: string, id: string, input: UpdatePurchaseInput) {
  return prisma.$transaction(async (tx) => {
    // Conditional update: succeeds only for a DRAFT of this store, and holds the
    // row lock for the rest of the transaction, so a parallel "submit" must wait.
    const guard = await tx.purchaseOrder.updateMany({
      where: { id, storeId, status: 'DRAFT' },
      data: { updatedAt: new Date() },
    });
    if (guard.count === 0) {
      const current = await tx.purchaseOrder.findFirst({
        where: { id, storeId },
        select: { id: true },
      });
      if (!current) throw notFound();
      throw new AppError(
        409,
        'NOT_EDITABLE',
        'Only draft orders can be edited. Cancel it and create a new one.',
      );
    }

    const data: Prisma.PurchaseOrderUncheckedUpdateInput = {};
    if (input.supplierId !== undefined) {
      await assertSupplier(tx, storeId, input.supplierId);
      data.supplierId = input.supplierId;
    }
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.expectedDate !== undefined) data.expectedDate = toDate(input.expectedDate);
    if (input.items) {
      await assertProducts(
        tx,
        storeId,
        input.items.map((i) => i.productId),
      );
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      await tx.purchaseOrderItem.createMany({
        data: input.items.map((i) => ({
          purchaseOrderId: id,
          productId: i.productId,
          quantityOrdered: i.quantityOrdered,
          unitCost: toDecimal(i.unitCost),
        })),
      });
    }

    const updated = await tx.purchaseOrder.update({ where: { id }, data, include: detailInclude });
    return toDetail(updated);
  });
}

// One atomic conditional UPDATE: the change happens only if the order is still in an
// allowed state, so parallel or repeated requests cannot apply a transition twice.
async function transition(
  storeId: string,
  id: string,
  from: PurchaseStatus[],
  data: Prisma.PurchaseOrderUncheckedUpdateManyInput,
) {
  const result = await prisma.purchaseOrder.updateMany({
    where: { id, storeId, status: { in: from } },
    data,
  });
  if (result.count === 0) {
    const current = await prisma.purchaseOrder.findFirst({
      where: { id, storeId },
      select: { status: true },
    });
    if (!current) throw notFound();
    throw new AppError(
      409,
      'INVALID_STATE',
      `This order is ${statusLabel(current.status)}, so this action is not allowed.`,
    );
  }
  return getPurchase(storeId, id);
}

export function submitPurchase(storeId: string, id: string) {
  return transition(storeId, id, ['DRAFT'], { status: 'SUBMITTED', submittedAt: new Date() });
}

export function approvePurchase(storeId: string, id: string, actorUserId: string) {
  return transition(storeId, id, ['SUBMITTED'], {
    status: 'APPROVED',
    approvedById: actorUserId,
    approvedAt: new Date(),
  });
}

// Orders that have received stock (partially received or received) cannot be cancelled here.
export function cancelPurchase(storeId: string, id: string, reason: string | null | undefined) {
  return transition(storeId, id, ['DRAFT', 'SUBMITTED', 'APPROVED'], {
    status: 'CANCELLED',
    cancelledAt: new Date(),
    cancelReason: reason ?? null,
  });
}
