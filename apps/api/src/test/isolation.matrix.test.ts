import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../db/prisma';
import { resetDb } from './db';
import { addMember, createProduct, createSupplier, loginAs, registerOwner } from './helpers';

const app = createApp({ authRateLimitMax: 1000, aiProvider: null });

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

let counter = 0;
const nextKey = () => `iso-key-${Date.now()}-${++counter}`;

function call(method: string, path: string, cookie: string, body?: object) {
  const agent = request(app);
  const req =
    method === 'GET'
      ? agent.get(path)
      : method === 'POST'
        ? agent.post(path)
        : method === 'PATCH'
          ? agent.patch(path)
          : agent.delete(path);
  void req.set('Cookie', cookie);
  return method === 'GET' || method === 'DELETE' ? req : req.send(body ?? {});
}

async function fixture() {
  const a = await registerOwner(app, 'a');
  const manager = await addMember(app, a.cookie, 'MANAGER', 'a');
  const cashier = await addMember(app, a.cookie, 'CASHIER', 'a');
  const managerCookie = await loginAs(app, manager.email);
  const cashierCookie = await loginAs(app, cashier.email);
  const b = await registerOwner(app, 'b');

  const category = (
    await request(app)
      .post('/api/v1/categories')
      .set('Cookie', a.cookie)
      .send({ name: 'Drinks' })
  ).body.id as string;
  const supplier = await createSupplier(app, a.cookie);
  const product = await createProduct(app, a.cookie, {
    name: 'Cola',
    sku: 'COLA-1',
    sellingPrice: 10,
    costPrice: 4,
    categoryId: category,
  });
  await request(app)
    .post('/api/v1/inventory/movements')
    .set('Cookie', a.cookie)
    .send({ productId: product, type: 'OPENING', quantity: 50, idempotencyKey: nextKey() });
  const po = (
    await request(app)
      .post('/api/v1/purchases')
      .set('Cookie', a.cookie)
      .send({ supplierId: supplier, items: [{ productId: product, quantityOrdered: 5, unitCost: 4 }] })
  ).body.id as string;
  const sale = (
    await request(app)
      .post('/api/v1/sales')
      .set('Cookie', cashierCookie)
      .send({
        idempotencyKey: nextKey(),
        items: [{ productId: product, quantity: 2 }],
        payment: { method: 'CASH', amountTendered: 1000 },
      })
  ).body.id as string;
  const ret = (
    await request(app)
      .post('/api/v1/returns')
      .set('Cookie', managerCookie)
      .send({
        saleId: sale,
        idempotencyKey: nextKey(),
        items: [{ productId: product, quantity: 1, restock: true, reason: 'OTHER' }],
      })
  ).body.id as string;

  return { a, b, manager, cashier, managerCookie, category, supplier, product, po, sale, ret };
}

describe('tenant isolation matrix', () => {
  it("another store's owner cannot read or change a record of this store by id", async () => {
    const s = await fixture();
    const before = {
      product: await prisma.product.findUniqueOrThrow({ where: { id: s.product } }),
      po: await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: s.po } }),
      category: await prisma.category.findUniqueOrThrow({ where: { id: s.category } }),
      supplier: await prisma.supplier.findUniqueOrThrow({ where: { id: s.supplier } }),
      role: (await prisma.storeMembership.findFirstOrThrow({ where: { userId: s.manager.userId } })).role,
      movements: await prisma.stockMovement.count(),
      reviews: await prisma.reorderReview.count(),
    };

    const key = () => nextKey();
    const attempts: [string, string, object | undefined, number][] = [
      ['GET', `/products/${s.product}`, undefined, 404],
      ['PATCH', `/products/${s.product}`, { name: 'Hacked' }, 404],
      ['DELETE', `/products/${s.product}`, undefined, 404],
      ['PATCH', `/categories/${s.category}`, { name: 'Hacked' }, 404],
      ['DELETE', `/categories/${s.category}`, undefined, 404],
      ['GET', `/suppliers/${s.supplier}`, undefined, 404],
      ['PATCH', `/suppliers/${s.supplier}`, { name: 'Hacked' }, 404],
      ['GET', `/purchases/${s.po}`, undefined, 404],
      ['PATCH', `/purchases/${s.po}`, { notes: 'Hacked' }, 404],
      ['POST', `/purchases/${s.po}/submit`, undefined, 404],
      ['POST', `/purchases/${s.po}/approve`, undefined, 404],
      ['POST', `/purchases/${s.po}/cancel`, {}, 404],
      ['POST', `/purchases/${s.po}/receive`, { idempotencyKey: key(), items: [{ productId: s.product, quantity: 1 }] }, 404],
      ['GET', `/sales/${s.sale}`, undefined, 404],
      ['GET', `/returns/${s.ret}`, undefined, 404],
      ['GET', `/returns/by-sale/${s.sale}`, undefined, 404],
      ['POST', '/returns/preview', { saleId: s.sale, items: [{ productId: s.product, quantity: 1 }] }, 404],
      ['POST', '/returns', { saleId: s.sale, idempotencyKey: key(), items: [{ productId: s.product, quantity: 1, restock: true, reason: 'OTHER' }] }, 404],
      ['POST', '/inventory/movements', { productId: s.product, type: 'ADJUSTMENT', quantity: 5, reason: 'x', idempotencyKey: key() }, 404],
      ['GET', `/forecasting/products/${s.product}`, undefined, 404],
      ['POST', `/forecasting/products/${s.product}/approve`, { idempotencyKey: key() }, 404],
      ['POST', `/forecasting/products/${s.product}/dismiss`, {}, 404],
      ['POST', `/forecasting/products/${s.product}/review`, {}, 404],
      ['PATCH', `/users/${s.manager.userId}/role`, { role: 'CASHIER' }, 404],
    ];

    const problems: string[] = [];
    for (const [method, path, body, expected] of attempts) {
      const res = await call(method, `/api/v1${path}`, s.b.cookie, body);
      if (res.status !== expected) problems.push(`${method} ${path} -> ${res.status} (expected ${expected})`);
    }
    expect(problems).toEqual([]);

    expect(await prisma.product.findUniqueOrThrow({ where: { id: s.product } })).toEqual(before.product);
    expect(await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: s.po } })).toEqual(before.po);
    expect(await prisma.category.findUniqueOrThrow({ where: { id: s.category } })).toEqual(before.category);
    expect(await prisma.supplier.findUniqueOrThrow({ where: { id: s.supplier } })).toEqual(before.supplier);
    expect((await prisma.storeMembership.findFirstOrThrow({ where: { userId: s.manager.userId } })).role).toBe(before.role);
    expect(await prisma.stockMovement.count()).toBe(before.movements);
    expect(await prisma.reorderReview.count()).toBe(before.reviews);
  });

  it("lists show nothing of another store, and records cannot point at another store's ids", async () => {
    const s = await fixture();
    const ownSupplier = await createSupplier(app, s.b.cookie);
    const ownProduct = await createProduct(app, s.b.cookie, { name: 'Mine', sku: 'MINE-1' });

    for (const path of ['/products', '/categories', '/suppliers', '/purchases', '/sales', '/returns', '/inventory/movements', '/inventory/low-stock']) {
      const res = await request(app).get(`/api/v1${path}`).set('Cookie', s.b.cookie);
      const count = (res.body.total ?? res.body.items?.length) as number;
      expect(count, path).toBe(path === '/products' ? 1 : 0);
    }

    const summary = await request(app).get('/api/v1/reports/summary').set('Cookie', s.b.cookie);
    expect(summary.body.totals).toMatchObject({ salesCount: 0, returnsCount: 0, netSales: '0.00' });
    const inventory = await request(app).get('/api/v1/reports/inventory').set('Cookie', s.b.cookie);
    expect(inventory.body.totals.units).toBe(0);
    const dashboard = await request(app).get('/api/v1/reports/dashboard').set('Cookie', s.b.cookie);
    expect(dashboard.body.recentSales).toEqual([]);
    expect(dashboard.body.topProducts).toEqual([]);
    const byProduct = await request(app).get(`/api/v1/audit-logs?resourceId=${s.product}`).set('Cookie', s.b.cookie);
    expect(byProduct.body.total).toBe(0);
    const byActor = await request(app).get(`/api/v1/audit-logs?actorUserId=${s.a.userId}`).set('Cookie', s.b.cookie);
    expect(byActor.body.total).toBe(0);
    const trail = await request(app).get('/api/v1/audit-logs?pageSize=100').set('Cookie', s.b.cookie);
    expect(trail.body.items.every((e: { actorUserId: string }) => e.actorUserId === s.b.userId)).toBe(true);

    const foreignCategory = await call('POST', '/api/v1/products', s.b.cookie, {
      name: 'X',
      sku: 'X-1',
      costPrice: 1,
      sellingPrice: 2,
      categoryId: s.category,
    });
    expect([foreignCategory.status, foreignCategory.body.error.code]).toEqual([400, 'INVALID_CATEGORY']);
    const foreignSupplier = await call('POST', '/api/v1/purchases', s.b.cookie, {
      supplierId: s.supplier,
      items: [{ productId: ownProduct, quantityOrdered: 1, unitCost: 1 }],
    });
    expect([foreignSupplier.status, foreignSupplier.body.error.code]).toEqual([400, 'INVALID_SUPPLIER']);
    const foreignProduct = await call('POST', '/api/v1/purchases', s.b.cookie, {
      supplierId: ownSupplier,
      items: [{ productId: s.product, quantityOrdered: 1, unitCost: 1 }],
    });
    expect([foreignProduct.status, foreignProduct.body.error.code]).toEqual([400, 'INVALID_PRODUCT']);
    const foreignSale = await call('POST', '/api/v1/sales', s.b.cookie, {
      idempotencyKey: nextKey(),
      items: [{ productId: s.product, quantity: 1 }],
      payment: { method: 'CASH', amountTendered: 100 },
    });
    expect([foreignSale.status, foreignSale.body.error.code]).toEqual([400, 'INVALID_PRODUCT']);

    const forged = await call('GET', '/api/v1/products', s.b.cookie);
    expect(forged.status).toBe(200);
    const forgedHeader = await request(app)
      .get('/api/v1/products')
      .set('Cookie', s.b.cookie)
      .set('X-Store-Id', s.a.storeId);
    expect(forgedHeader.status).toBe(403);
    expect(await prisma.purchaseOrder.count({ where: { storeId: s.b.storeId } })).toBe(0);
    expect(await prisma.sale.count({ where: { storeId: s.b.storeId } })).toBe(0);
  });
});
