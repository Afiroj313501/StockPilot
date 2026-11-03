import { z } from 'zod';
import { daysBetween, isValidDate, MAX_DAY_GROUP_DAYS, MAX_RANGE_DAYS, type Group } from './dateRange';

export const EXPORT_KINDS = ['sales', 'products', 'categories', 'inventory', 'low-stock', 'returns', 'purchases'] as const;

const dateString = z.string().refine(isValidDate, 'Use a real date like 2026-11-01');
const base = { from: dateString.optional(), to: dateString.optional() };
const groupSchema = z.enum(['day', 'week', 'month']);

// Both dates or neither (neither means "the last 30 days").
function checkRange(v: { from?: string | undefined; to?: string | undefined; group?: Group | undefined }, ctx: z.RefinementCtx) {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', path: ['from'], message });
  if ((v.from === undefined) !== (v.to === undefined)) return issue('Provide both from and to, or neither');
  if (v.from === undefined || v.to === undefined) return;
  if (v.from > v.to) return issue('From must not be after to');
  const days = daysBetween(v.from, v.to) + 1;
  if (days > MAX_RANGE_DAYS) return issue(`The range can cover at most ${MAX_RANGE_DAYS} days`);
  if (v.group === 'day' && days > MAX_DAY_GROUP_DAYS) {
    issue(`Daily grouping covers at most ${MAX_DAY_GROUP_DAYS} days. Use weeks or months.`);
  }
}

export const summaryQuery = z
  .object({ ...base, group: groupSchema.default('day') })
  .superRefine((v, ctx) => checkRange(v, ctx));

export const productsQuery = z
  .object({
    ...base,
    sort: z.enum(['revenue', 'units', 'profit']).default('revenue'),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  })
  .superRefine((v, ctx) => checkRange(v, ctx));

export const rangeQuery = z.object(base).superRefine((v, ctx) => checkRange(v, ctx));

// The dashboard always shows days.
export const dashboardQuery = z.object(base).superRefine((v, ctx) => checkRange({ ...v, group: 'day' }, ctx));

export const exportQuery = z
  .object({ ...base, group: groupSchema.optional() })
  .superRefine((v, ctx) => checkRange({ from: v.from, to: v.to }, ctx));

export const exportKindParam = z.enum(EXPORT_KINDS);

export type SummaryQuery = z.infer<typeof summaryQuery>;
export type ProductsQuery = z.infer<typeof productsQuery>;
export type RangeQuery = z.infer<typeof rangeQuery>;
export type ExportKind = (typeof EXPORT_KINDS)[number];