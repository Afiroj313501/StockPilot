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

const app = createApp({ authRateLimitMax: 1000 });

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

let counter = 0;
const nextKey = () => `rcv-key-${Date.now()}-${++counter}`;

async function setup() {
  const owner = await registerOwner(app, 'a');
  const manager = await addMember(app, owner.cookie, 'MANAGER', 'a');
  const cashier = await addMember(app, owner.cookie, 'CASHIER', 'a');
  return {
    owner,
    managerCookie: await loginAs(app, manager.email),
    cashierCookie: await loginAs(app, cashier.email),
    supplierId: await createSupplier(app, owner.cookie),
    p1: await createProduct(app, owner.cookie),
    p2: await createProduct(app, owner.cookie),
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const act = (cookie: string, id: string, action: string) =>
  request(app).post(`/api/v1/purchases/${id}/${action}`).set('Cookie', cookie).send({});

async function draftOrder(s: Setup, items?: Record<string, unknown>[]): Promise<string> {
  const res = await request(app)
    .post('/api/v1/purchases')
    .set('Cookie', s.owner.cookie)
    .send({
      supplierId: s.supplierId,
      items: items ?? [
        { productId: s.p1, quantityOrdered: 10, unitCost: 2 },
        { productId: s.p2, quantityOrdered: 5, unitCost: 4 },
      ],
    });
  if (res.status !== 201) throw new Error(`create order failed: ${res.status}`);
  return res.body.id as string;
}

async function approvedOrder(s: Setup, items?: Record<string, unknown>[]): Promise<string> {
  const id = await draftOrder(s, items);
  await act(s.managerCookie, id, 'submit');
  await act(s.owner.cookie, id, 'approve');
  return id;
}

const receive = (cookie: string, id: string, body: Record<string, unknown>) =>
  request(app)
    .post(`/api/v1/purchases/${id}/receive`)
    .set('Cookie', cookie)
    .send({ idempotencyKey: nextKey(), ...body });

async function stockOf(productId: string): Promise<number> {
  return (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQuantity;
}
const movementCount = (productId: string) => prisma.stockMovement.count({ where: { productId } });
const receiptCount = () => prisma.purchaseReceipt.count();

describe('receiving stock', () => {
  it('receives a full order, updating stock, the ledger, cost and order status', async () => {
    const s = await setup();
    const id = await approvedOrder(s);

    const res = await receive(s.managerCookie, id, {
      note: 'Delivery #77',
      items: [
        { productId: s.p1, quantity: 10 },
        { productId: s.p2, quantity: 5 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('RECEIVED');
    expect(
      res.body.items.every((i: { quantityRemaining: number }) => i.quantityRemaining === 0),
    ).toBe(true);
    expect(res.body.receipts).toHaveLength(1);
    expect(res.body.receipts[0]).toMatchObject({
      receivedByName: 'MANAGER a',
      note: 'Delivery #77',
    });
    expect(res.body.receipts[0].items).toHaveLength(2);

    expect(await stockOf(s.p1)).toBe(10);
    expect(await stockOf(s.p2)).toBe(5);

    const movements = await prisma.stockMovement.findMany({ where: { productId: s.p1 } });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: 'RECEIPT',
      quantityChange: 10,
      quantityBefore: 0,
      quantityAfter: 10,
      referenceType: 'PURCHASE_RECEIPT',
      referenceId: res.body.receipts[0].id,
    });

    const product = await prisma.product.findUniqueOrThrow({ where: { id: s.p1 } });
    expect(product.averageCost?.toFixed(4)).toBe('2.0000'); // no stock before, so the receipt cost

    const integrity = await request(app)
      .get('/api/v1/inventory/integrity')
      .set('Cookie', s.owner.cookie);
    expect(integrity.body.ok).toBe(true);
  });

  it('handles partial deliveries and freezes the order meanwhile', async () => {
    const s = await setup();
    const id = await approvedOrder(s);

    const first = await receive(s.managerCookie, id, { items: [{ productId: s.p1, quantity: 4 }] });
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('PARTIALLY_RECEIVED');
    const line = first.body.items.find((i: { productId: string }) => i.productId === s.p1);
    expect(line).toMatchObject({ quantityOrdered: 10, quantityReceived: 4, quantityRemaining: 6 });
    expect(await stockOf(s.p1)).toBe(4);
    expect(await stockOf(s.p2)).toBe(0);

    const cancel = await act(s.owner.cookie, id, 'cancel');
    expect(cancel.status).toBe(409);
    expect(cancel.body.error.code).toBe('INVALID_STATE');
    const edit = await request(app)
      .patch(`/api/v1/purchases/${id}`)
      .set('Cookie', s.owner.cookie)
      .send({ notes: 'late' });
    expect(edit.body.error.code).toBe('NOT_EDITABLE');

    const second = await receive(s.managerCookie, id, {
      items: [
        { productId: s.p1, quantity: 6 },
        { productId: s.p2, quantity: 5 },
      ],
    });
    expect(second.body.status).toBe('RECEIVED');
    expect(second.body.receipts).toHaveLength(2);
    expect(await stockOf(s.p1)).toBe(10);
    expect(await stockOf(s.p2)).toBe(5);
    expect(await movementCount(s.p1)).toBe(2);

    const integrity = await request(app)
      .get('/api/v1/inventory/integrity')
      .set('Cookie', s.owner.cookie);
    expect(integrity.body.ok).toBe(true);
  });

  it('never receives more than is outstanding, and applies nothing when one line is invalid', async () => {
    const s = await setup();
    const id = await approvedOrder(s);

    const over = await receive(s.managerCookie, id, { items: [{ productId: s.p1, quantity: 11 }] });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('OVER_RECEIPT');

    const mixed = await receive(s.managerCookie, id, {
      items: [
        { productId: s.p2, quantity: 5 },
        { productId: s.p1, quantity: 11 },
      ],
    });
    expect(mixed.status).toBe(409);
    expect(await stockOf(s.p2)).toBe(0); // the valid line was not applied either

    expect(
      (await receive(s.managerCookie, id, { items: [{ productId: s.p1, quantity: 6 }] })).status,
    ).toBe(201);
    const again = await receive(s.managerCookie, id, { items: [{ productId: s.p1, quantity: 5 }] });
    expect(again.status).toBe(409); // only 4 left
    expect(again.body.error.code).toBe('OVER_RECEIPT');

    const other = await createProduct(app, s.owner.cookie);
    const foreignLine = await receive(s.managerCookie, id, {
      items: [{ productId: other, quantity: 1 }],
    });
    expect(foreignLine.status).toBe(400);
    expect(foreignLine.body.error.code).toBe('PRODUCT_NOT_ON_ORDER');

    expect(await stockOf(s.p1)).toBe(6);
    expect(await receiptCount()).toBe(1);
    expect(await movementCount(s.p1)).toBe(1);
  });

  it('only receives against approved or partly received orders', async () => {
    const s = await setup();
    const body = { items: [{ productId: s.p1, quantity: 1 }] };

    const draft = await draftOrder(s);
    expect((await receive(s.managerCookie, draft, body)).status).toBe(409);

    const submitted = await draftOrder(s);
    await act(s.managerCookie, submitted, 'submit');
    expect((await receive(s.managerCookie, submitted, body)).status).toBe(409);

    const cancelled = await approvedOrder(s);
    await act(s.owner.cookie, cancelled, 'cancel');
    const res = await receive(s.managerCookie, cancelled, body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');

    const done = await approvedOrder(s);
    const full = [
      { productId: s.p1, quantity: 10 },
      { productId: s.p2, quantity: 5 },
    ];
    expect((await receive(s.managerCookie, done, { items: full })).body.status).toBe('RECEIVED');
    expect((await receive(s.managerCookie, done, body)).status).toBe(409);

    expect(await receiptCount()).toBe(1);
    expect(await stockOf(s.p1)).toBe(10);
  });
});

describe('idempotency and concurrency', () => {
  it('applies a repeated receipt once, and refuses a key reused on another order', async () => {
    const s = await setup();
    const id = await approvedOrder(s);
    const body = { idempotencyKey: 'replay-key-0001', items: [{ productId: s.p1, quantity: 10 }] };

    const first = await receive(s.managerCookie, id, body);
    const second = await receive(s.managerCookie, id, body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.receipts).toHaveLength(1);
    expect(await stockOf(s.p1)).toBe(10);
    expect(await receiptCount()).toBe(1);
    expect(await movementCount(s.p1)).toBe(1);

    const otherOrder = await approvedOrder(s);
    const clash = await receive(s.managerCookie, otherOrder, body);
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await stockOf(s.p1)).toBe(10);
  });

  it('applies parallel requests with the same key exactly once', async () => {
    const s = await setup();
    const id = await approvedOrder(s);
    const body = { idempotencyKey: 'parallel-rcv-01', items: [{ productId: s.p1, quantity: 4 }] };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => receive(s.managerCookie, id, body)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(await stockOf(s.p1)).toBe(4);
    expect(await receiptCount()).toBe(1);
    expect(await movementCount(s.p1)).toBe(1);
  });

  it('never over-receives under parallel receipts with different keys', async () => {
    const s = await setup();
    const id = await approvedOrder(s, [{ productId: s.p1, quantityOrdered: 10, unitCost: 2 }]);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        receive(s.managerCookie, id, { items: [{ productId: s.p1, quantity: 4 }] }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await stockOf(s.p1)).toBe(8);
    expect(await receiptCount()).toBe(2);
    const order = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });
    expect(order.status).toBe('PARTIALLY_RECEIVED');
  });

  it('lets exactly one of a parallel receive and cancel win', async () => {
    const s = await setup();
    const id = await approvedOrder(s);

    const [received, cancelled] = await Promise.all([
      receive(s.managerCookie, id, { items: [{ productId: s.p1, quantity: 10 }] }),
      act(s.owner.cookie, id, 'cancel'),
    ]);
    const wins = [received.status === 201, cancelled.status === 200].filter(Boolean).length;
    expect(wins).toBe(1);

    const order = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });
    if (cancelled.status === 200) {
      expect(order.status).toBe('CANCELLED');
      expect(await stockOf(s.p1)).toBe(0);
      expect(await receiptCount()).toBe(0);
    } else {
      expect(order.status).toBe('PARTIALLY_RECEIVED');
      expect(await stockOf(s.p1)).toBe(10);
      expect(await receiptCount()).toBe(1);
    }
  });
});

describe('cost, validation and access', () => {
  it('keeps a moving weighted-average cost and leaves the standard cost alone', async () => {
    const s = await setup();
    // 10 units on hand, no average yet: the product costPrice (1.00) is the starting average.
    const opening = await request(app)
      .post('/api/v1/inventory/movements')
      .set('Cookie', s.owner.cookie)
      .send({ productId: s.p1, type: 'OPENING', quantity: 10, idempotencyKey: nextKey() });
    expect(opening.status).toBe(201);

    const first = await approvedOrder(s, [{ productId: s.p1, quantityOrdered: 10, unitCost: 3 }]);
    await receive(s.managerCookie, first, { items: [{ productId: s.p1, quantity: 10 }] });
    let product = await prisma.product.findUniqueOrThrow({ where: { id: s.p1 } });
    expect(product.stockQuantity).toBe(20);
    expect(product.averageCost?.toFixed(4)).toBe('2.0000'); // (10 x 1 + 10 x 3) / 20

    const second = await approvedOrder(s, [{ productId: s.p1, quantityOrdered: 20, unitCost: 4 }]);
    await receive(s.managerCookie, second, { items: [{ productId: s.p1, quantity: 20 }] });
    product = await prisma.product.findUniqueOrThrow({ where: { id: s.p1 } });
    expect(product.stockQuantity).toBe(40);
    expect(product.averageCost?.toFixed(4)).toBe('3.0000'); // (20 x 2 + 20 x 4) / 40
    expect(product.costPrice.toFixed(2)).toBe('1.00'); // the standard cost is untouched
  });

  it('rejects invalid bodies and records nothing', async () => {
    const s = await setup();
    const id = await approvedOrder(s);
    const line = (extra: Record<string, unknown> = {}) => ({
      productId: s.p1,
      quantity: 1,
      ...extra,
    });

    const bad: Record<string, unknown>[] = [
      { items: [] },
      { items: [line(), line({ quantity: 2 })] },
      { items: [line({ quantity: 0 })] },
      { items: [line({ quantity: 1.5 })] },
      { items: [line({ quantity: -1 })] },
      { items: [line({ unitCost: 9 })] },
      { items: [line({ quantityReceived: 5 })] },
      { items: [line({ productId: 'nope' })] },
      { items: [line()], storeId: s.owner.storeId },
      { items: [line()], status: 'RECEIVED' },
      { items: [line()], note: 'x'.repeat(301) },
      { items: [line()], idempotencyKey: 'abc' },
      { items: [line()], idempotencyKey: 'bad key!!' },
    ];
    for (const body of bad) {
      const res = await receive(s.managerCookie, id, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }

    const noKey = await request(app)
      .post(`/api/v1/purchases/${id}/receive`)
      .set('Cookie', s.managerCookie)
      .send({ items: [line()] });
    expect(noKey.status).toBe(400);

    expect(await stockOf(s.p1)).toBe(0);
    expect(await receiptCount()).toBe(0);
  });

  it('lets managers and owners receive but not cashiers', async () => {
    const s = await setup();
    const id = await approvedOrder(s);
    const one = { items: [{ productId: s.p1, quantity: 1 }] };

    expect((await receive(s.cashierCookie, id, one)).status).toBe(403);
    expect(await receiptCount()).toBe(0);
    expect((await receive(s.managerCookie, id, one)).status).toBe(201);
    expect((await receive(s.owner.cookie, id, one)).status).toBe(201);
    expect(await stockOf(s.p1)).toBe(2);
  });

  it("never receives against another store's order", async () => {
    const s = await setup();
    const id = await approvedOrder(s);
    const b = await registerOwner(app, 'b');
    const body = { items: [{ productId: s.p1, quantity: 1 }] };

    const attack = await receive(b.cookie, id, body);
    expect(attack.status).toBe(404);

    const forged = await request(app)
      .post(`/api/v1/purchases/${id}/receive`)
      .set('Cookie', b.cookie)
      .set('X-Store-Id', s.owner.storeId)
      .send({ idempotencyKey: nextKey(), ...body });
    expect(forged.status).toBe(403);

    expect(await stockOf(s.p1)).toBe(0);
    expect(await receiptCount()).toBe(0);
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/v1/purchases/00000000-0000-4000-8000-000000000000/receive')
      .send({});
    expect(res.status).toBe(401);
  });
});
