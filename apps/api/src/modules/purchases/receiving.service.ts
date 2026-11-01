import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { uniqueViolationOn } from '../../utils/prismaErrors';
import { nextAverageCost } from './costing';
import { getPurchase, loadDetail, notFound, reference, statusLabel } from './purchases.service';
import type { ReceivePurchaseInput } from './receiving.schemas';

const MAX_STOCK = 2_000_000_000; // stays inside a 32-bit integer column

const keyReused = () =>
  new AppError(
    409,
    'IDEMPOTENCY_KEY_REUSED',
    'This idempotency key was already used for a different request',
  );

export async function receivePurchase(
  storeId: string,
  actorUserId: string,
  orderId: string,
  input: ReceivePurchaseInput,
): Promise<{ order: Awaited<ReturnType<typeof getPurchase>>; replayed: boolean }> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // 1. Lock the order row. Parallel receipts, cancellations and edits of this order now
        //    run one at a time. The storeId means another store's order is "not found".
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM purchase_orders
          WHERE id = ${orderId} AND "storeId" = ${storeId}
          FOR UPDATE`;
        if (locked.length === 0) throw notFound();

        // 2. Repeated request? Checked after the lock, so a parallel retry sees the first
        //    request's committed result instead of applying the receipt again.
        const existing = await tx.purchaseReceipt.findUnique({
          where: { storeId_idempotencyKey: { storeId, idempotencyKey: input.idempotencyKey } },
          select: { purchaseOrderId: true },
        });
        if (existing) {
          if (existing.purchaseOrderId !== orderId) throw keyReused();
          return { order: await loadDetail(tx, storeId, orderId), replayed: true };
        }

        // 3. The order must be approved (or already partly received).
        const order = await tx.purchaseOrder.findFirstOrThrow({
          where: { id: orderId, storeId },
          include: { items: true },
        });
        if (order.status !== 'APPROVED' && order.status !== 'PARTIALLY_RECEIVED') {
          throw new AppError(
            409,
            'INVALID_STATE',
            `This order is ${statusLabel(order.status)}, so stock cannot be received.`,
          );
        }

        // 4. Every line must be on the order and not exceed what is still outstanding.
        const itemByProduct = new Map(order.items.map((i) => [i.productId, i]));
        for (const line of input.items) {
          const item = itemByProduct.get(line.productId);
          if (!item) {
            throw new AppError(
              400,
              'PRODUCT_NOT_ON_ORDER',
              'A product in this receipt is not on the order',
            );
          }
          const remaining = item.quantityOrdered - item.quantityReceived;
          if (line.quantity > remaining) {
            throw new AppError(
              409,
              'OVER_RECEIPT',
              `Cannot receive ${line.quantity}: only ${remaining} still expected for this product.`,
            );
          }
        }

        // 5. Lock the products in id order (no deadlocks), then read their current figures.
        const productIds = input.items.map((l) => l.productId).sort();
        await tx.$queryRaw`
          SELECT id FROM products
          WHERE "storeId" = ${storeId} AND id IN (${Prisma.join(productIds)})
          ORDER BY id
          FOR UPDATE`;
        const products = new Map(
          (await tx.product.findMany({ where: { storeId, id: { in: productIds } } })).map((p) => [
            p.id,
            p,
          ]),
        );

        // 6. Record the receipt, then apply each line: stock, average cost, order line, ledger.
        const receipt = await tx.purchaseReceipt.create({
          data: {
            storeId,
            purchaseOrderId: orderId,
            receivedById: actorUserId,
            note: input.note ?? null,
            idempotencyKey: input.idempotencyKey,
          },
        });

        for (const line of input.items) {
          const item = itemByProduct.get(line.productId)!;
          const product = products.get(line.productId);
          if (!product)
            throw new AppError(400, 'INVALID_PRODUCT', 'Product not found in this store');

          const before = product.stockQuantity;
          const after = before + line.quantity;
          if (after > MAX_STOCK) {
            throw new AppError(
              400,
              'QUANTITY_TOO_LARGE',
              'The resulting stock quantity is too large',
            );
          }
          const average = nextAverageCost(
            before,
            product.averageCost ?? product.costPrice,
            line.quantity,
            item.unitCost,
          );

          await tx.product.update({
            where: { id: product.id },
            data: { stockQuantity: after, averageCost: average },
          });
          await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: { quantityReceived: { increment: line.quantity } },
          });
          await tx.purchaseReceiptItem.create({
            data: {
              receiptId: receipt.id,
              purchaseOrderItemId: item.id,
              productId: product.id,
              quantity: line.quantity,
              unitCost: item.unitCost,
            },
          });
          await tx.stockMovement.create({
            data: {
              storeId,
              productId: product.id,
              type: 'RECEIPT',
              quantityChange: line.quantity,
              quantityBefore: before,
              quantityAfter: after,
              reason: `Received on ${reference(order.number)}`,
              referenceType: 'PURCHASE_RECEIPT',
              referenceId: receipt.id,
              actorUserId,
              idempotencyKey: `receipt:${receipt.id}:${item.id}`,
            },
          });
        }

        // 7. The order is RECEIVED once every line is fully received, otherwise PARTIALLY_RECEIVED.
        const lines = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: orderId },
          select: { quantityOrdered: true, quantityReceived: true },
        });
        const complete = lines.every((l) => l.quantityReceived >= l.quantityOrdered);
        await tx.purchaseOrder.update({
          where: { id: orderId },
          data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED' },
        });

        return { order: await loadDetail(tx, storeId, orderId), replayed: false };
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
  } catch (err) {
    // The same key used on two different orders can race past the check above;
    // the unique index settles it and we answer accordingly.
    if (uniqueViolationOn(err, 'idempotencyKey')) {
      const existing = await prisma.purchaseReceipt.findUnique({
        where: { storeId_idempotencyKey: { storeId, idempotencyKey: input.idempotencyKey } },
        select: { purchaseOrderId: true },
      });
      if (existing) {
        if (existing.purchaseOrderId !== orderId) throw keyReused();
        return { order: await getPurchase(storeId, orderId), replayed: true };
      }
    }
    throw err;
  }
}
