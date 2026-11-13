import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/prisma';
import { resetDb } from '../../test/db';
import { addMember, createProduct, loginAs, registerOwner } from '../../test/helpers';

const app = createApp({ authRateLimitMax: 1000, importRateLimitMax: 1000, aiProvider: null });

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const HEADER = 'sku,name,barcode,category,unit,description,costPrice,sellingPrice,reorderThreshold';
const GOOD = [
  HEADER,
  'COLA-500,Cola 500ml,5449000000996,Drinks,bottle,Soft drink,0.50,1.25,10',
  'CHIPS-1,Chips,,Snacks,pack,,0.40,0.99,',
  'PEN-1,Pen,,,,,0.10,0.50,',
].join('\n');

async function team() {
  const owner = await registerOwner(app, 'a');
  const manager = await addMember(app, owner.cookie, 'MANAGER', 'a');
  const cashier = await addMember(app, owner.cookie, 'CASHIER', 'a');
  return {
    owner,
    managerCookie: await loginAs(app, manager.email),
    cashierCookie: await loginAs(app, cashier.email),
  };
}

const preview = (cookie: string, csv: string, existing?: 'skip' | 'update', target = app) =>
  request(target)
    .post('/api/v1/products/import/preview')
    .set('Cookie', cookie)
    .send({ csv, ...(existing ? { existing } : {}) });

const runImport = (cookie: string, csv: string, existing?: 'skip' | 'update', target = app) =>
  request(target)
    .post('/api/v1/products/import')
    .set('Cookie', cookie)
    .send({ csv, ...(existing ? { existing } : {}) });

const exportCsv = (cookie: string, query = '') =>
  request(app).get(`/api/v1/products/export${query}`).set('Cookie', cookie);

const lines = (text: string) => text.replace(/^\uFEFF/, '').trim().split('\r\n');

describe('product import and export', () => {
  it('previews without writing, imports products and exports a safe catalog', async () => {
    const t = await team();
    const check = await preview(t.managerCookie, GOOD);
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({
      canImport: true,
      summary: { rows: 3, create: 3, update: 0, skip: 0, errors: 0 },
    });
    expect(await prisma.product.count()).toBe(0);

    const imported = await runImport(t.managerCookie, GOOD);
    expect(imported.status).toBe(200);
    expect(imported.body).toEqual({ created: 3, updated: 0, skipped: 0, categoriesCreated: 2 });
    expect(await prisma.stockMovement.count()).toBe(0);

    const product = await prisma.product.findFirstOrThrow({
      where: { sku: 'COLA-500' },
      include: { category: true },
    });
    expect(product).toMatchObject({
      name: 'Cola 500ml',
      barcode: '5449000000996',
      unit: 'bottle',
      description: 'Soft drink',
      reorderThreshold: 10,
      stockQuantity: 0,
      category: { name: 'Drinks' },
    });

    const exported = await exportCsv(t.managerCookie);
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(lines(exported.text)).toHaveLength(4);
    expect(lines(exported.text)[0]).toBe(
      'sku,name,barcode,category,unit,description,costPrice,sellingPrice,stockQuantity,reorderThreshold,status',
    );
  });

  it('skips or updates existing products without changing stock', async () => {
    const t = await team();
    await runImport(t.managerCookie, GOOD);
    const existing = await prisma.product.findFirstOrThrow({ where: { sku: 'COLA-500' } });
    await createProduct(app, t.owner.cookie, {
      name: 'Other',
      sku: 'OTHER-1',
      costPrice: 1,
      sellingPrice: 2,
    });

    const csv = [HEADER, 'COLA-500,Updated,,,,,0.60,1.50,', 'NEW-1,New,,,,,1,2,'].join('\n');
    expect((await preview(t.managerCookie, csv, 'skip')).body.summary).toMatchObject({
      create: 1,
      update: 0,
      skip: 1,
    });
    const updated = await runImport(t.managerCookie, csv, 'update');
    expect(updated.body).toEqual({ created: 1, updated: 1, skipped: 0, categoriesCreated: 0 });

    const result = await prisma.product.findUniqueOrThrow({ where: { id: existing.id } });
    expect(result.name).toBe('Updated');
    expect(result.stockQuantity).toBe(0);
    expect(result.sellingPrice.toFixed(2)).toBe('1.50');
  });

  it('enforces manager access, validation and payload limits', async () => {
    const t = await team();
    expect((await preview(t.cashierCookie, GOOD)).status).toBe(403);
    expect((await request(app).post('/api/v1/products/import').send({ csv: GOOD })).status).toBe(401);

    const invalid = await preview(t.managerCookie, 'sku,name\n"A,B');
    expect(invalid.status).toBe(200);
    expect(invalid.body.canImport).toBe(false);
    expect(invalid.body.issues[0].message).toContain('closing quote');

    const tooBig = await preview(t.managerCookie, 'x'.repeat(750_001));
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.code).toBe('VALIDATION_ERROR');
    const huge = await preview(t.managerCookie, 'x'.repeat(1_200_000));
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
