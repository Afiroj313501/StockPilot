import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { listLowStock } from '../inventory/inventory.service';
import { Raw, toCsv, type Cell } from './csv';
import { formatLocalDateTime, rangeToUtc, type Group } from './dateRange';
import {
  assertGroupFits,
  categoryRows,
  inventoryReport,
  loadRange,
  productRows,
  summaryFor,
} from './reports.service';
import type { ExportKind } from './reports.schemas';

const n = (v: string | number) => new Raw(String(v));
const MAX_ROWS = 50_000;

export async function buildExport(
  storeId: string,
  kind: ExportKind,
  q: { from?: string | undefined; to?: string | undefined; group?: Group | undefined },
): Promise<{ filename: string; csv: string }> {
  const range = await loadRange(storeId, q);
  const span = `${range.from}_to_${range.to}`;

  switch (kind) {
    case 'sales': {
      const group = q.group ?? 'day';
      assertGroupFits(range, group);
      const s = await summaryFor(storeId, range, group);
      const line = (label: Cell, m: typeof s.totals): Cell[] => [
        label, n(m.salesCount), n(m.returnsCount), n(m.grossSales), n(m.discounts), n(m.taxCollected),
        n(m.salesTotal), n(m.refunds), n(m.taxRefunded), n(m.netSales), n(m.cogs), n(m.grossProfit),
      ];
      return {
        filename: `sales-${span}.csv`,
        csv: toCsv(
          ['Period', 'Sales', 'Returns', 'Gross sales', 'Discounts', 'Tax collected', 'Sales total', 'Refunds', 'Tax refunded', 'Net sales (ex tax)', 'Cost of goods sold', 'Gross profit (estimate)'],
          [...s.series.map((r) => line(n(r.bucket), r)), line('Total', s.totals)],
        ),
      };
    }

    case 'products': {
      const rows = await productRows(storeId, range, 'revenue');
      return {
        filename: `products-${span}.csv`,
        csv: toCsv(
          ['Product', 'SKU', 'Units sold', 'Units returned', 'Net units', 'Net revenue (ex tax)', 'Cost of goods sold', 'Gross profit (estimate)'],
          rows.map((r) => [r.name, r.sku, n(r.unitsSold), n(r.unitsReturned), n(r.netUnits), n(r.netRevenue), n(r.cogs), n(r.grossProfit)]),
        ),
      };
    }

    case 'categories': {
      const rows = await categoryRows(storeId, range);
      return {
        filename: `categories-${span}.csv`,
        csv: toCsv(
          ['Category', 'Units sold', 'Units returned', 'Net units', 'Net revenue (ex tax)', 'Cost of goods sold', 'Gross profit (estimate)'],
          rows.map((r) => [r.name, n(r.unitsSold), n(r.unitsReturned), n(r.netUnits), n(r.netRevenue), n(r.cogs), n(r.grossProfit)]),
        ),
      };
    }

    case 'inventory': {
      const inv = await inventoryReport(storeId);
      return {
        filename: `inventory-valuation-${range.today}.csv`,
        csv: toCsv(
          ['Category', 'Units in stock', 'Products with stock', 'Cost value', 'Retail value'],
          [
            ...inv.categories.map((c): Cell[] => [c.name, n(c.units), n(''), n(c.costValue), n(c.retailValue)]),
            ['Total', n(inv.totals.units), n(inv.totals.productsWithStock), n(inv.totals.costValue), n(inv.totals.retailValue)],
          ],
        ),
      };
    }

    case 'low-stock': {
      const low = await listLowStock(storeId, { limit: 200 }); // the 200 lowest products
      return {
        filename: `low-stock-${range.today}.csv`,
        csv: toCsv(
          ['Product', 'SKU', 'In stock', 'Threshold'],
          low.items.map((i) => [i.name, i.sku, n(i.stockQuantity), n(i.threshold)]),
        ),
      };
    }

    case 'returns': {
      const { start, end } = rangeToUtc(range.from, range.to, range.timeZone);
      const items = await prisma.saleReturnItem.findMany({
        where: { saleReturn: { storeId, createdAt: { gte: start, lt: end } } },
        include: {
          saleReturn: { include: { sale: { select: { number: true } }, processedBy: { select: { name: true } } } },
          saleItem: { select: { productName: true, productSku: true } },
        },
        orderBy: [{ saleReturn: { createdAt: 'asc' } }, { id: 'asc' }],
        take: MAX_ROWS,
      });
      return {
        filename: `returns-${span}.csv`,
        csv: toCsv(
          ['Return', 'Sale', 'Date', 'Processed by', 'Product', 'SKU', 'Units', 'Reason', 'Restocked', 'Refund', 'Tax in refund'],
          items.map((i) => [
            `R-${String(i.saleReturn.number).padStart(6, '0')}`,
            `S-${String(i.saleReturn.sale.number).padStart(6, '0')}`,
            formatLocalDateTime(i.saleReturn.createdAt, range.timeZone),
            i.saleReturn.processedBy.name,
            i.saleItem.productName,
            i.saleItem.productSku,
            n(i.quantity),
            i.reason,
            i.restock ? 'Yes' : 'No',
            n(i.refundAmount.toFixed(2)),
            n(i.taxRefund.toFixed(2)),
          ]),
        ),
      };
    }

    case 'purchases': {
      const { start, end } = rangeToUtc(range.from, range.to, range.timeZone);
      const orders = await prisma.purchaseOrder.findMany({
        where: { storeId, createdAt: { gte: start, lt: end } },
        include: { supplier: { select: { name: true } }, items: { select: { quantityOrdered: true, unitCost: true } } },
        orderBy: { number: 'asc' },
        take: MAX_ROWS,
      });
      return {
        filename: `purchases-${span}.csv`,
        csv: toCsv(
          ['Order', 'Supplier', 'Status', 'Created', 'Expected delivery', 'Lines', 'Total'],
          orders.map((o) => [
            `PO-${String(o.number).padStart(4, '0')}`,
            o.supplier.name,
            o.status,
            formatLocalDateTime(o.createdAt, range.timeZone),
            o.expectedDate ? o.expectedDate.toISOString().slice(0, 10) : '',
            n(o.items.length),
            n(o.items.reduce((sum, i) => sum.plus(i.unitCost.times(i.quantityOrdered)), new Prisma.Decimal(0)).toFixed(2)),
          ]),
        ),
      };
    }
  }
}