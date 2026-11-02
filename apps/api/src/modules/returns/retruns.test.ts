import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/prisma';
import { resetDb } from '../../test/db';
import { addMember, createProduct, loginAs, registerOwner } from '../../test/helpers';

const app = createApp({ authRateLimitMax: 1000 });

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

let counter = 0;
const nextKey = () => `ret-key-${Date.now()}-${++counter}`;
const cents = (value: string) => Math.round(Number(value) * 100);

const patchSettings = (cookie: string, body: Record<string, unknown>) =>
  request(app).patch('/api/v1/settings').set('Cookie', cookie).send(body);

async function addStock(cookie: string, productId: string, quantity: number) {
  const res = await request(app)
    .post('/api/v1/inventory/movements')
    .set('Cookie', cookie)
    .send({ productId, type: 'OPENING', quantity, idempotencyKey: nextKey() });
  if (res.status !== 201) throw new Error(`addStock failed: ${res.status}`);
}

// A store with 10% exclusive VAT, an owner, manager and cashier, and two stocked products.
async function setup() {
  const owner = await registerOwner(app, 'a');
  const manager = await addMember(app, owner.cookie, 'MANAGER', 'a');
  const cashier = await addMember(app, owner.cookie, 'CASHIER', 'a');
  const p1 = await createProduct(app, owner.cookie, { sellingPrice: 2, costPrice: 1 });
  const p2 = await createProduct(app, owner.cookie, { sellingPrice: 4, costPrice: 2 });
  await addStock(owner.cookie, p1, 100);
  await addStock(owner.cookie, p2, 100);
  const set = await patchSettings(owner.cookie, { taxName: 'VAT', taxRatePercent: 10 });
  if (set.status !== 200) throw new Error(`settings failed: ${set.status}`);
  return {
    owner,
    managerCookie: await loginAs(app, manager.email),
    cashierCookie: await loginAs(app, cashier.email),
    p1,
    p2,
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function sale(
  cookie: string,
  items: { productId: string; quantity: number }[],
  extra: Record<string, unknown> = {},
) {
  const res = await request(app)
    .post('/api/v1/sales')
    .set('Cookie', cookie)
    .send({
      idempotencyKey: nextKey(),
      items,
      payment: { method: 'CASH', amountTendered: 1000 },
      ...extra,
    });
  if (res.status !== 201) throw new Error(`sale failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; total: string };
}

const line = (productId: string, quantity: number, extra: Record<string, unknown> = {}) => ({
  productId,
  quantity,
  restock: true,
  reason: 'CHANGED_MIND',
  ...extra,
});

const giveBack = (
  cookie: string,
  saleId: string,
  items: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) =>
  request(app)
    .post('/api/v1/returns')
    .set('Cookie', cookie)
    .send({ saleId, idempotencyKey: nextKey(), items, ...extra });

async function stockOf(productId: string): Promise<number> {
  return (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQuantity;
}
const returnCount = () => prisma.saleReturn.count();
const returnMovements = (productId?: string) =>
  prisma.stockMovement.count({ where: { type: 'RETURN', ...(productId ? { productId } : {}) } });
const byProduct = (items: { productId: string }[], id: string) =>
  items.find((i) => i.productId === id);

describe('returning a sale', () => {
  it('refunds from the sale figures, restocks through the ledger and reconciles', async () => {
    const s = await setup();
    const made = await sale(s.cashierCookie, [
      { productId: s.p1, quantity: 2 },
      { productId: s.p2, quantity: 1 },
    ]); // total 8.80

    // Later price and tax changes must not affect a return of an earlier sale.
    await patchSettings(s.owner.cookie, { taxRatePercent: 50 });
    await request(app)
      .patch(`/api/v1/products/${s.p1}`)
      .set('Cookie', s.owner.cookie)
      .send({ sellingPrice: 99 });

    const res = await giveBack(s.managerCookie, made.id, [line(s.p1, 2), line(s.p2, 1)], {
      note: 'Customer came back',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      reference: 'R-000001',
      saleReference: 'S-000001',
      refundMethod: 'CASH',
      refundTotal: '8.80',
      taxRefundTotal: '0.80',
      processedByName: 'MANAGER a',
      note: 'Customer came back',
    });
    expect(byProduct(res.body.items, s.p1)).toMatchObject({
      quantity: 2,
      refundAmount: '4.40',
      taxRefund: '0.40',
      restock: true,
    });

    expect(await stockOf(s.p1)).toBe(100);
    expect(await stockOf(s.p2)).toBe(100);
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { productId: s.p1, type: 'RETURN' },
    });
    expect(movement).toMatchObject({
      quantityChange: 2,
      quantityBefore: 98,
      quantityAfter: 100,
      referenceType: 'RETURN',
      referenceId: res.body.id,
    });

    const status = await request(app)
      .get(`/api/v1/returns/by-sale/${made.id}`)
      .set('Cookie', s.managerCookie);
    expect(status.body.returnStatus).toBe('FULL');
    expect(
      status.body.lines.every((l: { quantityReturnable: number }) => l.quantityReturnable === 0),
    ).toBe(true);

    const integrity = await request(app)
      .get('/api/v1/inventory/integrity')
      .set('Cookie', s.owner.cookie);
    expect(integrity.body.ok).toBe(true);
  });

  it('adds partial refunds up to exactly the line total and refuses a further return', async () => {
    const s = await setup();
    const p3 = await createProduct(app, s.owner.cookie, { sellingPrice: 3.33, costPrice: 1 });
    await addStock(s.owner.cookie, p3, 10);
    const made = await sale(s.cashierCookie, [{ productId: p3, quantity: 3 }]);
    expect(made.total).toBe('10.99'); // 9.99 + 1.00 tax

    const refunds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await giveBack(s.managerCookie, made.id, [line(p3, 1)]);
      expect(res.status).toBe(201);
      refunds.push(res.body.refundTotal);
    }
    expect(refunds).toEqual(['3.66', '3.67', '3.66']);
    expect(refunds.reduce((sum, r) => sum + cents(r), 0)).toBe(1099);

    const extra = await giveBack(s.managerCookie, made.id, [line(p3, 1)]);
    expect(extra.status).toBe(409);
    expect(extra.body.error.code).toBe('OVER_RETURN');
    expect(await stockOf(p3)).toBe(10);

    const status = await request(app)
      .get(`/api/v1/returns/by-sale/${made.id}`)
      .set('Cookie', s.managerCookie);
    expect(status.body.returnStatus).toBe('FULL');
    expect(status.body.returns).toHaveLength(3);
  });

  it('refunds the discounted price, not the list price', async () => {
    const s = await setup();
    const p5 = await createProduct(app, s.owner.cookie, { sellingPrice: 5, costPrice: 1 });
    await addStock(s.owner.cookie, p5, 10);
    // subtotal 10.00 - 10% = 9.00, tax 0.90, total 9.90
    const made = await sale(s.managerCookie, [{ productId: p5, quantity: 2 }], {
      discount: { type: 'PERCENT', value: 10 },
    });
    expect(made.total).toBe('9.90');

    const first = await giveBack(s.managerCookie, made.id, [line(p5, 1)]);
    const second = await giveBack(s.managerCookie, made.id, [line(p5, 1)]);
    expect(first.body.refundTotal).toBe('4.95');
    expect(second.body.refundTotal).toBe('4.95');
  });
});

describe('restocking decisions', () => {
  it('never restocks a damaged item, and requires an explicit decision on every line', async () => {
    const s = await setup();
    const made = await sale(s.cashierCookie, [{ productId: s.p1, quantity: 3 }]); // 6.60, stock 97

    const refused = await giveBack(s.managerCookie, made.id, [
      line(s.p1, 1, { reason: 'DAMAGED', restock: true }),
    ]);
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('RESTOCK_NOT_ALLOWED');
    expect(await returnCount()).toBe(0);
    expect(await stockOf(s.p1)).toBe(97);

    const noDecision = await request(app)
      .post('/api/v1/returns')
      .set('Cookie', s.managerCookie)
      .send({
        saleId: made.id,
        idempotencyKey: nextKey(),
        items: [{ productId: s.p1, quantity: 1, reason: 'CHANGED_MIND' }],
      });
    expect(noDecision.status).toBe(400);
    expect(noDecision.body.error.code).toBe('VALIDATION_ERROR');

    const ok = await giveBack(s.managerCookie, made.id, [
      line(s.p1, 1, { reason: 'DAMAGED', restock: false }),
    ]);
    expect(ok.status).toBe(201);
    expect(ok.body.refundTotal).toBe('2.20');
    expect(byProduct(ok.body.items, s.p1)).toMatchObject({ reason: 'DAMAGED', restock: false });
    expect(await stockOf(s.p1)).toBe(97); // unchanged
    expect(await returnMovements()).toBe(0);

    const integrity = await request(app)
      .get('/api/v1/inventory/integrity')
      .set('Cookie', s.owner.cookie);
    expect(integrity.body.ok).toBe(true);
  });

  it('restocks only the lines marked for restocking', async () => {
    const s = await setup();
    const made = await sale(s.cashierCookie, [
      { productId: s.p1, quantity: 2 },
      { productId: s.p2, quantity: 1 },
    ]); // stock 98 and 99

    const res = await giveBack(s.managerCookie, made.id, [
      line(s.p1, 2, { restock: true }),
      line(s.p2, 1, { reason: 'DAMAGED', restock: false }),
    ]);
    expect(res.status).toBe(201);
    expect(await stockOf(s.p1)).toBe(100);
    expect(await stockOf(s.p2)).toBe(99);
    expect(await returnMovements()).toBe(1);
    expect(await returnMovements(s.p1)).toBe(1);
  });
});

describe('limits and validation', () => {
  it('never returns more than was sold, and applies nothing when one line is invalid', async () => {
    const s = await setup();
    const made = await sale(s.cashierCookie, [{ productId: s.p1, quantity: 2 }]); // stock 98

    const over = await giveBack(s.managerCookie, made.id, [line(s.p1, 3)]);
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('OVER_RETURN');

    const notSold = await giveBack(s.managerCookie, made.id, [line(s.p2, 1)]);
    expect(notSold.status).toBe(400);
    expect(notSold.body.error.code).toBe('PRODUCT_NOT_ON_SALE');

    const mixed = await giveBack(s.managerCookie, made.id, [line(s.p1, 1), line(s.p2, 1)]);
    expect(mixed.status).toBe(400);
    expect(await stockOf(s.p1)).toBe(98); // the valid line was not applied either
    expect(await returnCount()).toBe(0);

    expect((await giveBack(s.managerCookie, made.id, [line(s.p1, 1)])).status).toBe(201);
    const again = await giveBack(s.managerCookie, made.id, [line(s.p1, 2)]);
    expect(again.status).toBe(409); // only 1 left
    expect(again.body.error.code).toBe('OVER_RETURN');
    expect(await stockOf(s.p1)).toBe(99);
  });

  it('rejects invalid bodies and unknown fields, and records nothing', async () => {
    const s = await setup();
    const made = await sale(s.cashierCookie, [{ productId: s.p1, quantity: 2 }]);
    const ok = line(s.p1, 1);

    const bad: {
      items: Record<string, unknown>[];
      extra?: Record<string, unknown>;
      saleId?: string;
    }[] = [
      { items: [] },
      { items: [ok, line(s.p1, 1)] }, // duplicate product
      { items: [line(s.p1, 0)] },
      { items: [line(s.p1, 1.5)] },
      { items: [line(s.p1, -1)] },
      { items: [line(s.p1, 1, { reason: 'BORED' })] },
      { items: [{ productId: s.p1, quantity: 1, restock: true }] }, // no reason
      { items: [line(s.p1, 1, { refundAmount: 99 })] },
      { items: [ok], extra: { refundTotal: 99 } },
      { items: [ok], extra: { storeId: s.owner.storeId } },
      { items: [ok], extra: { status: 'VOIDED' } },
      { items: [ok], extra: { note: 'x'.repeat(301) } },
      { items: [ok], extra: { idempotencyKey: 'abc' } },
      { items: [ok], saleId: 'nope' },
    ];
    for (const b of bad) {
      const res = await giveBack(s.managerCookie, b.saleId ?? made.id, b.items, b.extra);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const noKey = await request(app)
      .post('/api/v1/returns')
      .set('Cookie', s.managerCookie)
      .send({ saleId: made.id, items: [ok] });
    expect(noKey.status).toBe(400);

    expect(await returnCount()).toBe(0);
    expect(await stockOf(s.p1)).toBe(98);
  });
});

describe('idempotency and concurrency', () => {
  it('applies a repeated return once, and refuses a key reused for another sale or person', async () => {
    const s = await setup();
    const other = await addMember(app, s.owner.cookie, 'MANAGER', 'b');
    const otherCookie = await loginAs(app, other.email);
    const made = await sale(s.cashierCookie, [{ productId: s.p1, quantity: 2 }]);
    const another = await sale(s.cashierCookie, [{ productId: s.p1, quantity: 2 }]); // stock 96
    const body = { idempotencyKey: 'ret-replay-0001' };

    const first = await giveBack(s.managerCookie, made.id, [line(s.p1, 1)], body);
    const second = await giveBack(s.managerCookie, made.id, [line(s.p1, 1)], body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect(await returnCount()).toBe(1);
    expect(await stockOf(s.p1)).toBe(97);
    expect(await returnMovements()).toBe(1);

    const otherSale = await giveBack(s.managerCookie, another.id, [line(s.p1, 1)], body);
    expect(otherSale.status).toBe(409);
    expect(otherSale.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const otherPerson = await giveBack(otherCookie, made.id, [line(s.p1, 1)], body);
    expect(otherPerson.status).toBe(409);
    expect(await stockOf(s.p1)).toBe(97);
  });

  it('applies parallel requests with the same key exactly once', async () => {
    const s = await setup();
    const made = await sale(s.cashierCookie, [{ productId: s.p1, quantity: 2 }]); // stock 98
    const body = { idempotencyKey: 'parallel-ret-01' };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => giveBack(s.managerCookie, made.id, [line(s.p1, 1)], body)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(await returnCount()).toBe(1);
    expect(await stockOf(s.p1)).toBe(99);
    expect(await returnMovements()).toBe(1);
  });

  it('never over-returns under parallel requests, and the refunds add up to the sale', async () => {
    const s = await setup();
    const made = await sale(s.cashierCookie, [{ productId: s.p1, quantity: 3 }]); // 6.60, stock 97

    const results = await Promise.all(
      Array.from({ length: 5 }, () => giveBack(s.managerCookie, made.id, [line(s.p1, 1)])),
    );
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(ok.map((r) => r.body.number as number).sort()).toEqual([1, 2, 3]);
    expect(ok.reduce((sum, r) => sum + cents(r.body.refundTotal), 0)).toBe(660);
    expect(await stockOf(s.p1)).toBe(100);
    expect(await returnCount()).toBe(3);

    const integrity = await request(app)
      .get('/api/v1/inventory/integrity')
      .set('Cookie', s.owner.cookie);
    expect(integrity.body.ok).toBe(true);
  });
});

describe('preview', () => {
  it('works out the same refund as the real return without saving anything', async () => {
    const s = await setup();
    const made = await sale(s.cashierCookie, [{ productId: s.p1, quantity: 3 }]); // 6.60

    const view = await request(app)
      .post('/api/v1/returns/preview')
      .set('Cookie', s.managerCookie)
      .send({ saleId: made.id, items: [{ productId: s.p1, quantity: 2 }] });
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ currency: 'USD', refundMethod: 'CASH', refundTotal: '4.40' });
    expect(view.body.lines[0]).toMatchObject({ quantity: 2, refundAmount: '4.40' });
    expect(await returnCount()).toBe(0);
    expect(await stockOf(s.p1)).toBe(97);

    const real = await giveBack(s.managerCookie, made.id, [line(s.p1, 2)]);
    expect(real.body.refundTotal).toBe(view.body.refundTotal);

    const over = await request(app)
      .post('/api/v1/returns/preview')
      .set('Cookie', s.managerCookie)
      .send({ saleId: made.id, items: [{ productId: s.p1, quantity: 2 }] });
    expect(over.status).toBe(409); // only 1 left now
    const tampered = await request(app)
      .post('/api/v1/returns/preview')
      .set('Cookie', s.managerCookie)
      .send({ saleId: made.id, items: [{ productId: s.p1, quantity: 1 }], refundTotal: 0.01 });
    expect(tampered.status).toBe(400);
  });
});

describe('access and isolation', () => {
  it('lets managers and owners process returns but blocks cashiers everywhere', async () => {
    const s = await setup();
    const made = await sale(s.cashierCookie, [{ productId: s.p1, quantity: 2 }]);
    const missing = '00000000-0000-4000-8000-000000000000';

    const blocked = [
      await giveBack(s.cashierCookie, made.id, [line(s.p1, 1)]),
      await request(app).get('/api/v1/returns').set('Cookie', s.cashierCookie),
      await request(app).get(`/api/v1/returns/${missing}`).set('Cookie', s.cashierCookie),
      await request(app).get(`/api/v1/returns/by-sale/${made.id}`).set('Cookie', s.cashierCookie),
      await request(app)
        .post('/api/v1/returns/preview')
        .set('Cookie', s.cashierCookie)
        .send({ saleId: made.id, items: [{ productId: s.p1, quantity: 1 }] }),
    ];
    for (const res of blocked) expect(res.status).toBe(403);
    expect(await returnCount()).toBe(0);
    expect(await stockOf(s.p1)).toBe(98);

    expect((await giveBack(s.managerCookie, made.id, [line(s.p1, 1)])).status).toBe(201);
    expect((await giveBack(s.owner.cookie, made.id, [line(s.p1, 1)])).status).toBe(201);
    expect(await stockOf(s.p1)).toBe(100);
  });

  it("never reads or returns another store's sales", async () => {
    const s = await setup();
    const b = await registerOwner(app, 'b');
    const made = await sale(s.cashierCookie, [{ productId: s.p1, quantity: 2 }]);
    const mine = await giveBack(s.managerCookie, made.id, [line(s.p1, 1)]); // stock 99

    const attack = await giveBack(b.cookie, made.id, [line(s.p1, 1)]);
    expect(attack.status).toBe(404);
    expect(
      (await request(app).get(`/api/v1/returns/by-sale/${made.id}`).set('Cookie', b.cookie)).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/v1/returns/${mine.body.id}`).set('Cookie', b.cookie)).status,
    ).toBe(404);
    const view = await request(app)
      .post('/api/v1/returns/preview')
      .set('Cookie', b.cookie)
      .send({ saleId: made.id, items: [{ productId: s.p1, quantity: 1 }] });
    expect(view.status).toBe(404);

    const list = await request(app).get('/api/v1/returns').set('Cookie', b.cookie);
    expect(list.body.total).toBe(0);
    const forged = await request(app)
      .get('/api/v1/returns')
      .set('Cookie', b.cookie)
      .set('X-Store-Id', s.owner.storeId);
    expect(forged.status).toBe(403);

    expect(await returnCount()).toBe(1);
    expect(await stockOf(s.p1)).toBe(99);
  });

  it('requires authentication', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await request(app).get('/api/v1/returns')).status).toBe(401);
    expect((await request(app).post('/api/v1/returns').send({})).status).toBe(401);
    expect((await request(app).post('/api/v1/returns/preview').send({})).status).toBe(401);
    expect((await request(app).get(`/api/v1/returns/by-sale/${missing}`)).status).toBe(401);
  });
});

describe('history', () => {
  it('shows a return status in the sales list', async () => {
    const s = await setup();
    const a = await sale(s.cashierCookie, [{ productId: s.p1, quantity: 2 }]);
    const b = await sale(s.cashierCookie, [{ productId: s.p1, quantity: 2 }]);
    await sale(s.cashierCookie, [{ productId: s.p1, quantity: 2 }]);
    await giveBack(s.managerCookie, a.id, [line(s.p1, 2)]);
    await giveBack(s.managerCookie, b.id, [line(s.p1, 1)]);

    const list = await request(app).get('/api/v1/sales').set('Cookie', s.owner.cookie);
    expect(list.body.items.map((i: { returnStatus: string }) => i.returnStatus)).toEqual([
      'NONE',
      'PARTIAL',
      'FULL',
    ]);
    expect(list.body.items.map((i: { number: number }) => i.number)).toEqual([3, 2, 1]);
  });

  it('lists and reads returns with filters and paging', async () => {
    const s = await setup();
    const a = await sale(s.cashierCookie, [{ productId: s.p1, quantity: 3 }]);
    const b = await sale(s.cashierCookie, [{ productId: s.p2, quantity: 2 }]);
    await giveBack(s.managerCookie, a.id, [line(s.p1, 1)]);
    await giveBack(s.managerCookie, a.id, [line(s.p1, 1)]);
    const last = await giveBack(s.managerCookie, b.id, [line(s.p2, 1)]);

    const all = await request(app).get('/api/v1/returns').set('Cookie', s.managerCookie);
    expect(all.body.total).toBe(3);
    expect(all.body.items.map((i: { number: number }) => i.number)).toEqual([3, 2, 1]);
    expect(all.body.items[0]).toMatchObject({
      reference: 'R-000003',
      saleReference: 'S-000002',
      unitCount: 1,
    });

    const forSale = await request(app)
      .get(`/api/v1/returns?saleId=${a.id}`)
      .set('Cookie', s.managerCookie);
    expect(forSale.body.total).toBe(2);

    const page2 = await request(app)
      .get('/api/v1/returns?pageSize=2&page=2')
      .set('Cookie', s.managerCookie);
    expect(page2.body.items).toHaveLength(1);

    const one = await request(app)
      .get(`/api/v1/returns/${last.body.id}`)
      .set('Cookie', s.managerCookie);
    expect(one.status).toBe(200);
    expect(one.body.items[0]).toMatchObject({ productId: s.p2, quantity: 1 });
    const none = await request(app)
      .get('/api/v1/returns/00000000-0000-4000-8000-000000000000')
      .set('Cookie', s.managerCookie);
    expect(none.status).toBe(404);
    expect(
      (await request(app).get('/api/v1/returns?pageSize=1000').set('Cookie', s.managerCookie))
        .status,
    ).toBe(400);
  });
});
