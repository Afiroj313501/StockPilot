import { Prisma, type Role } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { listLowStock } from '../inventory/inventory.service';
import { listSales } from '../sales/sales.service';
import {
  addDays,
  bucketKeys,
  daysBetween,
  localToday,
  MAX_DAY_GROUP_DAYS,
  rangeToUtc,
  type Group,
} from './dateRange';

export interface Range {
  from: string;
  to: string;
  timeZone: string;
  today: string;
}

const D = (v: string | number | null | undefined) => new Prisma.Decimal(v ?? 0);
const money = (d: Prisma.Decimal) => d.toFixed(2);

export async function loadRange(
  storeId: string,
  q: { from?: string | undefined; to?: string | undefined },
): Promise<Range> {
  const setting = await prisma.storeSetting.findUnique({
    where: { storeId },
    select: { timeZone: true },
  });
  const timeZone = setting?.timeZone ?? 'UTC';
  const today = localToday(timeZone);
  if (q.from && q.to) return { from: q.from, to: q.to, timeZone, today };
  return { from: addDays(today, -29), to: today, timeZone, today };
}

export function assertGroupFits(range: Range, group: Group): void {
  if (group === 'day' && daysBetween(range.from, range.to) + 1 > MAX_DAY_GROUP_DAYS) {
    throw new AppError(
      400,
      'RANGE_TOO_LONG',
      `Daily grouping covers at most ${MAX_DAY_GROUP_DAYS} days. Use weeks or months.`,
    );
  }
}

// ---- SQL helpers -------------------------------------------------------------------------

// createdAt columns hold UTC wall-clock time, so the window is passed as UTC wall-clock text.
const ts = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '');

function inRange(column: Prisma.Sql, range: Range) {
  const { start, end } = rangeToUtc(range.from, range.to, range.timeZone);
  return Prisma.sql`${column} >= ${ts(start)}::timestamp AND ${column} < ${ts(end)}::timestamp`;
}

// The store-local day, ISO week start (Monday) or month start that a UTC timestamp falls in.
function bucketSql(column: Prisma.Sql, group: Group, timeZone: string) {
  const local = Prisma.sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}::text)`;
  if (group === 'week')
    return Prisma.sql`to_char(date_trunc('week', ${local})::date, 'YYYY-MM-DD')`;
  if (group === 'month')
    return Prisma.sql`to_char(date_trunc('month', ${local})::date, 'YYYY-MM-DD')`;
  return Prisma.sql`to_char(${local}::date, 'YYYY-MM-DD')`;
}

// ---- Sales over time ---------------------------------------------------------------------

interface Acc {
  salesCount: number;
  returnsCount: number;
  gross: Prisma.Decimal;
  discounts: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
  refunds: Prisma.Decimal;
  taxRefunds: Prisma.Decimal;
  soldCost: Prisma.Decimal;
  restockedCost: Prisma.Decimal;
  zeroCostLines: number;
}

const blank = (): Acc => ({
  salesCount: 0,
  returnsCount: 0,
  gross: D(0),
  discounts: D(0),
  tax: D(0),
  total: D(0),
  refunds: D(0),
  taxRefunds: D(0),
  soldCost: D(0),
  restockedCost: D(0),
  zeroCostLines: 0,
});

function add(target: Acc, b: Acc) {
  target.salesCount += b.salesCount;
  target.returnsCount += b.returnsCount;
  target.gross = target.gross.plus(b.gross);
  target.discounts = target.discounts.plus(b.discounts);
  target.tax = target.tax.plus(b.tax);
  target.total = target.total.plus(b.total);
  target.refunds = target.refunds.plus(b.refunds);
  target.taxRefunds = target.taxRefunds.plus(b.taxRefunds);
  target.soldCost = target.soldCost.plus(b.soldCost);
  target.restockedCost = target.restockedCost.plus(b.restockedCost);
  target.zeroCostLines += b.zeroCostLines;
}

function metricsOf(a: Acc) {
  const netSales = a.total.minus(a.tax).minus(a.refunds.minus(a.taxRefunds));
  const cogs = a.soldCost.minus(a.restockedCost);
  return {
    salesCount: a.salesCount,
    returnsCount: a.returnsCount,
    grossSales: money(a.gross),
    discounts: money(a.discounts),
    taxCollected: money(a.tax),
    salesTotal: money(a.total),
    refunds: money(a.refunds),
    taxRefunded: money(a.taxRefunds),
    netSales: money(netSales),
    cogs: money(cogs),
    grossProfit: money(netSales.minus(cogs)),
  };
}

export async function summaryFor(storeId: string, range: Range, group: Group) {
  const salesBucket = bucketSql(Prisma.sql`s."createdAt"`, group, range.timeZone);
  const returnBucket = bucketSql(Prisma.sql`r."createdAt"`, group, range.timeZone);
  const saleWindow = inRange(Prisma.sql`s."createdAt"`, range);
  const returnWindow = inRange(Prisma.sql`r."createdAt"`, range);

  const [sales, returns, soldCost, restocked] = await Promise.all([
    prisma.$queryRaw<
      {
        bucket: string;
        sales_count: number;
        gross: string;
        discounts: string;
        tax: string;
        total: string;
      }[]
    >(Prisma.sql`
      SELECT ${salesBucket} AS bucket,
             COUNT(*)::int AS sales_count,
             COALESCE(SUM(s."subtotal"), 0)::text AS gross,
             COALESCE(SUM(s."discountTotal"), 0)::text AS discounts,
             COALESCE(SUM(s."taxTotal"), 0)::text AS tax,
             COALESCE(SUM(s."total"), 0)::text AS total
      FROM sales s
      WHERE s."storeId" = ${storeId} AND s.status = 'COMPLETED' AND ${saleWindow}
      GROUP BY 1`),
    prisma.$queryRaw<
      { bucket: string; returns_count: number; refunds: string; tax_refunds: string }[]
    >(Prisma.sql`
      SELECT ${returnBucket} AS bucket,
             COUNT(*)::int AS returns_count,
             COALESCE(SUM(r."refundTotal"), 0)::text AS refunds,
             COALESCE(SUM(r."taxRefundTotal"), 0)::text AS tax_refunds
      FROM sale_returns r
      WHERE r."storeId" = ${storeId} AND ${returnWindow}
      GROUP BY 1`),
    prisma.$queryRaw<{ bucket: string; cogs: string; zero_cost_lines: number }[]>(Prisma.sql`
      SELECT ${salesBucket} AS bucket,
             COALESCE(SUM(ROUND(si.quantity * si."unitCost", 2)), 0)::text AS cogs,
             (COUNT(*) FILTER (WHERE si."unitCost" = 0))::int AS zero_cost_lines
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE s."storeId" = ${storeId} AND s.status = 'COMPLETED' AND ${saleWindow}
      GROUP BY 1`),
    prisma.$queryRaw<{ bucket: string; restocked_cost: string }[]>(Prisma.sql`
      SELECT ${returnBucket} AS bucket,
             COALESCE(SUM(ROUND(ri.quantity * si."unitCost", 2)), 0)::text AS restocked_cost
      FROM sale_return_items ri
      JOIN sale_returns r ON r.id = ri."returnId"
      JOIN sale_items si ON si.id = ri."saleItemId"
      WHERE r."storeId" = ${storeId} AND ri.restock = true AND ${returnWindow}
      GROUP BY 1`),
  ]);

  // Every bucket in the range appears, even with no activity.
  const buckets = new Map<string, Acc>();
  for (const key of bucketKeys(range.from, range.to, group)) buckets.set(key, blank());
  const at = (key: string) => {
    let b = buckets.get(key);
    if (!b) {
      b = blank();
      buckets.set(key, b);
    }
    return b;
  };

  for (const r of sales) {
    const b = at(r.bucket);
    b.salesCount = r.sales_count;
    b.gross = D(r.gross);
    b.discounts = D(r.discounts);
    b.tax = D(r.tax);
    b.total = D(r.total);
  }
  for (const r of returns) {
    const b = at(r.bucket);
    b.returnsCount = r.returns_count;
    b.refunds = D(r.refunds);
    b.taxRefunds = D(r.tax_refunds);
  }
  for (const r of soldCost) {
    const b = at(r.bucket);
    b.soldCost = D(r.cogs);
    b.zeroCostLines = r.zero_cost_lines;
  }
  for (const r of restocked) at(r.bucket).restockedCost = D(r.restocked_cost);

  // The totals are the sum of the buckets, so a table, a chart and a CSV can never disagree.
  const totals = blank();
  for (const b of buckets.values()) add(totals, b);

  return {
    period: { from: range.from, to: range.to, timeZone: range.timeZone, today: range.today, group },
    totals: metricsOf(totals),
    series: [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([bucket, acc]) => ({ bucket, ...metricsOf(acc) })),
    warnings: { zeroCostLines: totals.zeroCostLines },
  };
}

export async function getSummary(
  storeId: string,
  q: { from?: string | undefined; to?: string | undefined; group: Group },
) {
  const range = await loadRange(storeId, q);
  assertGroupFits(range, q.group);
  return summaryFor(storeId, range, q.group);
}

// ---- Products and categories -------------------------------------------------------------

type Kind = 'product' | 'category';

const keySql = (k: Kind) =>
  k === 'product' ? Prisma.sql`si."productId"` : Prisma.sql`COALESCE(p."categoryId", 'none')`;
const labelSql = (k: Kind) =>
  k === 'product'
    ? Prisma.sql`MAX(si."productName")`
    : Prisma.sql`COALESCE(MAX(c."name"), 'Uncategorized')`;
const skuSql = (k: Kind) => (k === 'product' ? Prisma.sql`MAX(si."productSku")` : Prisma.sql`''`);

interface Fact {
  key: string;
  name: string;
  sku: string;
  unitsSold: number;
  unitsReturned: number;
  revSold: Prisma.Decimal;
  revReturned: Prisma.Decimal;
  costSold: Prisma.Decimal;
  costRestocked: Prisma.Decimal;
}

async function facts(storeId: string, range: Range, kind: Kind): Promise<Fact[]> {
  const key = keySql(kind);
  const label = labelSql(kind);
  const sku = skuSql(kind);

  const [sold, returned] = await Promise.all([
    prisma.$queryRaw<
      { key: string; label: string; sku: string; units: string; revenue: string; cost: string }[]
    >(Prisma.sql`
      SELECT ${key} AS key, ${label} AS label, ${sku} AS sku,
             SUM(si.quantity)::text AS units,
             SUM(si."lineTotal" - si."taxShare")::text AS revenue,
             SUM(ROUND(si.quantity * si."unitCost", 2))::text AS cost
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      JOIN products p ON p.id = si."productId"
      LEFT JOIN categories c ON c.id = p."categoryId"
      WHERE s."storeId" = ${storeId} AND s.status = 'COMPLETED' AND ${inRange(Prisma.sql`s."createdAt"`, range)}
      GROUP BY 1`),
    prisma.$queryRaw<
      {
        key: string;
        label: string;
        sku: string;
        units: string;
        revenue: string;
        restocked_cost: string;
      }[]
    >(Prisma.sql`
      SELECT ${key} AS key, ${label} AS label, ${sku} AS sku,
             SUM(ri.quantity)::text AS units,
             SUM(ri."refundAmount" - ri."taxRefund")::text AS revenue,
             SUM(CASE WHEN ri.restock THEN ROUND(ri.quantity * si."unitCost", 2) ELSE 0 END)::text AS restocked_cost
      FROM sale_return_items ri
      JOIN sale_returns r ON r.id = ri."returnId"
      JOIN sale_items si ON si.id = ri."saleItemId"
      JOIN products p ON p.id = ri."productId"
      LEFT JOIN categories c ON c.id = p."categoryId"
      WHERE r."storeId" = ${storeId} AND ${inRange(Prisma.sql`r."createdAt"`, range)}
      GROUP BY 1`),
  ]);

  const map = new Map<string, Fact>();
  const at = (k: string, name: string, s: string) => {
    let f = map.get(k);
    if (!f) {
      f = {
        key: k,
        name,
        sku: s,
        unitsSold: 0,
        unitsReturned: 0,
        revSold: D(0),
        revReturned: D(0),
        costSold: D(0),
        costRestocked: D(0),
      };
      map.set(k, f);
    }
    return f;
  };
  for (const r of sold) {
    const f = at(r.key, r.label, r.sku);
    f.unitsSold = Number(r.units);
    f.revSold = D(r.revenue);
    f.costSold = D(r.cost);
  }
  for (const r of returned) {
    const f = at(r.key, r.label, r.sku);
    f.unitsReturned = Number(r.units);
    f.revReturned = D(r.revenue);
    f.costRestocked = D(r.restocked_cost);
  }
  return [...map.values()];
}

function rowOf(f: Fact) {
  const netRevenue = f.revSold.minus(f.revReturned);
  const cogs = f.costSold.minus(f.costRestocked);
  return {
    f,
    netRevenue,
    cogs,
    profit: netRevenue.minus(cogs),
  };
}

const byDesc = (a: Prisma.Decimal, b: Prisma.Decimal) => b.comparedTo(a);

export async function productRows(
  storeId: string,
  range: Range,
  sort: 'revenue' | 'units' | 'profit',
  limit?: number,
) {
  const rows = (await facts(storeId, range, 'product')).map(rowOf);
  rows.sort((a, b) => {
    const metric = (r: (typeof rows)[number]) =>
      sort === 'units' ? D(r.f.unitsSold) : sort === 'profit' ? r.profit : r.netRevenue;
    return byDesc(metric(a), metric(b)) || a.f.name.localeCompare(b.f.name);
  });
  return (limit ? rows.slice(0, limit) : rows).map((r) => ({
    productId: r.f.key,
    name: r.f.name,
    sku: r.f.sku,
    unitsSold: r.f.unitsSold,
    unitsReturned: r.f.unitsReturned,
    netUnits: r.f.unitsSold - r.f.unitsReturned,
    netRevenue: money(r.netRevenue),
    cogs: money(r.cogs),
    grossProfit: money(r.profit),
  }));
}

export async function categoryRows(storeId: string, range: Range) {
  const rows = (await facts(storeId, range, 'category')).map(rowOf);
  rows.sort((a, b) => byDesc(a.netRevenue, b.netRevenue) || a.f.name.localeCompare(b.f.name));
  return rows.map((r) => ({
    categoryId: r.f.key === 'none' ? null : r.f.key,
    name: r.f.name,
    unitsSold: r.f.unitsSold,
    unitsReturned: r.f.unitsReturned,
    netUnits: r.f.unitsSold - r.f.unitsReturned,
    netRevenue: money(r.netRevenue),
    cogs: money(r.cogs),
    grossProfit: money(r.profit),
  }));
}

export async function getProductReport(
  storeId: string,
  q: {
    from?: string | undefined;
    to?: string | undefined;
    sort: 'revenue' | 'units' | 'profit';
    limit: number;
  },
) {
  const range = await loadRange(storeId, q);
  return {
    period: { from: range.from, to: range.to, timeZone: range.timeZone, today: range.today },
    items: await productRows(storeId, range, q.sort, q.limit),
  };
}

export async function getCategoryReport(
  storeId: string,
  q: { from?: string | undefined; to?: string | undefined },
) {
  const range = await loadRange(storeId, q);
  return {
    period: { from: range.from, to: range.to, timeZone: range.timeZone, today: range.today },
    items: await categoryRows(storeId, range),
  };
}

// ---- Inventory valuation -----------------------------------------------------------------

export async function inventoryReport(storeId: string) {
  const rows = await prisma.$queryRaw<
    {
      key: string;
      name: string;
      units: string;
      products_with_stock: number;
      cost_value: string;
      retail_value: string;
    }[]
  >(Prisma.sql`
    SELECT COALESCE(p."categoryId", 'none') AS key,
           COALESCE(MAX(c."name"), 'Uncategorized') AS name,
           COALESCE(SUM(GREATEST(p."stockQuantity", 0)), 0)::text AS units,
           (COUNT(*) FILTER (WHERE p."stockQuantity" > 0))::int AS products_with_stock,
           COALESCE(SUM(ROUND(GREATEST(p."stockQuantity", 0) * COALESCE(p."averageCost", p."costPrice"), 2)), 0)::text AS cost_value,
           COALESCE(SUM(GREATEST(p."stockQuantity", 0) * p."sellingPrice"), 0)::text AS retail_value
    FROM products p
    LEFT JOIN categories c ON c.id = p."categoryId"
    WHERE p."storeId" = ${storeId}
    GROUP BY 1`);

  let units = 0;
  let withStock = 0;
  let cost = D(0);
  let retail = D(0);
  const categories = rows
    .map((r) => {
      units += Number(r.units);
      withStock += r.products_with_stock;
      cost = cost.plus(D(r.cost_value));
      retail = retail.plus(D(r.retail_value));
      return {
        categoryId: r.key === 'none' ? null : r.key,
        name: r.name,
        units: Number(r.units),
        costValue: money(D(r.cost_value)),
        retailValue: money(D(r.retail_value)),
        sortValue: D(r.cost_value),
      };
    })
    .sort((a, b) => byDesc(a.sortValue, b.sortValue) || a.name.localeCompare(b.name))
    .map(({ sortValue: _unused, ...rest }) => rest);

  return {
    totals: {
      units,
      productsWithStock: withStock,
      costValue: money(cost),
      retailValue: money(retail),
    },
    categories,
    lowStock: await listLowStock(storeId, { limit: 50 }),
  };
}

// ---- Dashboard ---------------------------------------------------------------------------

export async function getDashboard(
  storeId: string,
  role: Role,
  userId: string,
  q: { from?: string | undefined; to?: string | undefined },
) {
  const range = await loadRange(storeId, q);
  assertGroupFits(range, 'day');

  const [summary, topProducts, categories, inventory, awaitingApproval, awaitingDelivery, recent] =
    await Promise.all([
      summaryFor(storeId, range, 'day'),
      productRows(storeId, range, 'revenue', 5),
      categoryRows(storeId, range),
      inventoryReport(storeId),
      prisma.purchaseOrder.count({ where: { storeId, status: 'SUBMITTED' } }),
      prisma.purchaseOrder.count({
        where: { storeId, status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] } },
      }),
      listSales(storeId, role, userId, { page: 1, pageSize: 5 }),
    ]);

  return {
    period: summary.period,
    summary,
    topProducts,
    categories,
    inventory: inventory.totals,
    lowStock: inventory.lowStock,
    pendingPurchases: { awaitingApproval, awaitingDelivery },
    recentSales: recent.items,
  };
}
