import { Prisma, type Role } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { formatMoney } from '../../utils/money';
import { uniqueViolationOn } from '../../utils/prismaErrors';
import { hasRole } from '../auth/rbac';
import { computePricing, type DiscountInput } from './pricing';
import type { CheckoutInput, ListSalesQuery, PreviewInput } from './sales.schemas';

const MAX_CENTS = 999_999_999_999n; // the largest value a Decimal(12,2) column can hold

const saleInclude = {
  cashier: { select: { name: true } },
  items: { orderBy: { productName: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SaleInclude;
type SaleRow = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;
type Db = Pick<Prisma.TransactionClient, 'product' | 'storeSetting'>;

const reference = (n: number) => `S-${String(n).padStart(6, '0')}`;
const toCents = (d: Prisma.Decimal) => BigInt(d.times(100).toFixed(0));
const numberToCents = (v: number) => BigInt(Math.round(v * 100)); // v has at most 2 decimals
const fromCents = (c: bigint) => {
  const s = c.toString().padStart(3, '0');
  return new Prisma.Decimal(`${s.slice(0, -2)}.${s.slice(-2)}`);
};
const money = (c: bigint) => formatMoney(fromCents(c));
const keyReused = () =>
  new AppError(
    409,
    'IDEMPOTENCY_KEY_REUSED',
    'This idempotency key was already used for a different request',
  );

// Loads the products and settings and prices the cart. Used by both preview and checkout,
// so the cart display and the saved sale always come from the same rules.
async function priceCart(
  db: Db,
  storeId: string,
  role: Role,
  items: PreviewInput['items'],
  discount: PreviewInput['discount'],
) {
  if (discount && !hasRole(role, 'MANAGER')) {
    throw new AppError(403, 'DISCOUNT_NOT_ALLOWED', 'Only managers and owners can apply discounts');
  }

  const products = await db.product.findMany({
    where: { storeId, id: { in: items.map((i) => i.productId) } },
  });
  if (products.length !== items.length) {
    throw new AppError(400, 'INVALID_PRODUCT', 'One or more products were not found in this store');
  }
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = items.map((i) => ({ product: byId.get(i.productId)!, quantity: i.quantity }));

  const unavailable = lines.find((l) => !l.product.isActive);
  if (unavailable) {
    throw new AppError(
      409,
      'PRODUCT_UNAVAILABLE',
      `“${unavailable.product.name}” is archived and cannot be sold.`,
    );
  }

  const settings = await db.storeSetting.upsert({
    where: { storeId },
    create: { storeId },
    update: {},
  });

  const discountInput: DiscountInput | null = discount
    ? discount.type === 'PERCENT'
      ? { type: 'PERCENT', hundredths: numberToCents(discount.value) }
      : { type: 'AMOUNT', cents: numberToCents(discount.value) }
    : null;

  const pricing = computePricing(
    lines.map((l) => ({ unitPriceCents: toCents(l.product.sellingPrice), quantity: l.quantity })),
    discountInput,
    { rateHundredths: toCents(settings.taxRatePercent), inclusive: settings.taxInclusive },
  );
  if (pricing.subtotal > MAX_CENTS || pricing.total > MAX_CENTS) {
    throw new AppError(400, 'SALE_TOO_LARGE', 'This sale is too large to record');
  }

  return { lines, pricing, settings, discount: discount ?? null };
}
type PricedCart = Awaited<ReturnType<typeof priceCart>>;

function toPreview(cart: PricedCart) {
  const { lines, pricing, settings } = cart;
  return {
    currency: settings.currency,
    taxName: settings.taxName,
    taxRatePercent: settings.taxRatePercent.toFixed(2),
    taxInclusive: settings.taxInclusive,
    subtotal: money(pricing.subtotal),
    discountTotal: money(pricing.discountTotal),
    taxTotal: money(pricing.taxTotal),
    total: money(pricing.total),
    lines: lines.map((l, i) => {
      const p = pricing.lines[i]!;
      return {
        productId: l.product.id,
        productName: l.product.name,
        productSku: l.product.sku,
        quantity: l.quantity,
        unitPrice: formatMoney(l.product.sellingPrice),
        lineSubtotal: money(p.lineSubtotal),
        discountShare: money(p.discountShare),
        taxShare: money(p.taxShare),
        lineTotal: money(p.lineTotal),
      };
    }),
  };
}

function toDetail(s: SaleRow) {
  return {
    id: s.id,
    number: s.number,
    reference: reference(s.number),
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    cashierName: s.cashier.name,
    customerName: s.customerName,
    currency: s.currency,
    taxName: s.taxName,
    taxRatePercent: s.taxRatePercent.toFixed(2),
    taxInclusive: s.taxInclusive,
    subtotal: formatMoney(s.subtotal),
    discountType: s.discountType,
    discountValue: s.discountValue ? formatMoney(s.discountValue) : null,
    discountTotal: formatMoney(s.discountTotal),
    taxTotal: formatMoney(s.taxTotal),
    total: formatMoney(s.total),
    items: s.items.map((i) => ({
      productId: i.productId,
      productName: i.productName,
      productSku: i.productSku,
      quantity: i.quantity,
      unitPrice: formatMoney(i.unitPrice),
      lineSubtotal: formatMoney(i.lineSubtotal),
      discountShare: formatMoney(i.discountShare),
      taxShare: formatMoney(i.taxShare),
      lineTotal: formatMoney(i.lineTotal),
    })),
    payments: s.payments.map((p) => ({
      method: p.method,
      amount: formatMoney(p.amount),
      tendered: formatMoney(p.tendered),
      change: formatMoney(p.change),
    })),
  };
}

export async function previewSale(storeId: string, role: Role, input: PreviewInput) {
  return toPreview(await priceCart(prisma, storeId, role, input.items, input.discount));
}

function replayOf(existing: SaleRow, actorUserId: string) {
  // Another cashier's key is not ours to replay.
  if (existing.cashierId !== actorUserId) throw keyReused();
  return { sale: toDetail(existing), replayed: true };
}

export async function checkout(
  storeId: string,
  role: Role,
  actorUserId: string,
  input: CheckoutInput,
): Promise<{ sale: ReturnType<typeof toDetail>; replayed: boolean }> {
  if (input.discount && !hasRole(role, 'MANAGER')) {
    throw new AppError(403, 'DISCOUNT_NOT_ALLOWED', 'Only managers and owners can apply discounts');
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        // 1. Lock the products (id order, so no deadlocks). The storeId means another store's
        //    product is simply "not found".
        const ids = input.items.map((i) => i.productId).sort();
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM products
          WHERE "storeId" = ${storeId} AND id IN (${Prisma.join(ids)})
          ORDER BY id
          FOR UPDATE`;
        if (locked.length !== ids.length) {
          throw new AppError(
            400,
            'INVALID_PRODUCT',
            'One or more products were not found in this store',
          );
        }

        // 2. Repeated request? Checked after the locks, so a parallel retry sees the first
        //    request's committed sale instead of selling again.
        const existing = await tx.sale.findUnique({
          where: { storeId_idempotencyKey: { storeId, idempotencyKey: input.idempotencyKey } },
          include: saleInclude,
        });
        if (existing) return replayOf(existing, actorUserId);

        // 3. Price the cart with the current database prices and settings (fresh: locks are held).
        const { lines, pricing, settings, discount } = await priceCart(
          tx,
          storeId,
          role,
          input.items,
          input.discount,
        );

        // 4. Stock.
        for (const l of lines) {
          if (l.product.stockQuantity - l.quantity < 0 && !settings.allowNegativeStock) {
            throw new AppError(
              409,
              'INSUFFICIENT_STOCK',
              `Only ${l.product.stockQuantity} of “${l.product.name}” in stock.`,
            );
          }
        }

        // 5. The cashier must be charging the amount they saw.
        if (
          input.expectedTotal !== undefined &&
          numberToCents(input.expectedTotal) !== pricing.total
        ) {
          throw new AppError(
            409,
            'TOTAL_MISMATCH',
            `The total is now ${money(pricing.total)}, not ${input.expectedTotal.toFixed(2)}. Review the sale and confirm again.`,
          );
        }

        // 6. Payment: cash may be more than the total (change is due); anything else must match.
        const tendered = numberToCents(input.payment.amountTendered);
        if (input.payment.method === 'CASH') {
          if (tendered < pricing.total) {
            throw new AppError(
              409,
              'PAYMENT_INSUFFICIENT',
              `The cash received is less than the total of ${money(pricing.total)}.`,
            );
          }
        } else if (tendered !== pricing.total) {
          throw new AppError(
            409,
            'PAYMENT_AMOUNT_MISMATCH',
            `The amount must equal the total of ${money(pricing.total)}.`,
          );
        }
        const change = input.payment.method === 'CASH' ? tendered - pricing.total : 0n;

        // 7. Receipt number (the UPDATE locks the counter row; a rollback also rolls it back).
        const counter = await tx.store.update({
          where: { id: storeId },
          data: { nextSaleNumber: { increment: 1 } },
          select: { nextSaleNumber: true },
        });

        // 8. Save the sale with snapshots of everything that could change later.
        const sale = await tx.sale.create({
          data: {
            storeId,
            number: counter.nextSaleNumber - 1,
            cashierId: actorUserId,
            customerName: input.customerName ?? null,
            currency: settings.currency,
            taxName: settings.taxName,
            taxRatePercent: settings.taxRatePercent,
            taxInclusive: settings.taxInclusive,
            subtotal: fromCents(pricing.subtotal),
            discountType: discount?.type ?? null,
            discountValue: discount ? fromCents(numberToCents(discount.value)) : null,
            discountTotal: fromCents(pricing.discountTotal),
            taxTotal: fromCents(pricing.taxTotal),
            total: fromCents(pricing.total),
            idempotencyKey: input.idempotencyKey,
            items: {
              create: lines.map((l, i) => {
                const p = pricing.lines[i]!;
                return {
                  productId: l.product.id,
                  productName: l.product.name,
                  productSku: l.product.sku,
                  quantity: l.quantity,
                  unitPrice: l.product.sellingPrice,
                  unitCost: l.product.averageCost ?? l.product.costPrice,
                  lineSubtotal: fromCents(p.lineSubtotal),
                  discountShare: fromCents(p.discountShare),
                  taxShare: fromCents(p.taxShare),
                  lineTotal: fromCents(p.lineTotal),
                };
              }),
            },
            payments: {
              create: {
                storeId,
                method: input.payment.method,
                amount: fromCents(pricing.total),
                tendered: fromCents(tendered),
                change: fromCents(change),
              },
            },
          },
          include: saleInclude,
        });

        // 9. Deduct stock through the ledger.
        for (const item of sale.items) {
          const line = lines.find((l) => l.product.id === item.productId)!;
          const before = line.product.stockQuantity;
          const after = before - line.quantity;
          await tx.product.update({
            where: { id: line.product.id },
            data: { stockQuantity: after },
          });
          await tx.stockMovement.create({
            data: {
              storeId,
              productId: line.product.id,
              type: 'SALE',
              quantityChange: -line.quantity,
              quantityBefore: before,
              quantityAfter: after,
              reason: `Sale ${reference(sale.number)}`,
              referenceType: 'SALE',
              referenceId: sale.id,
              actorUserId,
              idempotencyKey: `sale:${sale.id}:${item.id}`,
            },
          });
        }

        return { sale: toDetail(sale), replayed: false };
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
  } catch (err) {
    // The same key with different products can race past the check above;
    // the unique index settles it and we answer accordingly.
    if (uniqueViolationOn(err, 'idempotencyKey')) {
      const existing = await prisma.sale.findUnique({
        where: { storeId_idempotencyKey: { storeId, idempotencyKey: input.idempotencyKey } },
        include: saleInclude,
      });
      if (existing) return replayOf(existing, actorUserId);
    }
    throw err;
  }
}

// Cashiers see only their own sales; managers and owners see all.
const visibleTo = (role: Role, userId: string): Prisma.SaleWhereInput =>
  hasRole(role, 'MANAGER') ? {} : { cashierId: userId };

export async function listSales(storeId: string, role: Role, userId: string, q: ListSalesQuery) {
  const where: Prisma.SaleWhereInput = { storeId, ...visibleTo(role, userId) };
  const [total, rows] = await prisma.$transaction([
    prisma.sale.count({ where }),
    prisma.sale.findMany({
      where,
      include: {
        cashier: { select: { name: true } },
        items: { select: { quantity: true, returnItems: { select: { quantity: true } } } },
        payments: { select: { method: true } },
      },
      orderBy: [{ number: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);

  return {
    items: rows.map((s) => {
      const unitCount = s.items.reduce((sum, i) => sum + i.quantity, 0);
      const returned = s.items.reduce(
        (sum, i) => sum + i.returnItems.reduce((inner, r) => inner + r.quantity, 0),
        0,
      );
      return {
        id: s.id,
        number: s.number,
        reference: reference(s.number),
        status: s.status,
        createdAt: s.createdAt.toISOString(),
        cashierName: s.cashier.name,
        unitCount,
        returnStatus: returned === 0 ? 'NONE' : returned >= unitCount ? 'FULL' : 'PARTIAL',
        total: formatMoney(s.total),
        paymentMethod: s.payments[0]?.method ?? null,
      };
    }),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.ceil(total / q.pageSize),
  };
}
export async function getSale(storeId: string, role: Role, userId: string, id: string) {
  const row = await prisma.sale.findFirst({
    where: { id, storeId, ...visibleTo(role, userId) },
    include: saleInclude,
  });
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Sale not found');
  return toDetail(row);
}
