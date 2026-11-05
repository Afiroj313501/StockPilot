import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/prisma';
import { resetDb } from '../../test/db';
import {
  addMember,
  createProduct,
  createSupplier,
  loginAs,
  registerOwner,
} from '../../test/helpers';
import { addDays } from '../reports/dateRange';

const app = createApp({ authRateLimitMax: 1000 });

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

let counter = 0;
const nextKey = () => `fc-key-${Date.now()}-${++counter}`;
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

async function addStock(cookie: string, productId: string, quantity: number) {
  const res = await request(app)
    .post('/api/v1/inventory/movements')
    .set('Cookie', cookie)
    .send({ productId, type: 'OPENING', quantity, idempotencyKey: nextKey() });
  if (res.status !== 201) throw new Error(`addStock failed: ${res.status}`);
}

// Sells through the API, then moves the sale to a known moment so the history is controlled.
async function sellAt(
  cookie: string,
  productId: string,
  quantity: number,
  at: Date,
): Promise<string> {
  const res = await request(app)
    .post('/api/v1/sales')
    .set('Cookie', cookie)
    .send({
      idempotencyKey: nextKey(),
      items: [{ productId, quantity }],
      payment: { method: 'CASH', amountTendered: 1000 },
    });
  if (res.status !== 201) throw new Error(`sale failed: ${res.status} ${JSON.stringify(res.body)}`);
  await prisma.sale.update({ where: { id: res.body.id }, data: { createdAt: at } });
  return res.body.id as string;
}

// Store in UTC (default) with a supplier whose lead time is 7 days.
//   Alpha: 10 sales of 3 units over the last 28 days, stock 10      -> a clear reorder
//   Bravo: no sales, stock 3                                        -> too little history, low stock
//   Charlie: one sale, stock 497                                    -> too little history, healthy
//   Delta: created today, one sale                                  -> too little history, healthy
// Alpha also has a SUBMITTED order of 10 units, which is where its supplier comes from.
async function fixture() {
  const owner = await registerOwner(app, 'a');
  const manager = await addMember(app, owner.cookie, 'MANAGER', 'a');
  const cashier = await addMember(app, owner.cookie, 'CASHIER', 'a');
  const managerCookie = await loginAs(app, manager.email);
  const cashierCookie = await loginAs(app, cashier.email);

  const supplierId = await createSupplier(app, owner.cookie, { leadTimeDays: 7 });
  const make = (name: string) =>
    createProduct(app, owner.cookie, { name, sellingPrice: 4, costPrice: 2 });
  const A = await make('Alpha');
  const B = await make('Bravo');
  const C = await make('Charlie');
  const D = await make('Delta');
  await addStock(owner.cookie, A, 40);
  await addStock(owner.cookie, B, 3);
  await addStock(owner.cookie, C, 500);
  await addStock(owner.cookie, D, 100);
  await prisma.product.updateMany({
    where: { id: { in: [A, B, C] } },
    data: { createdAt: ago(40) },
  });

  const saleIds: string[] = [];
  for (const days of [2, 5, 8, 11, 14, 17, 20, 23, 26, 28])
    saleIds.push(await sellAt(cashierCookie, A, 3, ago(days)));
  await sellAt(cashierCookie, C, 3, ago(10));
  await sellAt(cashierCookie, D, 2, ago(0));

  const po = await request(app)
    .post('/api/v1/purchases')
    .set('Cookie', owner.cookie)
    .send({ supplierId, items: [{ productId: A, quantityOrdered: 10, unitCost: 2 }] });
  if (po.status !== 201) throw new Error(`purchase failed: ${po.status}`);
  const submit = await request(app)
    .post(`/api/v1/purchases/${po.body.id}/submit`)
    .set('Cookie', managerCookie)
    .send({});
  if (submit.status !== 200) throw new Error(`submit failed: ${submit.status}`);

  return {
    owner,
    managerCookie,
    cashierCookie,
    supplierId,
    A,
    B,
    C,
    D,
    poId: po.body.id as string,
    saleIds,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

const list = (cookie: string, query = '') =>
  request(app).get(`/api/v1/forecasting/recommendations${query}`).set('Cookie', cookie);
const explain = (cookie: string, productId: string, query = '') =>
  request(app).get(`/api/v1/forecasting/products/${productId}${query}`).set('Cookie', cookie);
const act = (
  cookie: string,
  productId: string,
  action: string,
  body: Record<string, unknown> = {},
) =>
  request(app)
    .post(`/api/v1/forecasting/products/${productId}/${action}`)
    .set('Cookie', cookie)
    .send(body);
const approve = (cookie: string, productId: string, body: Record<string, unknown> = {}) =>
  act(cookie, productId, 'approve', { idempotencyKey: nextKey(), ...body });

const ids = (res: request.Response): string[] =>
  res.body.items.map((i: { productId: string }) => i.productId);

describe('recommendations', () => {
  it('calculates the reorder and explains every step', async () => {
    const s = await fixture();
    const res = await list(s.managerCookie);
    expect(res.status).toBe(200);
    expect(res.body.params).toEqual({ windowDays: 30, safetyDays: 3, coverageDays: 14 });
    expect(res.body.counts).toEqual({
      evaluated: 4,
      reorder: 1,
      insufficientLowStock: 1,
      handled: 0,
    });
    expect(ids(res)).toEqual([s.A, s.B]); // Charlie and Delta need nothing

    const a = res.body.items[0];
    expect(a).toMatchObject({
      status: 'REORDER',
      confidence: 'HIGH',
      urgency: 'HIGH',
      currentStock: 10,
      incomingStock: 0,
      pendingOrderQuantity: 10, // the submitted order is shown but not counted
      position: 10,
      leadTimeDays: 7,
      leadTimeSource: 'SUPPLIER',
      averageDailyDemand: '1.00',
      leadTimeDemand: 7,
      safetyStock: 3,
      coverageStock: 14,
      reorderPoint: 10,
      orderUpToLevel: 24,
      daysOfCover: '10.0',
      recommendedQuantity: 14,
      unitCost: '2.00',
      estimatedCost: '28.00',
      reviewState: null,
    });
    expect(a.supplier).toMatchObject({ id: s.supplierId, isActive: true });
    expect(a.inputs).toMatchObject({
      observedDays: 30,
      unitsSold: 30,
      unitsReturned: 0,
      eligibleUnits: 30,
      transactions: 10,
    });
    expect(a.steps.join(' ')).toContain('order 24 - 10 = 14');

    expect(res.body.items[1]).toMatchObject({
      productId: s.B,
      status: 'INSUFFICIENT_DATA',
      confidence: 'INSUFFICIENT',
      urgency: 'NONE',
      lowStock: true,
      currentStock: 3,
      recommendedQuantity: null,
      estimatedCost: null,
    });
  });

  it('follows the parameters, is reproducible, and rejects invalid ones', async () => {
    const s = await fixture();
    const first = await list(s.managerCookie);
    const again = await list(s.managerCookie);
    expect(again.body).toEqual(first.body);

    // No safety stock and no coverage: reorder point 7, and a position of 10 is above it.
    const lean = await list(s.managerCookie, '?windowDays=30&safetyDays=0&coverageDays=0');
    expect(lean.body.counts).toMatchObject({ reorder: 0, insufficientLowStock: 1 });
    expect(ids(lean)).toEqual([s.B]);

    for (const query of [
      '?windowDays=3',
      '?windowDays=181',
      '?safetyDays=-1',
      '?coverageDays=999',
      '?windowDays=abc',
      '?includeHandled=maybe',
    ]) {
      const res = await list(s.managerCookie, query);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('counts approved incoming stock and subtracts returns from demand', async () => {
    const s = await fixture();
    const before = await explain(s.managerCookie, s.A);
    expect(before.body.item).toMatchObject({
      incomingStock: 0,
      pendingOrderQuantity: 10,
      status: 'REORDER',
    });

    await request(app)
      .post(`/api/v1/purchases/${s.poId}/approve`)
      .set('Cookie', s.owner.cookie)
      .send({});
    const after = await explain(s.managerCookie, s.A);
    expect(after.body.item).toMatchObject({
      incomingStock: 10,
      pendingOrderQuantity: 0,
      position: 20,
      status: 'OK',
      urgency: 'NONE',
      recommendedQuantity: 0,
    });
    expect(ids(await list(s.managerCookie))).toEqual([s.B]);

    const ret = await request(app)
      .post('/api/v1/returns')
      .set('Cookie', s.managerCookie)
      .send({
        saleId: s.saleIds[0],
        idempotencyKey: nextKey(),
        items: [{ productId: s.A, quantity: 3, restock: true, reason: 'CHANGED_MIND' }],
      });
    expect(ret.status).toBe(201);
    const returned = await explain(s.managerCookie, s.A);
    expect(returned.body.item).toMatchObject({ currentStock: 13 });
    expect(returned.body.item.inputs).toMatchObject({
      unitsSold: 30,
      unitsReturned: 3,
      eligibleUnits: 27,
    });
  });

  it('uses only the days a product has existed, and refuses to forecast a brand-new product', async () => {
    const s = await fixture();
    const delta = await explain(s.managerCookie, s.D);
    expect(delta.body.item).toMatchObject({
      status: 'INSUFFICIENT_DATA',
      confidence: 'INSUFFICIENT',
      lowStock: false,
    });
    expect(delta.body.item.inputs.observedDays).toBe(1);

    // Alpha is 40 days old (41 calendar days including today), inside a 60-day window.
    const wide = await explain(s.managerCookie, s.A, '?windowDays=60');
    expect(wide.body.item.inputs).toMatchObject({ observedDays: 41, eligibleUnits: 30 });
    expect(wide.body.item.averageDailyDemand).toBe('0.73'); // 30 / 41
    expect(wide.body.item.inputs.windowStart).toBe(addDays(wide.body.today, -59));
  });
});

describe('approving a recommendation', () => {
  it('creates a draft purchase order, keeps the evidence, and changes no stock', async () => {
    const s = await fixture();
    const before = await list(s.managerCookie);
    const movementsBefore = await prisma.stockMovement.count();

    const res = await approve(s.managerCookie, s.A);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'DRAFT',
      supplierId: s.supplierId,
      expectedDate: addDays(before.body.today, 7),
      createdByName: 'MANAGER a',
    });
    expect(res.body.notes).toContain('reorder planner');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      productId: s.A,
      quantityOrdered: 14,
      unitCost: '2.00',
    });

    const review = await prisma.reorderReview.findFirstOrThrow({ where: { productId: s.A } });
    expect(review).toMatchObject({
      status: 'ORDERED',
      recommendedQuantity: 14,
      orderedQuantity: 14,
      purchaseOrderId: res.body.id,
    });
    expect(
      (review.snapshot as { recommendedQuantity: number; steps: string[] }).recommendedQuantity,
    ).toBe(14);
    expect((review.snapshot as { steps: string[] }).steps.length).toBeGreaterThan(5);

    expect((await prisma.product.findUniqueOrThrow({ where: { id: s.A } })).stockQuantity).toBe(10);
    expect(await prisma.stockMovement.count()).toBe(movementsBefore);

    const after = await list(s.managerCookie);
    expect(ids(after)).toEqual([s.B]);
    expect(after.body.counts.handled).toBe(1);
    const handled = await list(s.managerCookie, '?includeHandled=true');
    const a = handled.body.items.find((i: { productId: string }) => i.productId === s.A);
    expect(a.reviewState).toMatchObject({ status: 'ORDERED', purchaseOrderId: res.body.id });
  });

  it('applies a repeated approval once and blocks a second planner order for the same product', async () => {
    const s = await fixture();
    const body = { idempotencyKey: 'plan-approve-0001' };

    const first = await approve(s.managerCookie, s.A, body);
    const second = await approve(s.managerCookie, s.A, body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.purchaseOrder.count()).toBe(2); // the fixture order and one planner draft

    const another = await approve(s.managerCookie, s.A);
    expect(another.status).toBe(409);
    expect(another.body.error.code).toBe('ALREADY_ORDERED');
    expect(await prisma.purchaseOrder.count()).toBe(2);

    const otherPerson = await approve(s.owner.cookie, s.A, body);
    expect(otherPerson.status).toBe(409);
    expect(otherPerson.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('applies parallel approvals with the same key exactly once', async () => {
    const s = await fixture();
    const body = { idempotencyKey: 'plan-parallel-01' };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => approve(s.managerCookie, s.A, body)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(await prisma.purchaseOrder.count()).toBe(2);
    expect(await prisma.reorderReview.count({ where: { status: 'ORDERED' } })).toBe(1);
  });

  it('creates only one draft when different approvals arrive in parallel', async () => {
    const s = await fixture();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => approve(s.managerCookie, s.A)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const blocked = results.filter((r) => r.status === 409);
    expect(blocked).toHaveLength(4);
    expect(blocked.every((r) => r.body.error.code === 'ALREADY_ORDERED')).toBe(true);
    expect(await prisma.purchaseOrder.count()).toBe(2);
  });

  it('validates the request, needs a supplier, and rolls back completely on failure', async () => {
    const s = await fixture();

    // Nothing to order for products that are healthy or have too little history.
    for (const product of [s.B, s.C, s.D]) {
      const res = await approve(s.managerCookie, product);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NOTHING_TO_ORDER');
    }

    const bad: Record<string, unknown>[] = [
      { quantity: 0 },
      { quantity: 1.5 },
      { quantity: 1_000_001 },
      { supplierId: 'nope' },
      { note: 'x'.repeat(301) },
      { storeId: s.owner.storeId },
      { status: 'APPROVED' },
      { recommendedQuantity: 999 },
      { idempotencyKey: 'abc' },
      { params: { windowDays: 3, safetyDays: 3, coverageDays: 14 } },
    ];
    for (const body of bad) {
      const res = await approve(s.managerCookie, s.A, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const noKey = await act(s.managerCookie, s.A, 'approve', {});
    expect(noKey.status).toBe(400);
    expect(await prisma.purchaseOrder.count()).toBe(1);

    // Without order history there is no supplier to take.
    await request(app)
      .post(`/api/v1/purchases/${s.poId}/cancel`)
      .set('Cookie', s.owner.cookie)
      .send({});
    const noSupplier = await approve(s.managerCookie, s.A);
    expect(noSupplier.status).toBe(400);
    expect(noSupplier.body.error.code).toBe('SUPPLIER_REQUIRED');

    // An archived supplier is refused and nothing is left behind (not even an order number).
    await request(app)
      .patch(`/api/v1/suppliers/${s.supplierId}`)
      .set('Cookie', s.owner.cookie)
      .send({ isActive: false });
    const archived = await approve(s.managerCookie, s.A, { supplierId: s.supplierId });
    expect(archived.status).toBe(409);
    expect(archived.body.error.code).toBe('SUPPLIER_ARCHIVED');
    expect(
      (await prisma.store.findUniqueOrThrow({ where: { id: s.owner.storeId } })).nextPurchaseNumber,
    ).toBe(2);
    expect(await prisma.reorderReview.count()).toBe(0);
    await request(app)
      .patch(`/api/v1/suppliers/${s.supplierId}`)
      .set('Cookie', s.owner.cookie)
      .send({ isActive: true });

    // With a supplier chosen and a quantity changed by the manager, it works.
    const ok = await approve(s.managerCookie, s.A, { supplierId: s.supplierId, quantity: 20 });
    expect(ok.status).toBe(201);
    expect(ok.body.items[0]).toMatchObject({ quantityOrdered: 20 });
    expect(await prisma.reorderReview.count({ where: { status: 'ORDERED' } })).toBe(1);
    expect((await prisma.reorderReview.findFirstOrThrow()).recommendedQuantity).toBe(14);
  });
});

describe('dismissing and reviewing', () => {
  it('hides a product for a week, then shows it again, and a cancelled planner order brings it back', async () => {
    const s = await fixture();

    const dismissed = await act(s.managerCookie, s.A, 'dismiss', { note: 'Supplier is closed' });
    expect(dismissed.status).toBe(201);
    expect(dismissed.body).toMatchObject({ status: 'DISMISSED', hiddenForDays: 7 });
    const hidden = await list(s.managerCookie);
    expect(ids(hidden)).toEqual([s.B]);
    expect(hidden.body.counts.handled).toBe(1);
    const shown = await list(s.managerCookie, '?includeHandled=true');
    expect(
      shown.body.items.find((i: { productId: string }) => i.productId === s.A).reviewState.status,
    ).toBe('DISMISSED');

    await prisma.reorderReview.updateMany({ data: { createdAt: ago(8) } });
    expect(ids(await list(s.managerCookie))).toEqual([s.A, s.B]);

    const reviewed = await act(s.managerCookie, s.A, 'review');
    expect(reviewed.body.status).toBe('REVIEWED');
    expect(ids(await list(s.managerCookie))).toEqual([s.B]);
    const saved = await prisma.reorderReview.findFirstOrThrow({ where: { status: 'REVIEWED' } });
    expect((saved.snapshot as { recommendedQuantity: number }).recommendedQuantity).toBe(14);

    await prisma.reorderReview.deleteMany();
    const order = await approve(s.managerCookie, s.A);
    expect(order.status).toBe(201);
    expect(ids(await list(s.managerCookie))).toEqual([s.B]);
    await request(app)
      .post(`/api/v1/purchases/${order.body.id}/cancel`)
      .set('Cookie', s.owner.cookie)
      .send({});
    expect(ids(await list(s.managerCookie))).toEqual([s.A, s.B]); // the cancelled order no longer hides it
  });
});

describe('access and isolation', () => {
  it('lets managers and owners use the planner and blocks cashiers everywhere', async () => {
    const s = await fixture();
    const blocked = [
      await list(s.cashierCookie),
      await explain(s.cashierCookie, s.A),
      await approve(s.cashierCookie, s.A),
      await act(s.cashierCookie, s.A, 'dismiss'),
      await act(s.cashierCookie, s.A, 'review'),
    ];
    for (const res of blocked) expect(res.status).toBe(403);
    expect(await prisma.purchaseOrder.count()).toBe(1);
    expect(await prisma.reorderReview.count()).toBe(0);

    expect((await list(s.managerCookie)).status).toBe(200);
    expect((await list(s.owner.cookie)).status).toBe(200);
    expect((await explain(s.owner.cookie, s.A)).status).toBe(200);
    expect((await act(s.managerCookie, s.A, 'review')).status).toBe(201);
  });

  it("never reads or changes another store's products", async () => {
    const s = await fixture();
    const b = await registerOwner(app, 'b');

    const mine = await list(b.cookie);
    expect(mine.body.items).toEqual([]);
    expect(mine.body.counts.evaluated).toBe(0);

    const attempts = [
      await explain(b.cookie, s.A),
      await approve(b.cookie, s.A),
      await act(b.cookie, s.A, 'dismiss'),
      await act(b.cookie, s.A, 'review'),
    ];
    for (const res of attempts) expect(res.status).toBe(404);

    const forged = await request(app)
      .get('/api/v1/forecasting/recommendations')
      .set('Cookie', b.cookie)
      .set('X-Store-Id', s.owner.storeId);
    expect(forged.status).toBe(403);
    expect(await prisma.purchaseOrder.count()).toBe(1);
    expect(await prisma.reorderReview.count()).toBe(0);
  });

  it('validates decision bodies and product ids', async () => {
    const s = await fixture();
    for (const action of ['dismiss', 'review']) {
      for (const body of [
        { storeId: s.owner.storeId },
        { status: 'ORDERED' },
        { note: 'x'.repeat(301) },
        { params: { windowDays: 3, safetyDays: 3, coverageDays: 14 } },
      ]) {
        const res = await act(s.managerCookie, s.A, action, body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    }
    expect((await explain(s.managerCookie, 'not-a-uuid')).status).toBe(400);
    expect((await approve(s.managerCookie, 'not-a-uuid')).status).toBe(400);
    expect(await prisma.reorderReview.count()).toBe(0);
  });

  it('requires authentication', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await request(app).get('/api/v1/forecasting/recommendations')).status).toBe(401);
    expect((await request(app).get(`/api/v1/forecasting/products/${missing}`)).status).toBe(401);
    expect(
      (await request(app).post(`/api/v1/forecasting/products/${missing}/approve`).send({})).status,
    ).toBe(401);
    expect(
      (await request(app).post(`/api/v1/forecasting/products/${missing}/dismiss`).send({})).status,
    ).toBe(401);
  });
});
