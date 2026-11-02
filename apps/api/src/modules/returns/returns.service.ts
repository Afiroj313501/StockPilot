import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { formatMoney } from '../../utils/money';
import { uniqueViolationOn } from '../../utils/prismaErrors';
import { refundForReturn } from './refunds';
import type { CreateReturnInput, ListReturnsQuery, PreviewReturnInput } from './returns.schemas';

const MAX_STOCK = 2_000_000_000; // stays inside a 32-bit integer column

const returnInclude = {
  sale: { select: { number: true } },
  processedBy: { select: { name: true } },
  items: {
    include: { saleItem: { select: { productName: true, productSku: true } } },
    orderBy: { saleItem: { productName: 'asc' } },
  },
} satisfies Prisma.SaleReturnInclude;
type ReturnRow = Prisma.SaleReturnGetPayload<{ include: typeof returnInclude }>;
type SaleRow = Prisma.SaleGetPayload<{ include: { items: true; payments: true } }>;
type Db = Pick<Prisma.TransactionClient, 'sale' | 'saleReturnItem'>;

const saleRef = (n: number) => `S-${String(n).padStart(6, '0')}`;
const returnRef = (n: number) => `R-${String(n).padStart(6, '0')}`;
const toCents = (d: Prisma.Decimal) => BigInt(d.times(100).toFixed(0));
const fromCents = (c: bigint) => {
  const s = c.toString().padStart(3, '0');
  return new Prisma.Decimal(`${s.slice(0, -2)}.${s.slice(-2)}`);
};
const money = (c: bigint) => formatMoney(fromCents(c));
const saleNotFound = () => new AppError(404, 'NOT_FOUND', 'Sale not found');
const keyReused = () =>
  new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different request');

function statusOf(sold: number, returned: number): 'NONE' | 'PARTIAL' | 'FULL' {
  return returned === 0 ? 'NONE' : returned >= sold ? 'FULL' : 'PARTIAL';
}

function toDto(r: ReturnRow) {
  return {
    id: r.id,
    number: r.number,
    reference: returnRef(r.number),
    saleId: r.saleId,
    saleReference: saleRef(r.sale.number),
    createdAt: r.createdAt.toISOString(),
    processedByName: r.processedBy.name,
    note: r.note,
    refundMethod: r.refundMethod,
    refundTotal: formatMoney(r.refundTotal),
    taxRefundTotal: formatMoney(r.taxRefundTotal),
    items: r.items.map((i) => ({
      productId: i.productId,
      productName: i.saleItem.productName,
      productSku: i.saleItem.productSku,
      quantity: i.quantity,
      reason: i.reason,
      restock: i.restock,
      refundAmount: formatMoney(i.refundAmount),
      taxRefund: formatMoney(i.taxRefund),
    })),
  };
}

// The sale lookup is scoped by storeId: another store's sale is simply "not found".
async function loadSale(db: Db, storeId: string, saleId: string): Promise<SaleRow> {
  const sale = await db.sale.findFirst({
    where: { id: saleId, storeId },
    include: { items: true, payments: true },
  });
  if (!sale) throw saleNotFound();
  return sale;
}

async function returnedQuantities(db: Db, saleItemIds: string[]): Promise<Map<string, number>> {
  const rows = await db.saleReturnItem.findMany({
    where: { saleItemId: { in: saleItemIds } },
    select: { saleItemId: true, quantity: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.saleItemId, (map.get(r.saleItemId) ?? 0) + r.quantity);
  return map;
}

interface PlannedLine {
  item: SaleRow['items'][number];
  quantity: number;
  refund: bigint;
  taxRefund: bigint;
}

// Validates the lines against what is still returnable and works out the refund from the
// sale's saved figures. Used by both the preview and the real return.
function buildPlan(sale: SaleRow, returnedBy: Map<string, number>, lines: { productId: string; quantity: number }[]) {
  if (sale.status !== 'COMPLETED') {
    throw new AppError(409, 'INVALID_STATE', 'Only completed sales can be returned.');
  }
  const itemByProduct = new Map(sale.items.map((i) => [i.productId, i]));
  let refundTotal = 0n;
  let taxRefundTotal = 0n;

  const planned: PlannedLine[] = lines.map((line) => {
    const item = itemByProduct.get(line.productId);
    if (!item) throw new AppError(400, 'PRODUCT_NOT_ON_SALE', 'A product in this return is not on the sale');

    const before = returnedBy.get(item.id) ?? 0;
    const returnable = item.quantity - before;
    if (line.quantity > returnable) {
      throw new AppError(
        409,
        'OVER_RETURN',
        `Cannot return ${line.quantity} of “${item.productName}”: only ${returnable} can still be returned.`,
      );
    }
    const refund = refundForReturn(toCents(item.lineTotal), before, line.quantity, item.quantity);
    const taxRefund = refundForReturn(toCents(item.taxShare), before, line.quantity, item.quantity);
    refundTotal += refund;
    taxRefundTotal += taxRefund;
    return { item, quantity: line.quantity, refund, taxRefund };
  });

  return { planned, refundTotal, taxRefundTotal };
}

export async function previewReturn(storeId: string, input: PreviewReturnInput) {
  const sale = await loadSale(prisma, storeId, input.saleId);
  const returnedBy = await returnedQuantities(prisma, sale.items.map((i) => i.id));
  const plan = buildPlan(sale, returnedBy, input.items);
  return {
    currency: sale.currency,
    refundMethod: sale.payments[0]?.method ?? 'OTHER',
    refundTotal: money(plan.refundTotal),
    taxRefundTotal: money(plan.taxRefundTotal),
    lines: plan.planned.map((p) => ({
      productId: p.item.productId,
      productName: p.item.productName,
      quantity: p.quantity,
      refundAmount: money(p.refund),
      taxRefund: money(p.taxRefund),
    })),
  };
}

function replayOf(existing: ReturnRow, saleId: string, actorUserId: string) {
  // The same key must mean the same request from the same person.
  if (existing.saleId !== saleId || existing.processedById !== actorUserId) throw keyReused();
  return { result: toDto(existing), replayed: true };
}

export async function createReturn(
  storeId: string,
  actorUserId: string,
  input: CreateReturnInput,
): Promise<{ result: ReturnType<typeof toDto>; replayed: boolean }> {
  // A damaged item is never put back into stock automatically.
  for (const line of input.items) {
    if (line.restock && line.reason === 'DAMAGED') {
      throw new AppError(
        400,
        'RESTOCK_NOT_ALLOWED',
        'Damaged items are not restocked. Record the return without restocking.',
      );
    }
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        // 1. Lock the sale row. Parallel returns of this sale now run one at a time, so the
        //    returnable quantity below is always up to date.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM sales
          WHERE id = ${input.saleId} AND "storeId" = ${storeId}
          FOR UPDATE`;
        if (locked.length === 0) throw saleNotFound();

        // 2. Repeated request? Checked after the lock, so a parallel retry sees the first
        //    request's committed result instead of refunding again.
        const existing = await tx.saleReturn.findUnique({
          where: { storeId_idempotencyKey: { storeId, idempotencyKey: input.idempotencyKey } },
          include: returnInclude,
        });
        if (existing) return replayOf(existing, input.saleId, actorUserId);

        // 3. Validate against what is still returnable and work out the refund.
        const sale = await loadSale(tx, storeId, input.saleId);
        const returnedBy = await returnedQuantities(tx, sale.items.map((i) => i.id));
        const plan = buildPlan(sale, returnedBy, input.items);

        // 4. Lock the products that go back into stock (id order, so no deadlocks).
        const restockIds = [...new Set(input.items.filter((l) => l.restock).map((l) => l.productId))].sort();
        const stock = new Map<string, number>();
        if (restockIds.length > 0) {
          await tx.$queryRaw`
            SELECT id FROM products
            WHERE "storeId" = ${storeId} AND id IN (${Prisma.join(restockIds)})
            ORDER BY id
            FOR UPDATE`;
          const products = await tx.product.findMany({
            where: { storeId, id: { in: restockIds } },
            select: { id: true, stockQuantity: true },
          });
          for (const p of products) stock.set(p.id, p.stockQuantity);
        }

        // 5. Return number (the UPDATE locks the counter row; a rollback also rolls it back).
        const counter = await tx.store.update({
          where: { id: storeId },
          data: { nextReturnNumber: { increment: 1 } },
          select: { nextReturnNumber: true },
        });

        // 6. Save the return. The refund is a record of what is owed, in the sale's payment method.
        const created = await tx.saleReturn.create({
          data: {
            storeId,
            saleId: sale.id,
            number: counter.nextReturnNumber - 1,
            note: input.note ?? null,
            refundMethod: sale.payments[0]?.method ?? 'OTHER',
            refundTotal: fromCents(plan.refundTotal),
            taxRefundTotal: fromCents(plan.taxRefundTotal),
            processedById: actorUserId,
            idempotencyKey: input.idempotencyKey,
            items: {
              create: plan.planned.map((p, i) => ({
                saleItemId: p.item.id,
                productId: p.item.productId,
                quantity: p.quantity,
                reason: input.items[i]!.reason,
                restock: input.items[i]!.restock,
                refundAmount: fromCents(p.refund),
                taxRefund: fromCents(p.taxRefund),
              })),
            },
          },
          include: returnInclude,
        });

        // 7. Restock through the ledger, only where the decision was yes.
        for (const [i, p] of plan.planned.entries()) {
          if (!input.items[i]!.restock) continue;
          const before = stock.get(p.item.productId);
          if (before === undefined) throw new AppError(400, 'INVALID_PRODUCT', 'Product not found in this store');
          const after = before + p.quantity;
          if (after > MAX_STOCK) {
            throw new AppError(400, 'QUANTITY_TOO_LARGE', 'The resulting stock quantity is too large');
          }
          await tx.product.update({ where: { id: p.item.productId }, data: { stockQuantity: after } });
          await tx.stockMovement.create({
            data: {
              storeId,
              productId: p.item.productId,
              type: 'RETURN',
              quantityChange: p.quantity,
              quantityBefore: before,
              quantityAfter: after,
              reason: `Return ${returnRef(created.number)}`,
              referenceType: 'RETURN',
              referenceId: created.id,
              actorUserId,
              idempotencyKey: `return:${created.id}:${p.item.id}`,
            },
          });
        }

        return { result: toDto(created), replayed: false };
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
  } catch (err) {
    // The same key used on two different sales can race past the check above;
    // the unique index settles it and we answer accordingly.
    if (uniqueViolationOn(err, 'idempotencyKey')) {
      const existing = await prisma.saleReturn.findUnique({
        where: { storeId_idempotencyKey: { storeId, idempotencyKey: input.idempotencyKey } },
        include: returnInclude,
      });
      if (existing) return replayOf(existing, input.saleId, actorUserId);
    }
    throw err;
  }
}

export async function listReturns(storeId: string, q: ListReturnsQuery) {
  const where: Prisma.SaleReturnWhereInput = { storeId };
  if (q.saleId) where.saleId = q.saleId;

  const [total, rows] = await prisma.$transaction([
    prisma.saleReturn.count({ where }),
    prisma.saleReturn.findMany({
      where,
      include: {
        sale: { select: { number: true } },
        processedBy: { select: { name: true } },
        items: { select: { quantity: true } },
      },
      orderBy: [{ number: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      number: r.number,
      reference: returnRef(r.number),
      saleId: r.saleId,
      saleReference: saleRef(r.sale.number),
      createdAt: r.createdAt.toISOString(),
      processedByName: r.processedBy.name,
      unitCount: r.items.reduce((sum, i) => sum + i.quantity, 0),
      refundTotal: formatMoney(r.refundTotal),
      refundMethod: r.refundMethod,
    })),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.ceil(total / q.pageSize),
  };
}

export async function getReturn(storeId: string, id: string) {
  const row = await prisma.saleReturn.findFirst({ where: { id, storeId }, include: returnInclude });
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Return not found');
  return toDto(row);
}

// What can still be returned on a sale, plus its return history.
export async function getSaleReturnable(storeId: string, saleId: string) {
  const sale = await loadSale(prisma, storeId, saleId);
  const [returnedBy, returns] = await Promise.all([
    returnedQuantities(prisma, sale.items.map((i) => i.id)),
    prisma.saleReturn.findMany({
      where: { saleId: sale.id, storeId },
      include: returnInclude,
      orderBy: [{ number: 'desc' }],
    }),
  ]);

  const lines = [...sale.items]
    .sort((a, b) => a.productName.localeCompare(b.productName))
    .map((i) => {
      const returned = returnedBy.get(i.id) ?? 0;
      return {
        productId: i.productId,
        productName: i.productName,
        productSku: i.productSku,
        quantitySold: i.quantity,
        quantityReturned: returned,
        quantityReturnable: i.quantity - returned,
        unitPrice: formatMoney(i.unitPrice),
        lineTotal: formatMoney(i.lineTotal),
      };
    });

  const sold = lines.reduce((sum, l) => sum + l.quantitySold, 0);
  const returned = lines.reduce((sum, l) => sum + l.quantityReturned, 0);

  return {
    saleId: sale.id,
    saleReference: saleRef(sale.number),
    saleStatus: sale.status,
    currency: sale.currency,
    refundMethod: sale.payments[0]?.method ?? 'OTHER',
    returnStatus: statusOf(sold, returned),
    lines,
    returns: returns.map(toDto),
  };
}