import type { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { logger } from '../../utils/logger';
import { hasRole } from '../auth/rbac';
import { DEFAULT_PARAMS } from '../forecasting/forecasting.schemas';
import { getRecommendation, listRecommendations } from '../forecasting/forecasting.service';
import { listLowStock } from '../inventory/inventory.service';
import { daysBetween, isValidDate } from '../reports/dateRange';
import { getCategoryReport, getProductReport, getSummary, inventoryReport } from '../reports/reports.service';
import type { ToolSpec } from './provider';

export interface ToolContext {
  storeId: string;
  role: Role;
}

export interface Evidence {
  tool: string;
  label: string;
  params: Record<string, unknown>;
  period?: { from: string; to: string; timeZone: string };
  metrics: Record<string, string | number>;
}

export type ToolOutcome =
  | { ok: true; data: unknown; evidence: Evidence }
  | { ok: false; error: { code: string; message: string } };

export interface Tool {
  name: string;
  label: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  execute(ctx: ToolContext, rawArgs: unknown): Promise<ToolOutcome>;
}

const fail = (code: string, message: string): ToolOutcome => ({ ok: false, error: { code, message } });
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 80);
type Data = any;

function defineTool<S extends z.ZodTypeAny>(def: {
  name: string;
  label: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  schema: S;
  run: (ctx: ToolContext, params: z.infer<S>) => Promise<unknown>;
  evidence: (params: z.infer<S>, data: Data) => Pick<Evidence, 'period' | 'metrics'>;
}): Tool {
  return {
    name: def.name,
    label: def.label,
    description: def.description,
    jsonSchema: def.jsonSchema,
    async execute(ctx, rawArgs) {
      if (!hasRole(ctx.role, 'MANAGER')) return fail('FORBIDDEN', 'You do not have permission to use this lookup.');
      const parsed = def.schema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        return fail('INVALID_PARAMETERS', parsed.error.issues.map((i) => `${i.path.join('.') || 'parameters'}: ${i.message}`).join('; '));
      }
      try {
        const data = await def.run(ctx, parsed.data);
        const { period, metrics } = def.evidence(parsed.data, data);
        return {
          ok: true,
          data,
          evidence: { tool: def.name, label: def.label, params: parsed.data as Record<string, unknown>, ...(period ? { period } : {}), metrics },
        };
      } catch (err) {
        if (err instanceof AppError) return fail(err.code, err.message);
        logger.error({ err, tool: def.name }, 'AI tool failed');
        return fail('INTERNAL', 'The lookup failed.');
      }
    },
  };
}

const dateStr = z.string().refine(isValidDate, 'Use a real date like 2026-11-01');
function checkRange(v: { from?: string; to?: string }, ctx: z.RefinementCtx) {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', path: ['from'], message });
  if ((v.from === undefined) !== (v.to === undefined)) return issue('Provide both from and to, or neither');
  if (v.from === undefined || v.to === undefined) return;
  if (v.from > v.to) return issue('from must not be after to');
  if (daysBetween(v.from, v.to) + 1 > 366) return issue('The range can cover at most 366 days');
}
const dateProps = {
  from: { type: 'string', description: 'First day, YYYY-MM-DD in the store time zone. Omit from and to for the last 30 days.' },
  to: { type: 'string', description: 'Last day (inclusive), YYYY-MM-DD.' },
};
const period = (d: Data) => ({ from: d.period.from, to: d.period.to, timeZone: d.period.timeZone });

const salesSummary = defineTool({
  name: 'getSalesSummary',
  label: 'Sales summary',
  description: 'Sales, refunds, net sales (excluding tax), cost of goods sold and estimated gross profit for a date range, with a series per day, week or month.',
  jsonSchema: { type: 'object', properties: { ...dateProps, group: { type: 'string', enum: ['day', 'week', 'month'] } }, additionalProperties: false },
  schema: z.object({ from: dateStr.optional(), to: dateStr.optional(), group: z.enum(['day', 'week', 'month']).default('day') }).strict().superRefine(checkRange),
  async run(ctx, p) {
    const s = await getSummary(ctx.storeId, p);
    const series = s.series.length <= 40 ? s.series.map((r) => ({ bucket: r.bucket, salesCount: r.salesCount, netSales: r.netSales, grossProfit: r.grossProfit })) : undefined;
    return { period: s.period, totals: s.totals, warnings: s.warnings, series, seriesOmitted: series === undefined };
  },
  evidence: (_p, d) => ({ period: period(d), metrics: { 'Net sales': d.totals.netSales, 'Gross profit (estimate)': d.totals.grossProfit, 'Cost of goods sold': d.totals.cogs, Refunds: d.totals.refunds, Sales: d.totals.salesCount, Returns: d.totals.returnsCount } }),
});

const topProducts = defineTool({
  name: 'getTopSellingProducts',
  label: 'Top-selling products',
  description: 'The best-selling products for a date range, ranked by units sold, net revenue or estimated profit.',
  jsonSchema: { type: 'object', properties: { ...dateProps, sort: { type: 'string', enum: ['revenue', 'units', 'profit'] }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false },
  schema: z.object({ from: dateStr.optional(), to: dateStr.optional(), sort: z.enum(['revenue', 'units', 'profit']).default('revenue'), limit: z.number().int().min(1).max(20).default(5) }).strict().superRefine(checkRange),
  async run(ctx, p) {
    const r = await getProductReport(ctx.storeId, p);
    return { period: r.period, items: r.items.map((i) => ({ name: clean(i.name), sku: clean(i.sku), unitsSold: i.unitsSold, unitsReturned: i.unitsReturned, netUnits: i.netUnits, netRevenue: i.netRevenue, grossProfit: i.grossProfit })) };
  },
  evidence: (_p, d) => ({ period: period(d), metrics: { 'Products listed': d.items.length, 'Top product': d.items[0]?.name ?? 'none', 'Top product units sold': d.items[0]?.unitsSold ?? 0 } }),
});

const lowStock = defineTool({
  name: 'getLowStockProducts',
  label: 'Low-stock products',
  description: 'Active products at or below their low-stock threshold, lowest first.',
  jsonSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false },
  schema: z.object({ limit: z.number().int().min(1).max(50).default(10) }).strict(),
  async run(ctx, p) {
    const r = await listLowStock(ctx.storeId, p);
    return { total: r.total, items: r.items.map((i) => ({ name: clean(i.name), sku: clean(i.sku), stockQuantity: i.stockQuantity, threshold: i.threshold })) };
  },
  evidence: (_p, d) => ({ metrics: { 'Low-stock products': d.total } }),
});

const inventoryValuation = defineTool({
  name: 'getInventoryValuation',
  label: 'Inventory valuation',
  description: 'Units in stock and their value at cost and at selling price, in total and per category.',
  jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  schema: z.object({}).strict(),
  async run(ctx) {
    const r = await inventoryReport(ctx.storeId);
    return { totals: r.totals, categories: r.categories.map((c) => ({ name: clean(c.name), units: c.units, costValue: c.costValue, retailValue: c.retailValue })) };
  },
  evidence: (_p, d) => ({ metrics: { 'Units in stock': d.totals.units, 'Value at cost': d.totals.costValue, 'Value at selling price': d.totals.retailValue } }),
});

const categoryPerformance = defineTool({
  name: 'getCategoryPerformance',
  label: 'Category performance',
  description: 'Units, net revenue and estimated gross profit per product category for a date range.',
  jsonSchema: { type: 'object', properties: { ...dateProps }, additionalProperties: false },
  schema: z.object({ from: dateStr.optional(), to: dateStr.optional() }).strict().superRefine(checkRange),
  async run(ctx, p) {
    const r = await getCategoryReport(ctx.storeId, p);
    return { period: r.period, items: r.items.map((c) => ({ name: clean(c.name), unitsSold: c.unitsSold, unitsReturned: c.unitsReturned, netUnits: c.netUnits, netRevenue: c.netRevenue, grossProfit: c.grossProfit })) };
  },
  evidence: (_p, d) => ({ period: period(d), metrics: { 'Categories listed': d.items.length, 'Top category': d.items[0]?.name ?? 'none' } }),
});

const explainReorder = defineTool({
  name: 'explainReorderRecommendation',
  label: 'Reorder explanation',
  description: 'The reorder recommendation for one product with every figure and calculation step. Use searchProducts first to find the productId.',
  jsonSchema: { type: 'object', properties: { productId: { type: 'string' }, windowDays: { type: 'integer', minimum: 7, maximum: 180 }, safetyDays: { type: 'integer', minimum: 0, maximum: 60 }, coverageDays: { type: 'integer', minimum: 0, maximum: 180 } }, required: ['productId'], additionalProperties: false },
  schema: z.object({ productId: z.string().uuid(), windowDays: z.number().int().min(7).max(180).default(DEFAULT_PARAMS.windowDays), safetyDays: z.number().int().min(0).max(60).default(DEFAULT_PARAMS.safetyDays), coverageDays: z.number().int().min(0).max(180).default(DEFAULT_PARAMS.coverageDays) }).strict(),
  async run(ctx, p) {
    const r = await getRecommendation(ctx.storeId, p.productId, { windowDays: p.windowDays, safetyDays: p.safetyDays, coverageDays: p.coverageDays });
    const i = r.item;
    return { today: r.today, product: { name: clean(i.name), sku: clean(i.sku) }, status: i.status, confidence: i.confidence, urgency: i.urgency, lowStock: i.lowStock, currentStock: i.currentStock, incomingStock: i.incomingStock, pendingOrderQuantity: i.pendingOrderQuantity, position: i.position, leadTimeDays: i.leadTimeDays, leadTimeSource: i.leadTimeSource, safetyDays: i.safetyDays, coverageDays: i.coverageDays, inputs: i.inputs, averageDailyDemand: i.averageDailyDemand, leadTimeDemand: i.leadTimeDemand, safetyStock: i.safetyStock, coverageStock: i.coverageStock, reorderPoint: i.reorderPoint, orderUpToLevel: i.orderUpToLevel, daysOfCover: i.daysOfCover, recommendedQuantity: i.recommendedQuantity, steps: i.steps };
  },
  evidence: (_p, d) => ({ metrics: { Product: d.product.name, Status: d.status, 'Suggested order': d.recommendedQuantity ?? 'n/a', 'In stock': d.currentStock, Confidence: d.confidence } }),
});

const reorderRecommendations = defineTool({
  name: 'getReorderRecommendations',
  label: 'Reorder recommendations',
  description: 'Products the reorder planner flags: those to reorder now, and low-stock products with too little history to forecast.',
  jsonSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false },
  schema: z.object({ limit: z.number().int().min(1).max(20).default(5) }).strict(),
  async run(ctx, p) {
    const r = await listRecommendations(ctx.storeId, DEFAULT_PARAMS, false);
    return { today: r.today, counts: r.counts, items: r.items.slice(0, p.limit).map((i) => ({ name: clean(i.name), sku: clean(i.sku), status: i.status, urgency: i.urgency, confidence: i.confidence, currentStock: i.currentStock, incomingStock: i.incomingStock, averageDailyDemand: i.averageDailyDemand, daysOfCover: i.daysOfCover, recommendedQuantity: i.recommendedQuantity })) };
  },
  evidence: (_p, d) => ({ metrics: { 'To reorder': d.counts.reorder, 'Low stock, too little history': d.counts.insufficientLowStock } }),
});

const searchProducts = defineTool({
  name: 'searchProducts',
  label: 'Product search',
  description: 'Finds active products by name or SKU and returns their productId, for use with explainReorderRecommendation.',
  jsonSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'], additionalProperties: false },
  schema: z.object({ query: z.string().trim().min(1).max(60), limit: z.number().int().min(1).max(10).default(5) }).strict(),
  async run(ctx, p) {
    const rows = await prisma.product.findMany({ where: { storeId: ctx.storeId, isActive: true, OR: [{ name: { contains: p.query, mode: 'insensitive' } }, { sku: { contains: p.query, mode: 'insensitive' } }] }, select: { id: true, name: true, sku: true, stockQuantity: true }, orderBy: { name: 'asc' }, take: p.limit });
    return { matches: rows.map((r) => ({ productId: r.id, name: clean(r.name), sku: clean(r.sku), stockQuantity: r.stockQuantity })) };
  },
  evidence: (_p, d) => ({ metrics: { Matches: d.matches.length } }),
});

export const TOOLS: Tool[] = [salesSummary, topProducts, lowStock, inventoryValuation, categoryPerformance, explainReorder, reorderRecommendations, searchProducts];
export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));
export const toolSpecs: ToolSpec[] = TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.jsonSchema }));
