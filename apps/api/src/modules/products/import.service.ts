import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../utils/httpError';
import { toDecimal } from '../../utils/money';
import { uniqueViolationOn } from '../../utils/prismaErrors';
import { Raw, toCsv } from '../reports/csv';
import { localToday } from '../reports/dateRange';
import type { ImportInput } from './import.schemas';
import { parseImport, type ImportPlan, type PlanContext } from './importPlan';

type Db = Pick<Prisma.TransactionClient, 'product' | 'category'>;

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  categoriesCreated: number;
}

async function loadContext(db: Db, storeId: string): Promise<PlanContext> {
  const [products, categories] = await Promise.all([
    db.product.findMany({ where: { storeId }, select: { id: true, sku: true, barcode: true } }),
    db.category.findMany({ where: { storeId }, select: { id: true, name: true } }),
  ]);
  return {
    existingBySku: new Map(products.map((p) => [p.sku, p])),
    barcodeOwners: new Map(
      products.filter((p) => p.barcode !== null).map((p) => [p.barcode as string, p.sku]),
    ),
    categoriesByLowerName: new Map(categories.map((c) => [c.name.toLowerCase(), c])),
  };
}

export function toReport(plan: ImportPlan) {
  const ROW_LIMIT = 200;
  const ISSUE_LIMIT = 200;
  return {
    canImport: plan.issues.length === 0 && plan.rows.length > 0,
    summary: plan.summary,
    columns: plan.columns,
    rows: plan.rows.slice(0, ROW_LIMIT).map((r) => ({
      line: r.line,
      sku: r.sku,
      name: r.name,
      status: r.status,
      messages: r.messages,
    })),
    rowsTruncated: plan.rows.length > ROW_LIMIT,
    issues: plan.issues.slice(0, ISSUE_LIMIT),
    issuesTruncated: plan.issues.length > ISSUE_LIMIT,
  };
}
export type ImportReport = ReturnType<typeof toReport>;

export async function previewImport(storeId: string, input: ImportInput): Promise<ImportReport> {
  return toReport(parseImport(input.csv, input.existing, await loadContext(prisma, storeId)));
}

export async function importProducts(
  storeId: string,
  input: ImportInput,
): Promise<{ imported: true; result: ImportResult } | { imported: false; report: ImportReport }> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${storeId}))`;

        const plan = parseImport(input.csv, input.existing, await loadContext(tx, storeId));
        if (plan.issues.length > 0 || plan.rows.length === 0) {
          return { imported: false as const, report: toReport(plan) };
        }

        if (plan.summary.newCategories.length > 0) {
          await tx.category.createMany({
            data: plan.summary.newCategories.map((name) => ({ storeId, name })),
          });
        }
        const categories = await tx.category.findMany({
          where: { storeId },
          select: { id: true, name: true },
        });
        const categoryId = (name: string | undefined): string | null =>
          name
            ? (categories.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id ?? null)
            : null;

        const creates = plan.rows
          .filter((r) => r.status === 'CREATE')
          .map((r): Prisma.ProductCreateManyInput => ({
            storeId,
            sku: r.sku,
            name: r.data.name as string,
            costPrice: toDecimal(r.data.costPrice as number),
            sellingPrice: toDecimal(r.data.sellingPrice as number),
            barcode: r.data.barcode ?? null,
            description: r.data.description ?? null,
            unit: r.data.unit ?? null,
            categoryId: categoryId(r.data.categoryName),
            reorderThreshold: r.data.reorderThreshold ?? null,
          }));
        for (let i = 0; i < creates.length; i += 500) {
          await tx.product.createMany({ data: creates.slice(i, i + 500) });
        }

        for (const row of plan.rows) {
          if (row.status !== 'UPDATE') continue;
          const d = row.data;
          const data: Prisma.ProductUncheckedUpdateInput = {};
          if (d.name !== undefined) data.name = d.name;
          if (d.costPrice !== undefined) data.costPrice = toDecimal(d.costPrice);
          if (d.sellingPrice !== undefined) data.sellingPrice = toDecimal(d.sellingPrice);
          if (d.barcode !== undefined) data.barcode = d.barcode;
          if (d.unit !== undefined) data.unit = d.unit;
          if (d.description !== undefined) data.description = d.description;
          if (d.reorderThreshold !== undefined) data.reorderThreshold = d.reorderThreshold;
          if (d.categoryName !== undefined) data.categoryId = categoryId(d.categoryName);
          await tx.product.update({ where: { id: row.existingId as string, storeId }, data });
        }

        return {
          imported: true as const,
          result: {
            created: plan.summary.create,
            updated: plan.summary.update,
            skipped: plan.summary.skip,
            categoriesCreated: plan.summary.newCategories.length,
          },
        };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  } catch (err) {
    if (uniqueViolationOn(err, 'sku') || uniqueViolationOn(err, 'barcode')) {
      throw new AppError(
        409,
        'IMPORT_CONFLICT',
        'Another change used one of these SKUs or barcodes while importing. Nothing was imported. Check the file again.',
      );
    }
    throw err;
  }
}

const EXPORT_HEADER = [
  'sku',
  'name',
  'barcode',
  'category',
  'unit',
  'description',
  'costPrice',
  'sellingPrice',
  'stockQuantity',
  'reorderThreshold',
  'status',
];

export async function exportProducts(storeId: string, status: 'active' | 'archived' | 'all') {
  const [setting, products] = await Promise.all([
    prisma.storeSetting.findUnique({ where: { storeId }, select: { timeZone: true } }),
    prisma.product.findMany({
      where: { storeId, ...(status === 'all' ? {} : { isActive: status === 'active' }) },
      include: { category: { select: { name: true } } },
      orderBy: [{ sku: 'asc' }],
      take: 50_000,
    }),
  ]);

  const csv = toCsv(
    EXPORT_HEADER,
    products.map((p) => [
      p.sku,
      p.name,
      p.barcode ?? '',
      p.category?.name ?? '',
      p.unit ?? '',
      p.description ?? '',
      new Raw(p.costPrice.toFixed(2)),
      new Raw(p.sellingPrice.toFixed(2)),
      new Raw(String(p.stockQuantity)),
      p.reorderThreshold === null ? '' : new Raw(String(p.reorderThreshold)),
      p.isActive ? 'active' : 'archived',
    ]),
  );
  return { filename: `products-${localToday(setting?.timeZone ?? 'UTC')}.csv`, csv };
}
