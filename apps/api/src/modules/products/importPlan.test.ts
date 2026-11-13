import { describe, expect, it } from 'vitest';
import { MAX_NEW_CATEGORIES, parseImport, type PlanContext } from './importPlan';

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  existingBySku: new Map(),
  barcodeOwners: new Map(),
  categoriesByLowerName: new Map(),
  ...over,
});

describe('parseImport: columns and values', () => {
  it('recognizes common header names, lists ignored columns and cleans values', () => {
    const plan = parseImport(
      "SKU,Product Name,Cost Price,Price,Category,Stock,Colour\ncola-1,Cola,0.50,1.25,Drinks,7,red\npen-1,'=1+1,1,2,,,",
      'skip',
      ctx(),
    );
    expect(plan.columns.recognized).toEqual(['sku', 'name', 'costPrice', 'sellingPrice', 'category']);
    expect(plan.columns.ignored).toEqual([
      { column: 'Stock', reason: expect.stringContaining('not imported') },
      { column: 'Colour', reason: expect.stringContaining('Unknown') },
    ]);
    expect(plan.issues).toEqual([]);
    expect(plan.rows[0]).toMatchObject({
      line: 2,
      sku: 'COLA-1',
      status: 'CREATE',
      name: 'Cola',
      data: { name: 'Cola', costPrice: 0.5, sellingPrice: 1.25, categoryName: 'Drinks' },
    });
    expect(plan.rows[1]!.data.name).toBe('=1+1');
    expect(plan.summary).toEqual({
      rows: 2,
      create: 2,
      update: 0,
      skip: 0,
      errors: 0,
      newCategories: ['Drinks'],
    });
  });

  it('reports every problem with its line and column', () => {
    const plan = parseImport(
      [
        'sku,name,barcode,costPrice,sellingPrice,reorderThreshold',
        'BAD sku!,x,,1,2,',
        'SKU-A,,,1,2,',
        'SKU-B,Name,,abc,2,',
        'SKU-C,Name,,1,2.555,',
        'SKU-D,Name,,-1,2,',
        'SKU-E,Name,,1,,',
        'SKU-F,Name,bad barcode!,1,2,',
        'SKU-G,Name,,1,2,-5',
        'SKU-H,Name,,1,2,1.5',
        'SKU-I,Name,,1,2,1000001',
        'SKU-J,Name,,1,2,5,extra',
      ].join('\n'),
      'skip',
      ctx(),
    );
    expect(plan.issues.map((i) => `${i.line}:${i.column}`)).toEqual([
      '2:sku',
      '3:name',
      '4:costPrice',
      '5:sellingPrice',
      '6:costPrice',
      '7:sellingPrice',
      '8:barcode',
      '9:reorderThreshold',
      '10:reorderThreshold',
      '11:reorderThreshold',
      '12:null',
    ]);
    expect(plan.rows.every((r) => r.status === 'ERROR')).toBe(true);
    expect(plan.summary).toMatchObject({ rows: 11, create: 0, errors: 11 });

    expect(parseImport('name,costPrice\nx,1', 'skip', ctx()).issues).toEqual([
      { line: 1, column: 'sku', message: 'The file needs a "sku" column' },
    ]);
    expect(parseImport('sku,SKU\nA,B', 'skip', ctx()).issues[0]!.message).toContain(
      'Two columns map to "sku"',
    );
    expect(parseImport('sku,name', 'skip', ctx()).issues[0]!.message).toContain('no data rows');
    expect(parseImport('', 'skip', ctx()).issues[0]!.message).toBe('The file is empty');
    expect(parseImport('sku,name\n"A,B', 'skip', ctx()).issues[0]!.message).toContain(
      'closing quote',
    );
  });
});

describe('parseImport: existing products, duplicates and categories', () => {
  const context = ctx({
    existingBySku: new Map([
      ['COLA-1', { id: 'p1', sku: 'COLA-1', barcode: '111' }],
      ['PEN-1', { id: 'p2', sku: 'PEN-1', barcode: '222' }],
    ]),
    barcodeOwners: new Map([
      ['111', 'COLA-1'],
      ['222', 'PEN-1'],
    ]),
    categoriesByLowerName: new Map([['drinks', { id: 'c1', name: 'Drinks' }]]),
  });
  const csv = [
    'sku,name,barcode,category,costPrice,sellingPrice',
    'COLA-1,Cola 2,,drinks,0.6,1.5',
    'NEW-1,New,222,,1,2',
    'NEW-2,New,333,Snacks,1,2',
    'NEW-3,New,333,SNACKS,1,2',
    'new-2,Dup,,,1,2',
    'COLA-1,Again,,,1,2',
  ].join('\n');

  it('skips existing SKUs by default and flags barcode and SKU conflicts', () => {
    const plan = parseImport(csv, 'skip', context);
    expect(plan.rows.map((r) => r.status)).toEqual(['SKIP', 'ERROR', 'CREATE', 'ERROR', 'ERROR', 'ERROR']);
    expect(plan.summary).toEqual({
      rows: 6,
      create: 1,
      update: 0,
      skip: 1,
      errors: 4,
      newCategories: ['Snacks'],
    });
    const messages = plan.issues.map((i) => `${i.line}: ${i.message}`);
    expect(messages).toContain('3: Barcode is already used by SKU PEN-1');
    expect(messages).toContain('5: Barcode also appears on line 4');
    expect(messages).toContain('6: Duplicate SKU: it also appears on line 4');
    expect(messages).toContain('7: Duplicate SKU: it also appears on line 2');
  });

  it('updates existing SKUs in update mode, with only the filled-in columns, and matches categories by name', () => {
    const plan = parseImport(csv, 'update', context);
    expect(plan.rows.map((r) => r.status)).toEqual(['UPDATE', 'ERROR', 'CREATE', 'ERROR', 'ERROR', 'ERROR']);
    expect(plan.summary).toMatchObject({ create: 1, update: 1, skip: 0, errors: 4, newCategories: ['Snacks'] });
    expect(plan.rows[0]).toMatchObject({
      existingId: 'p1',
      data: { name: 'Cola 2', costPrice: 0.6, sellingPrice: 1.5, categoryName: 'drinks' },
    });

    const own = parseImport('sku,name,barcode\nCOLA-1,,111', 'update', context);
    expect(own.issues).toEqual([]);
    expect(own.rows[0]).toMatchObject({ status: 'UPDATE', name: null, data: { barcode: '111' } });
  });

  it('limits the number of new categories per import', () => {
    const rows = Array.from({ length: MAX_NEW_CATEGORIES + 1 }, (_, i) => `C${i},N,,Cat${i},1,2`);
    const plan = parseImport(
      ['sku,name,barcode,category,costPrice,sellingPrice', ...rows].join('\n'),
      'skip',
      ctx(),
    );
    expect(plan.summary.newCategories).toHaveLength(MAX_NEW_CATEGORIES);
    expect(plan.issues).toHaveLength(1);
    expect(plan.issues[0]!.message).toContain('at most 100');
  });
});
