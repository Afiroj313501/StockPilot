import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/prisma';
import { resetDb } from '../../test/db';
import { addMember, loginAs, registerOwner } from '../../test/helpers';

const app = createApp({ authRateLimitMax: 1000 });
beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

async function team() {
  const owner = await registerOwner(app, 'catalog');
  const manager = await addMember(app, owner.cookie, 'MANAGER', 'catalog');
  const cashier = await addMember(app, owner.cookie, 'CASHIER', 'catalog');
  return {
    owner,
    managerCookie: await loginAs(app, manager.email),
    cashierCookie: await loginAs(app, cashier.email),
  };
}

function product(cookie: string, overrides: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/v1/products')
    .set('Cookie', cookie)
    .send({
      name: 'Cola 500ml',
      sku: 'COLA-500',
      costPrice: 0.5,
      sellingPrice: 1.25,
      ...overrides,
    });
}

function category(cookie: string, name: string) {
  return request(app).post('/api/v1/categories').set('Cookie', cookie).send({ name });
}

describe('categories', () => {
  it('lets managers create and members read categories', async () => {
    const { managerCookie, cashierCookie } = await team();
    const created = await category(managerCookie, '  Drinks ');
    const list = await request(app).get('/api/v1/categories').set('Cookie', cashierCookie);
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Drinks');
    expect(list.body.items[0]).toMatchObject({ name: 'Drinks', productCount: 0 });
    expect((await category(cashierCookie, 'Snacks')).status).toBe(403);
  });

  it('rejects duplicate names case-insensitively', async () => {
    const { managerCookie } = await team();
    await category(managerCookie, 'Drinks');
    const duplicate = await category(managerCookie, 'drinks');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CATEGORY_EXISTS');
  });

  it('renames and deletes empty categories but blocks categories in use', async () => {
    const { managerCookie } = await team();
    const drinks = await category(managerCookie, 'Drinks');
    const snacks = await category(managerCookie, 'Snacks');
    await product(managerCookie, { categoryId: drinks.body.id });
    expect(
      (
        await request(app)
          .delete(`/api/v1/categories/${drinks.body.id}`)
          .set('Cookie', managerCookie)
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .patch(`/api/v1/categories/${snacks.body.id}`)
          .set('Cookie', managerCookie)
          .send({ name: 'Sweets' })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .delete(`/api/v1/categories/${snacks.body.id}`)
          .set('Cookie', managerCookie)
      ).status,
    ).toBe(204);
  });

  it('isolates categories between stores', async () => {
    const a = await registerOwner(app, 'a');
    const b = await registerOwner(app, 'b');
    const id = (await category(b.cookie, 'Secret')).body.id;
    expect(
      (await request(app).get('/api/v1/categories').set('Cookie', a.cookie)).body.items,
    ).toHaveLength(0);
    expect(
      (
        await request(app)
          .patch(`/api/v1/categories/${id}`)
          .set('Cookie', a.cookie)
          .send({ name: 'Hacked' })
      ).status,
    ).toBe(404);
    expect(
      (await request(app).delete(`/api/v1/categories/${id}`).set('Cookie', a.cookie)).status,
    ).toBe(404);
  });
});

describe('products: validation and money', () => {
  it('normalises SKU and returns decimal money strings', async () => {
    const { owner } = await team();
    const res = await product(owner.cookie, { sku: ' cola-500 ', barcode: '5449000000996' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      sku: 'COLA-500',
      costPrice: '0.50',
      sellingPrice: '1.25',
      stockQuantity: 0,
      isActive: true,
    });
  });

  it('rejects invalid values and mass assignment', async () => {
    const { owner } = await team();
    for (const body of [
      { sellingPrice: -1 },
      { costPrice: 0.001 },
      { sellingPrice: 'abc' },
      { name: '' },
      { sku: 'bad sku!' },
      { reorderThreshold: -1 },
      { stockQuantity: 100 },
      { storeId: owner.storeId },
    ]) {
      expect((await product(owner.cookie, body)).status).toBe(400);
    }
    expect(await prisma.product.count()).toBe(0);
  });

  it('protects duplicate SKUs and barcodes per store', async () => {
    const a = await registerOwner(app, 'a');
    const b = await registerOwner(app, 'b');
    expect((await product(a.cookie)).status).toBe(201);
    expect((await product(a.cookie, { sku: 'cola-500' })).body.error.code).toBe('SKU_TAKEN');
    expect((await product(b.cookie)).status).toBe(201);
    expect((await product(a.cookie, { sku: 'BAR-1', barcode: '111' })).status).toBe(201);
    expect((await product(a.cookie, { sku: 'BAR-2', barcode: '111' })).body.error.code).toBe(
      'BARCODE_TAKEN',
    );
  });

  it('validates category ownership and clears empty text', async () => {
    const a = await registerOwner(app, 'a');
    const b = await registerOwner(app, 'b');
    const foreign = (await category(b.cookie, 'Secret')).body.id;
    expect((await product(a.cookie, { categoryId: foreign })).body.error.code).toBe(
      'INVALID_CATEGORY',
    );
    const created = await product(a.cookie, { barcode: '' });
    expect(created.body.barcode).toBeNull();
  });
});

describe('products: roles', () => {
  it('allows manager writes and hides cost from cashiers', async () => {
    const { managerCookie, cashierCookie } = await team();
    const created = await product(managerCookie);
    expect(created.body.costPrice).toBe('0.50');
    const id = created.body.id;
    expect((await product(cashierCookie, { sku: 'X-1' })).status).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/api/v1/products/${id}`)
          .set('Cookie', cashierCookie)
          .send({ sellingPrice: 99 })
      ).status,
    ).toBe(403);
    const read = await request(app).get(`/api/v1/products/${id}`).set('Cookie', cashierCookie);
    expect(read.body.costPrice).toBeNull();
  });

  it('allows only owners to delete products', async () => {
    const { owner, managerCookie } = await team();
    const id = (await product(managerCookie)).body.id;
    expect(
      (await request(app).delete(`/api/v1/products/${id}`).set('Cookie', managerCookie)).status,
    ).toBe(403);
    expect(
      (await request(app).delete(`/api/v1/products/${id}`).set('Cookie', owner.cookie)).status,
    ).toBe(204);
  });

  it('archives and restores without deleting history', async () => {
    const { owner } = await team();
    const id = (await product(owner.cookie)).body.id;
    await request(app)
      .patch(`/api/v1/products/${id}`)
      .set('Cookie', owner.cookie)
      .send({ isActive: false });
    expect(
      (await request(app).get('/api/v1/products').set('Cookie', owner.cookie)).body.total,
    ).toBe(0);
    expect(
      (await request(app).get('/api/v1/products?status=archived').set('Cookie', owner.cookie)).body
        .total,
    ).toBe(1);
    expect(
      (
        await request(app)
          .patch(`/api/v1/products/${id}`)
          .set('Cookie', owner.cookie)
          .send({ isActive: true })
      ).body.isActive,
    ).toBe(true);
  });
});

describe('products: query and isolation', () => {
  it('searches and filters by category', async () => {
    const { owner } = await team();
    const drinks = (await category(owner.cookie, 'Drinks')).body.id;
    await product(owner.cookie, { categoryId: drinks });
    await product(owner.cookie, {
      name: 'Orange Juice',
      sku: 'JUICE-1',
      barcode: '222',
      categoryId: drinks,
    });
    expect(
      (await request(app).get('/api/v1/products?search=juice-1').set('Cookie', owner.cookie)).body
        .total,
    ).toBe(1);
    expect(
      (await request(app).get(`/api/v1/products?categoryId=${drinks}`).set('Cookie', owner.cookie))
        .body.total,
    ).toBe(2);
  });

  it('sorts and paginates with metadata', async () => {
    const { owner } = await team();
    for (const item of [
      { name: 'B', sku: 'B', sellingPrice: 2 },
      { name: 'A', sku: 'A', sellingPrice: 1 },
      { name: 'C', sku: 'C', sellingPrice: 3 },
    ])
      await product(owner.cookie, item);
    const page = await request(app)
      .get('/api/v1/products?pageSize=2&page=2&sort=sellingPrice&order=desc')
      .set('Cookie', owner.cookie);
    expect(page.body).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
  });

  it('rejects invalid query parameters and cost sorting', async () => {
    const { owner } = await team();
    for (const query of [
      '?pageSize=1000',
      '?page=0',
      '?sort=bogus',
      '?sort=costPrice',
      '?status=nope',
      '?categoryId=abc',
    ]) {
      expect(
        (await request(app).get(`/api/v1/products${query}`).set('Cookie', owner.cookie)).status,
      ).toBe(400);
    }
  });

  it('does not expose or modify another store product', async () => {
    const a = await registerOwner(app, 'a');
    const b = await registerOwner(app, 'b');
    const id = (await product(a.cookie)).body.id;
    expect((await request(app).get(`/api/v1/products/${id}`).set('Cookie', b.cookie)).status).toBe(
      404,
    );
    expect(
      (
        await request(app)
          .patch(`/api/v1/products/${id}`)
          .set('Cookie', b.cookie)
          .send({ sellingPrice: 0.01 })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get('/api/v1/products')
          .set('Cookie', b.cookie)
          .set('X-Store-Id', a.storeId)
      ).status,
    ).toBe(403);
  });

  it('requires authentication and validates product ids', async () => {
    expect((await request(app).get('/api/v1/products')).status).toBe(401);
    expect((await request(app).get('/api/v1/categories')).status).toBe(401);
    const { owner } = await team();
    expect(
      (await request(app).get('/api/v1/products/not-a-uuid').set('Cookie', owner.cookie)).status,
    ).toBe(400);
  });

  it('updates fields and rejects empty updates', async () => {
    const { owner } = await team();
    const id = (await product(owner.cookie)).body.id;
    const updated = await request(app)
      .patch(`/api/v1/products/${id}`)
      .set('Cookie', owner.cookie)
      .send({ sellingPrice: 1.5 });
    expect(updated.body.sellingPrice).toBe('1.50');
    expect(
      (await request(app).patch(`/api/v1/products/${id}`).set('Cookie', owner.cookie).send({}))
        .status,
    ).toBe(400);
  });

  it('returns a product by ID with manager-visible cost', async () => {
    const { managerCookie } = await team();
    const id = (await product(managerCookie)).body.id;
    const response = await request(app).get(`/api/v1/products/${id}`).set('Cookie', managerCookie);
    expect(response.status).toBe(200);
    expect(response.body.costPrice).toBe('0.50');
  });

  it('allows products without barcodes and optional categories', async () => {
    const { owner } = await team();
    const response = await product(owner.cookie, {
      sku: 'NO-BARCODE',
      barcode: '',
      categoryId: null,
    });
    expect(response.status).toBe(201);
    expect(response.body.barcode).toBeNull();
    expect(response.body.categoryId).toBeNull();
  });

  it('rejects malformed category bodies', async () => {
    const { managerCookie } = await team();
    const response = await request(app)
      .post('/api/v1/categories')
      .set('Cookie', managerCookie)
      .send({ name: 'Drinks', storeId: 'forbidden' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
