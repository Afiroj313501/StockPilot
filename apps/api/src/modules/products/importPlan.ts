import { CsvError, parseCsv } from './csvParse';

export const MAX_CSV_CHARS = 750_000;
export const MAX_NEW_CATEGORIES = 100;

export type ExistingMode = 'skip' | 'update';

export interface ExistingProduct {
  id: string;
  sku: string;
  barcode: string | null;
}

export interface PlanContext {
  existingBySku: Map<string, ExistingProduct>;
  barcodeOwners: Map<string, string>;
  categoriesByLowerName: Map<string, { id: string; name: string }>;
}

type Field =
  | 'sku'
  | 'name'
  | 'costPrice'
  | 'sellingPrice'
  | 'barcode'
  | 'category'
  | 'unit'
  | 'description'
  | 'reorderThreshold';

const ALIASES: Record<Field, string[]> = {
  sku: ['sku', 'productcode', 'itemcode', 'code'],
  name: ['name', 'productname', 'itemname', 'title', 'item'],
  costPrice: ['costprice', 'cost', 'purchaseprice', 'buyingprice'],
  sellingPrice: ['sellingprice', 'price', 'saleprice', 'retailprice', 'unitprice'],
  barcode: ['barcode', 'ean', 'upc', 'gtin'],
  category: ['category', 'categoryname', 'group'],
  unit: ['unit', 'uom', 'unitofmeasure'],
  description: ['description', 'details', 'notes'],
  reorderThreshold: [
    'reorderthreshold',
    'lowstockthreshold',
    'reorderlevel',
    'minstock',
    'threshold',
  ],
};

const FIELD_BY_HEADER = new Map<string, Field>();
for (const [field, names] of Object.entries(ALIASES) as [Field, string[]][]) {
  for (const n of names) FIELD_BY_HEADER.set(n, field);
}

const STOCK_REASON = 'Stock is not imported: use Adjust stock so every change is recorded';
const STATUS_REASON = 'Not imported (archive or restore products on the Products page)';
const INFORMATIONAL: Record<string, string> = {
  stock: STOCK_REASON,
  stockquantity: STOCK_REASON,
  quantity: STOCK_REASON,
  qty: STOCK_REASON,
  onhand: STOCK_REASON,
  status: STATUS_REASON,
  isactive: STATUS_REASON,
  id: 'Not imported',
};

const SKU = /^[A-Z0-9][A-Z0-9._/-]*$/;
const BARCODE = /^[A-Za-z0-9._-]+$/;
const PRICE = /^\d{1,9}(\.\d{1,2})?$/;

const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
const unneutralize = (s: string) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

export interface RowData {
  name?: string;
  costPrice?: number;
  sellingPrice?: number;
  barcode?: string;
  categoryName?: string;
  unit?: string;
  description?: string;
  reorderThreshold?: number;
}

export interface PlannedRow {
  line: number;
  sku: string;
  status: 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR';
  name: string | null;
  existingId: string | null;
  data: RowData;
  messages: string[];
}

export interface RowIssue {
  line: number;
  column: string | null;
  message: string;
}

export interface ImportPlan {
  columns: { recognized: string[]; ignored: { column: string; reason: string }[] };
  rows: PlannedRow[];
  issues: RowIssue[];
  summary: {
    rows: number;
    create: number;
    update: number;
    skip: number;
    errors: number;
    newCategories: string[];
  };
}

export function parseImport(csv: string, mode: ExistingMode, ctx: PlanContext): ImportPlan {
  const plan: ImportPlan = {
    columns: { recognized: [], ignored: [] },
    rows: [],
    issues: [],
    summary: { rows: 0, create: 0, update: 0, skip: 0, errors: 0, newCategories: [] },
  };
  const issue = (line: number, column: string | null, message: string) => {
    plan.issues.push({ line, column, message });
  };
  const finish = (newCategories: string[] = []): ImportPlan => {
    const count = (s: PlannedRow['status']) => plan.rows.filter((r) => r.status === s).length;
    plan.summary = {
      rows: plan.rows.length,
      create: count('CREATE'),
      update: count('UPDATE'),
      skip: count('SKIP'),
      errors: plan.issues.length,
      newCategories,
    };
    return plan;
  };

  let parsed: ReturnType<typeof parseCsv>;
  try {
    parsed = parseCsv(csv);
  } catch (err) {
    if (err instanceof CsvError) {
      issue(err.line, null, err.message);
      return finish();
    }
    throw err;
  }
  if (parsed.rows.length === 0) {
    issue(1, null, 'The file is empty');
    return finish();
  }

  const header = parsed.rows[0]!;
  const column = new Map<Field, number>();
  header.forEach((raw, index) => {
    const key = normalizeHeader(raw);
    const field = FIELD_BY_HEADER.get(key);
    if (field) {
      if (column.has(field)) {
        issue(1, raw.trim(), `Two columns map to "${field}"`);
      } else {
        column.set(field, index);
        plan.columns.recognized.push(field);
      }
    } else {
      plan.columns.ignored.push({
        column: raw.trim() || `(column ${index + 1})`,
        reason: INFORMATIONAL[key] ?? 'Unknown column, ignored',
      });
    }
  });
  if (!column.has('sku')) issue(1, 'sku', 'The file needs a "sku" column');
  if (plan.issues.length > 0) return finish();
  if (parsed.rows.length === 1) {
    issue(1, null, 'The file has a header but no data rows');
    return finish();
  }

  const seenSku = new Map<string, number>();
  const seenBarcode = new Map<string, number>();
  const newCategories = new Map<string, string>();

  for (let i = 1; i < parsed.rows.length; i++) {
    const cells = parsed.rows[i]!;
    const line = parsed.lines[i]!;
    const messages: string[] = [];
    const err = (col: string | null, message: string) => {
      messages.push(message);
      issue(line, col, message);
    };
    const get = (f: Field): string => {
      const index = column.get(f);
      return index === undefined ? '' : (cells[index] ?? '').trim();
    };

    if (cells.length > header.length) {
      err(null, `The row has ${cells.length} values but the header has ${header.length} columns`);
    }

    const sku = get('sku').toUpperCase();
    let skuValid = false;
    if (sku === '') err('sku', 'SKU is required');
    else if (sku.length > 64 || !SKU.test(sku)) {
      err('sku', 'Use letters, numbers, dots, dashes, underscores or slashes (up to 64)');
    } else {
      skuValid = true;
    }
    let duplicate = false;
    if (skuValid) {
      const first = seenSku.get(sku);
      if (first !== undefined) {
        duplicate = true;
        err('sku', `Duplicate SKU: it also appears on line ${first}`);
      } else {
        seenSku.set(sku, line);
      }
    }

    const existing = skuValid && !duplicate ? ctx.existingBySku.get(sku) : undefined;
    if (messages.length === 0 && existing && mode === 'skip') {
      plan.rows.push({
        line,
        sku,
        status: 'SKIP',
        name: null,
        existingId: existing.id,
        data: {},
        messages: ['Already exists: skipped'],
      });
      continue;
    }
    const isCreate = !existing;
    const data: RowData = {};

    const name = unneutralize(get('name'));
    if (name === '') {
      if (isCreate) err('name', 'Name is required for a new product');
    } else if (name.length > 200) err('name', 'Use at most 200 characters');
    else data.name = name;

    for (const col of ['costPrice', 'sellingPrice'] as const) {
      const v = get(col);
      if (v === '') {
        if (isCreate) err(col, `${col} is required for a new product`);
      } else if (!PRICE.test(v)) {
        err(col, `${col} must be an amount like 12.50 (at most 2 decimals, no currency symbol)`);
      } else {
        data[col] = Number(v);
      }
    }

    const barcode = get('barcode');
    if (barcode !== '') {
      if (barcode.length > 64 || !BARCODE.test(barcode)) {
        err('barcode', 'Use letters, numbers, dots, dashes or underscores (up to 64)');
      } else {
        const owner = ctx.barcodeOwners.get(barcode);
        const earlier = seenBarcode.get(barcode);
        if (owner !== undefined && owner !== sku)
          err('barcode', `Barcode is already used by SKU ${owner}`);
        else if (earlier !== undefined) err('barcode', `Barcode also appears on line ${earlier}`);
        else {
          data.barcode = barcode;
          seenBarcode.set(barcode, line);
        }
      }
    }

    const category = unneutralize(get('category'));
    if (category !== '') {
      if (category.length > 100) err('category', 'Use at most 100 characters');
      else data.categoryName = category;
    }
    const unit = unneutralize(get('unit'));
    if (unit !== '') {
      if (unit.length > 20) err('unit', 'Use at most 20 characters');
      else data.unit = unit;
    }
    const description = unneutralize(get('description'));
    if (description !== '') {
      if (description.length > 1000) err('description', 'Use at most 1000 characters');
      else data.description = description;
    }
    const threshold = get('reorderThreshold');
    if (threshold !== '') {
      if (!/^\d{1,7}$/.test(threshold) || Number(threshold) > 1_000_000) {
        err('reorderThreshold', 'Use a whole number from 0 to 1000000');
      } else {
        data.reorderThreshold = Number(threshold);
      }
    }

    if (messages.length === 0 && data.categoryName) {
      const lower = data.categoryName.toLowerCase();
      if (!ctx.categoriesByLowerName.has(lower) && !newCategories.has(lower)) {
        if (newCategories.size >= MAX_NEW_CATEGORIES) {
          err(
            'category',
            `Too many new categories: at most ${MAX_NEW_CATEGORIES} can be created per import`,
          );
        } else {
          newCategories.set(lower, data.categoryName);
        }
      }
    }

    plan.rows.push({
      line,
      sku,
      status: messages.length > 0 ? 'ERROR' : existing ? 'UPDATE' : 'CREATE',
      name: data.name ?? null,
      existingId: existing?.id ?? null,
      data,
      messages,
    });
  }

  return finish([...newCategories.values()]);
}
