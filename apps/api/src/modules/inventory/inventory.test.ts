import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/prisma';
import { resetDb } from '../../test/db';
import { addMember, createProduct, loginAs, registerOwner } from '../../test/helpers';

const app = createApp({ authRateLimitMax: 1000 });
beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

async function setup(tag: string) {
  const owner = await registerOwner(app, tag);
  const manager = await addMember(app, owner.cookie, 'MANAGER', tag);
  const cashier = await addMember(app, owner.cookie, 'CASHIER', tag);
  return {
    owner,
    manager: await loginAs(app, manager.email),
    cashier: await loginAs(app, cashier.email),
    product: await createProduct(app, owner.cookie),
  };
}
function movement(cookie: string, productId: string, overrides: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/v1/inventory/movements')
    .set('Cookie', cookie)
    .send({
      productId,
      type: 'OPENING',
      quantity: 10,
      idempotencyKey: `key-${Date.now()}-${Math.random()}`,
      ...overrides,
    });
}

describe('inventory ledger', () => {
  it('records opening stock', async () => {
    const s = await setup('inventory-opening');
    const res = await movement(s.manager, s.product);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ quantityBefore: 0, quantityAfter: 10, quantityChange: 10 });
  });
  it('blocks cashiers', async () => {
    const s = await setup('inventory-cashier');
    expect((await movement(s.cashier, s.product)).status).toBe(403);
  });
  it('rejects unknown body fields and invalid movement values', async () => {
    const s = await setup('inventory-validation');
    expect((await movement(s.manager, s.product, { storeId: 'x' })).status).toBe(400);
    expect((await movement(s.manager, s.product, { type: 'OPENING', quantity: 0 })).status).toBe(
      400,
    );
    expect((await movement(s.manager, s.product, { type: 'ADJUSTMENT', quantity: 0 })).status).toBe(
      400,
    );
  });
  it('allows opening only once', async () => {
    const s = await setup('inventory-opening-once');
    await movement(s.manager, s.product);
    expect((await movement(s.manager, s.product)).status).toBe(409);
  });
  it('applies positive and negative adjustments', async () => {
    const s = await setup('inventory-adjustment');
    await movement(s.manager, s.product);
    expect(
      (
        await movement(s.manager, s.product, {
          type: 'ADJUSTMENT',
          quantity: 3,
          reason: 'Found stock',
        })
      ).body.quantityAfter,
    ).toBe(13);
    expect(
      (
        await movement(s.manager, s.product, {
          type: 'ADJUSTMENT',
          quantity: -2,
          reason: 'Count correction',
        })
      ).body.quantityAfter,
    ).toBe(11);
  });
  it('requires an adjustment reason', async () => {
    const s = await setup('inventory-adjustment-reason');
    expect((await movement(s.manager, s.product, { type: 'ADJUSTMENT', quantity: 1 })).status).toBe(
      400,
    );
  });
  it('records damaged and lost stock as decrements', async () => {
    const s = await setup('inventory-damaged');
    await movement(s.manager, s.product);
    expect(
      (await movement(s.manager, s.product, { type: 'DAMAGED', quantity: 2 })).body.quantityAfter,
    ).toBe(8);
    expect(
      (await movement(s.manager, s.product, { type: 'LOST', quantity: 1 })).body.quantityAfter,
    ).toBe(7);
  });
  it('rejects insufficient stock', async () => {
    const s = await setup('inventory-insufficient');
    await movement(s.manager, s.product, { quantity: 2 });
    expect((await movement(s.manager, s.product, { type: 'DAMAGED', quantity: 3 })).status).toBe(
      409,
    );
  });
  it('reconciles to a counted quantity', async () => {
    const s = await setup('inventory-reconcile');
    await movement(s.manager, s.product);
    expect(
      (await movement(s.manager, s.product, { type: 'RECONCILIATION', quantity: 4 })).body
        .quantityAfter,
    ).toBe(4);
  });
  it('replays an idempotent request', async () => {
    const s = await setup('inventory-replay');
    const value = { idempotencyKey: 'stable-key-123', quantity: 4 };
    const first = await movement(s.manager, s.product, value);
    const second = await movement(s.manager, s.product, value);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
  });
  it('rejects idempotency key reuse for another movement', async () => {
    const s = await setup('inventory-key-reuse');
    await movement(s.manager, s.product, { idempotencyKey: 'reuse-key-123' });
    expect(
      (
        await movement(s.manager, s.product, {
          idempotencyKey: 'reuse-key-123',
          type: 'ADJUSTMENT',
          quantity: 1,
          reason: 'x',
        })
      ).status,
    ).toBe(409);
  });
  it('lists movements with filters and pagination', async () => {
    const s = await setup('inventory-list');
    await movement(s.manager, s.product);
    await movement(s.manager, s.product, { type: 'ADJUSTMENT', quantity: 1, reason: 'x' });
    const res = await request(app)
      .get('/api/v1/inventory/movements?pageSize=1&page=2')
      .set('Cookie', s.manager);
    expect(res.body).toMatchObject({ total: 2, totalPages: 2 });
    expect(
      (
        await request(app)
          .get('/api/v1/inventory/movements?type=ADJUSTMENT')
          .set('Cookie', s.manager)
      ).body.total,
    ).toBe(1);
  });
  it('lists low stock products', async () => {
    const s = await setup('inventory-low-stock');
    const res = await request(app).get('/api/v1/inventory/low-stock').set('Cookie', s.manager);
    expect(res.body.items[0]).toMatchObject({ id: s.product, stockQuantity: 0 });
  });
  it('checks ledger integrity', async () => {
    const s = await setup('inventory-integrity');
    await movement(s.manager, s.product);
    expect(
      (await request(app).get('/api/v1/inventory/integrity').set('Cookie', s.manager)).body,
    ).toMatchObject({ ok: true, checkedProducts: 1, mismatches: [] });
  });
  it('keeps integrity after multiple movements', async () => {
    const s = await setup('inventory-integrity-multiple');
    await movement(s.manager, s.product);
    await movement(s.manager, s.product, {
      type: 'ADJUSTMENT',
      quantity: -2,
      reason: 'Correction',
    });
    expect(
      (await request(app).get('/api/v1/inventory/integrity').set('Cookie', s.manager)).body.ok,
    ).toBe(true);
  });
  it('isolates stores', async () => {
    const s = await setup('inventory-isolation');
    const other = await registerOwner(app, 'inventory-other');
    expect(
      (await request(app).get('/api/v1/inventory/movements').set('Cookie', other.cookie)).body
        .total,
    ).toBe(0);
    expect((await movement(other.cookie, s.product)).status).toBe(404);
  });
  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/inventory/movements')).status).toBe(401);
    expect((await request(app).post('/api/v1/inventory/movements').send({})).status).toBe(401);
  });
  it('numbers parallel adjustments without losing stock', async () => {
    const s = await setup('inventory-concurrency');
    await movement(s.manager, s.product);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        movement(s.manager, s.product, {
          type: 'ADJUSTMENT',
          quantity: 1,
          reason: `parallel ${i}`,
        }),
      ),
    );
    expect(results.every((result) => result.status === 201)).toBe(true);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: s.product } });
    expect(product.stockQuantity).toBe(15);
  });
});
