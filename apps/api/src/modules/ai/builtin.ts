import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { daysBetween } from '../reports/dateRange';
import { resolvePeriod } from './Period';
import { toolByName, type Evidence, type ToolContext } from './tools';

export interface StoreFacts { currency: string; timeZone: string; today: string }
export type BuiltInResult =
  | { kind: 'ANSWER'; answer: string; evidence: Evidence[] }
  | { kind: 'UNSUPPORTED'; message: string | null };

export const SUPPORTED_QUESTIONS = [
  'Which products are at risk of running out?', 'Which products sold the most last month?',
  'What was my gross profit this week?', 'Which categories need attention?',
  'Why does <product name> need reordering?', 'Summarise the recent sales trend.',
  'What is my inventory worth?', 'Suggest inventory actions.',
];

export type Intent = 'SUGGEST' | 'EXPLAIN_PRODUCT' | 'INVENTORY_VALUE' | 'RISK' | 'TOP_PRODUCTS' | 'CATEGORIES' | 'SALES';

export function detectIntent(question: string): Intent | null {
  const q = question.toLowerCase();
  if (/suggest|what should i do|inventory actions|recommended actions/.test(q)) return 'SUGGEST';
  if (/\bwhy\b.*(reorder|restock|order)|explain.*(reorder|recommendation)/.test(q)) return 'EXPLAIN_PRODUCT';
  if (/(inventory|stock).*(value|worth)|(value|worth).*(inventory|stock)|inventory valuation/.test(q)) return 'INVENTORY_VALUE';
  if (/running out|run out|out of stock|at risk|low stock|reorder|restock|need to order|stockout/.test(q)) return 'RISK';
  if (/best.?sell|top.?sell|sold the most|sell the most|most sold|top products|popular/.test(q)) return 'TOP_PRODUCTS';
  if (/categor/.test(q)) return 'CATEGORIES';
  if (/profit|margin|revenue|net sales|sales|sold|income|earn|trend/.test(q)) return 'SALES';
  return null;
}

type Json = any;
async function call(ctx: ToolContext, evidence: Evidence[], name: string, params: Record<string, unknown>): Promise<Json> {
  const tool = toolByName.get(name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  const outcome = await tool.execute(ctx, params);
  if (!outcome.ok) throw new AppError(400, outcome.error.code, outcome.error.message);
  evidence.push(outcome.evidence);
  return outcome.data;
}

async function findProductInQuestion(storeId: string, question: string) {
  const q = question.toLowerCase();
  const products = await prisma.product.findMany({
    where: { storeId, isActive: true }, select: { id: true, name: true, sku: true }, take: 5000,
  });
  let best: { id: string; name: string; length: number } | null = null;
  for (const p of products) {
    const hit = [p.name, p.sku].find((t) => t.length >= 2 && q.includes(t.toLowerCase()));
    if (hit && (!best || hit.length > best.length)) best = { id: p.id, name: p.name, length: hit.length };
  }
  return best;
}

export async function answerBuiltIn(ctx: ToolContext, question: string, facts: StoreFacts): Promise<BuiltInResult> {
  const intent = detectIntent(question);
  if (!intent) return { kind: 'UNSUPPORTED', message: null };
  const evidence: Evidence[] = [];
  const m = (v: string) => `${v} ${facts.currency}`;
  const done = (answer: string): BuiltInResult => ({ kind: 'ANSWER', answer, evidence });

  switch (intent) {
    case 'SALES': {
      const period = resolvePeriod(question, facts.today);
      const grouping = daysBetween(period.from, period.to) + 1 > 31 ? 'week' : 'day';
      const d = await call(ctx, evidence, 'getSalesSummary', { from: period.from, to: period.to, group: grouping });
      const t = d.totals;
      if (t.salesCount === 0 && t.returnsCount === 0) return done(`There were no sales between ${d.period.from} and ${d.period.to} (${d.period.timeZone}).`);
      let text = `For ${period.label} (${d.period.from} to ${d.period.to}, ${d.period.timeZone}): ${t.salesCount} sale(s) brought in net sales of ${m(t.netSales)} after ${m(t.refunds)} of refunds, excluding tax. Estimated gross profit is ${m(t.grossProfit)} (cost of goods sold ${m(t.cogs)}). Revenue is not profit: profit also subtracts what the goods cost.`;
      const best = (d.series ?? []).reduce((top: Json, r: Json) => top === null || Number(r.netSales) > Number(top.netSales) ? r : top, null);
      if (best && Number(best.netSales) > 0) text += `\nBest ${grouping}: ${best.bucket} with net sales of ${m(best.netSales)}.`;
      if (d.warnings.zeroCostLines > 0) text += `\nNote: ${d.warnings.zeroCostLines} sold line(s) have a cost of 0, so profit may be overstated.`;
      return done(text);
    }
    case 'TOP_PRODUCTS': {
      const period = resolvePeriod(question, facts.today);
      const d = await call(ctx, evidence, 'getTopSellingProducts', { from: period.from, to: period.to, sort: 'units', limit: 5 });
      if (d.items.length === 0) return done(`No products were sold between ${d.period.from} and ${d.period.to}.`);
      const lines = d.items.map((i: Json, n: number) => `${n + 1}. ${i.name}: ${i.unitsSold} unit(s) sold, net revenue ${m(i.netRevenue)}, estimated profit ${m(i.grossProfit)}`);
      return done(`Top products by units sold for ${period.label} (${d.period.from} to ${d.period.to}):\n${lines.join('\n')}`);
    }
    case 'CATEGORIES': {
      const period = resolvePeriod(question, facts.today);
      const d = await call(ctx, evidence, 'getCategoryPerformance', { from: period.from, to: period.to });
      if (d.items.length === 0) return done(`No category sales between ${d.period.from} and ${d.period.to}.`);
      const lines = d.items.map((c: Json) => `${c.name}: net revenue ${m(c.netRevenue)}, estimated profit ${m(c.grossProfit)}`);
      const lowest = d.items[d.items.length - 1];
      return done(`Category performance for ${period.label} (${d.period.from} to ${d.period.to}):\n${lines.join('\n')}${d.items.length > 1 ? `\nLowest net revenue: ${lowest.name} (${m(lowest.netRevenue)}).` : ''}`);
    }
    case 'INVENTORY_VALUE': {
      const d = await call(ctx, evidence, 'getInventoryValuation', {});
      const biggest = d.categories[0];
      return done(`Your inventory holds ${d.totals.units} unit(s) across ${d.totals.productsWithStock} product(s): ${m(d.totals.costValue)} at cost and ${m(d.totals.retailValue)} at selling price.${biggest ? `\nLargest category by cost value: ${biggest.name} (${m(biggest.costValue)}).` : ''}`);
    }
    case 'RISK':
    case 'SUGGEST': {
      const rec = await call(ctx, evidence, 'getReorderRecommendations', { limit: 5 });
      const low = await call(ctx, evidence, 'getLowStockProducts', { limit: 5 });
      const reorder = rec.items.filter((i: Json) => i.status === 'REORDER');
      const lines: string[] = [];
      if (reorder.length > 0) {
        lines.push(intent === 'SUGGEST' ? 'Reorder (open the Reorder planner to create draft orders):' : 'Likely to run out soon:');
        for (const i of reorder) lines.push(`- ${i.name}: ${i.currentStock} in stock (${i.daysOfCover ? `${i.daysOfCover} days of cover` : 'no cover left'}), suggested order ${i.recommendedQuantity} unit(s)`);
      }
      if (low.items.length > 0) {
        lines.push(intent === 'SUGGEST' ? 'Check these low-stock products:' : 'Low on stock:');
        for (const i of low.items) lines.push(`- ${i.name}: ${i.stockQuantity} in stock (threshold ${i.threshold})`);
      }
      if (rec.counts.insufficientLowStock > 0) lines.push('Some products do not have enough sales history for a reorder forecast, so check them by hand.');
      return done(lines.length ? lines.join('\n') : intent === 'SUGGEST' ? 'No inventory actions are suggested right now.' : 'Nothing looks at risk of running out right now.');
    }
    case 'EXPLAIN_PRODUCT': {
      const match = await findProductInQuestion(ctx.storeId, question);
      if (!match) return { kind: 'UNSUPPORTED', message: 'I could not find a product with that name or SKU in your store. Mention the exact product name or SKU, for example: "Why does Cola 500ml need reordering?"' };
      const d = await call(ctx, evidence, 'explainReorderRecommendation', { productId: match.id });
      const headline = d.status === 'REORDER' ? `${d.product.name} needs reordering: the suggested order is ${d.recommendedQuantity} unit(s).` : d.status === 'OK' ? `${d.product.name} does not need a reorder right now.` : `${d.product.name}: there is not enough sales history to forecast a reorder.`;
      return done(`${headline}\nCalculation:\n${d.steps.map((s: string) => `- ${s}`).join('\n')}`);
    }
  }
}
