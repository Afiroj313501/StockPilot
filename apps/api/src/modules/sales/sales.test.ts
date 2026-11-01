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
const nextKey = () => `sale-key-${Date.now()}-${++counter}`;
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

function sell(cookie: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/v1/sales')
    .set('Cookie', cookie)
    .send({ idempotencyKey: nextKey(), payment: { method: 'CASH', amountTendered: 1000 }, ...body });
}

const preview = (cookie: string, body: Record<string, unknown>) =>
  request(app).post('/api/v1/sales/preview').set('Cookie', cookie).send(body);

const one = (productId: string, quantity = 1) => [{ productId, quantity }];

async function stockOf(productId: string): Promise<number> {
  return (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).stockQuantity;
}
const saleCount = () => prisma.sale.count();

describe('checkout totals', () => {
  it('prices the sale on the server, saves snapshots, and deducts stock through the ledger', async () => {
    const s = await setup();
    const res = await sell(s.cashierCookie, {
      items: [
        { productId: s.p1, quantity: 2 },
        { productId: s.p2, quantity: 1 },
      ],
      customerName: '  Walk-in  ',
      payment: { method: 'CASH', amountTendered: 10 },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      reference: 'S-000001',
      status: 'COMPLETED',
      cashierName: 'CASHIER a',
      customerName: 'Walk-in',
      currency: 'USD',
      taxName: 'VAT',
      taxRatePercent: '10.00',
      taxInclusive: false,
      subtotal: '8.00',
      discountTotal: '0.00',
      taxTotal: '0.80',
      total: '8.80',
    });
    expect(res.body.payments[0]).toMatchObject({ method: 'CASH', amount: '8.80', tendered: '10.00', change: '1.20' });
    const line = res.body.items.find((i: { productId: string }) => i.productId === s.p1);
    expect(line).toMatchObject({
      quantity: 2,
      unitPrice: '2.00',
      lineSubtotal: '4.00',
      discountShare: '0.00',
      taxShare: '0.40',
      lineTotal: '4.40',
    });

    expect(await stockOf(s.p1)).toBe(98);
    expect(await stockOf(s.p2)).toBe(99);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { productId: s.p1, type: 'SALE' } });
    expect(movement).toMatchObject({
      quantityChange: -2,
      quantityBefore: 100,
      quantityAfter: 98,
      referenceType: 'SALE',
      referenceId: res.body.id,
    });

    const integrity = await request(app).get('/api/v1/inventory/integrity').set('Cookie', s.owner.cookie);
    expect(integrity.body.ok).toBe(true);
  });

  it('treats inclusive tax as part of the price', async () => {
    const s = await setup();
    await patchSettings(s.owner.cookie, { taxInclusive: true });
    const p3 = await createProduct(app, s.owner.cookie, { sellingPrice: 11 });
    await addStock(s.owner.cookie, p3, 10);

    const res = await sell(s.cashierCookie, { items: one(p3), payment: { method: 'CASH', amountTendered: 11 } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ taxInclusive: true, subtotal: '11.00', taxTotal: '1.00', total: '11.00' });
    expect(res.body.items[0].lineTotal).toBe('11.00');
  });

  it('keeps a sale unchanged when settings or prices change afterwards', async () => {
    const s = await setup();
    const made = await sell(s.cashierCookie, { items: one(s.p1, 2), payment: { method: 'CASH', amountTendered: 5 } });

    await patchSettings(s.owner.cookie, { taxRatePercent: 20, currency: 'EUR' });
    await request(app).patch(`/api/v1/products/${s.p1}`).set('Cookie', s.owner.cookie).send({ sellingPrice: 9 });

    const read = await request(app).get(`/api/v1/sales/${made.body.id}`).set('Cookie', s.cashierCookie);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ currency: 'USD', taxRatePercent: '10.00', total: '4.40' });
    expect(read.body.items[0].unitPrice).toBe('2.00');
  });

  it('never trusts totals from the browser', async () => {
    const s = await setup();
    const items = one(s.p1); // server total: 2.00 + 0.20 = 2.20

    const wrong = await sell(s.cashierCookie, { items, expectedTotal: 0.01 });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe('TOTAL_MISMATCH');
    expect(await saleCount()).toBe(0);
    expect(await stockOf(s.p1)).toBe(100);

    const right = await sell(s.cashierCookie, { items, expectedTotal: 2.2 });
    expect(right.status).toBe(201);
    expect(right.body.total).toBe('2.20');

    const forged: Record<string, unknown>[] = [
      { total: 0.01 },
      { taxTotal: 0 },
      { subtotal: 0.01 },
      { cashierId: s.owner.userId },
      { storeId: s.owner.storeId },
      { items: [{ productId: s.p1, quantity: 1, unitPrice: 0.01 }] },
    ];
    for (const extra of forged) {
      const res = await sell(s.cashierCookie, { items, ...extra });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await saleCount()).toBe(1);
  });
});

describe('discounts and payments', () => {
  it('lets managers discount before tax, with exact line shares, and blocks cashiers', async () => {
    const s = await setup();
    const items = [
      { productId: s.p1, quantity: 2 },
      { productId: s.p2, quantity: 1 },
    ]; // subtotal 8.00

    const percent = await sell(s.managerCookie, { items, discount: { type: 'PERCENT', value: 10 } });
    expect(percent.status).toBe(201);
    expect(percent.body).toMatchObject({
      discountType: 'PERCENT',
      discountValue: '10.00',
      discountTotal: '0.80',
      taxTotal: '0.72',
      total: '7.92',
    });
    const lineSum = percent.body.items.reduce((sum: number, i: { lineTotal: string }) => sum + cents(i.lineTotal), 0);
    expect(lineSum).toBe(cents(percent.body.total));

    const amount = await sell(s.managerCookie, { items, discount: { type: 'AMOUNT', value: 1 } });
    expect(amount.body).toMatchObject({ discountTotal: '1.00', taxTotal: '0.70', total: '7.70' });

    const tooLarge = await sell(s.managerCookie, { items, discount: { type: 'AMOUNT', value: 9 } });
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.error.code).toBe('DISCOUNT_TOO_LARGE');

    const invalid: Record<string, unknown>[] = [
      { type: 'PERCENT', value: 101 },
      { type: 'PERCENT', value: 0 },
      { type: 'AMOUNT', value: -1 },
      { type: 'AMOUNT', value: 1.005 },
      { type: 'FREE', value: 5 },
    ];
    for (const discount of invalid) {
      const res = await sell(s.managerCookie, { items, discount });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }

    const byCashier = await sell(s.cashierCookie, { items, discount: { type: 'PERCENT', value: 10 } });
    expect(byCashier.status).toBe(403);
    expect(byCashier.body.error.code).toBe('DISCOUNT_NOT_ALLOWED');
    expect(await saleCount()).toBe(2);
  });

  it('validates payments: cash gives change, recorded methods must match the total', async () => {
    const s = await setup();
    const items = one(s.p1); // total 2.20
    const pay = (method: string, amountTendered: number) => sell(s.cashierCookie, { items, payment: { method, amountTendered } });

    const short = await pay('CASH', 2);
    expect(short.status).toBe(409);
    expect(short.body.error.code).toBe('PAYMENT_INSUFFICIENT');
    expect((await pay('CARD', 2)).body.error.code).toBe('PAYMENT_AMOUNT_MISMATCH');
    expect((await pay('CARD', 3)).body.error.code).toBe('PAYMENT_AMOUNT_MISMATCH');
    expect((await pay('BITCOIN', 2.2)).status).toBe(400);

    const card = await pay('CARD', 2.2);
    expect(card.status).toBe(201);
    expect(card.body.payments[0]).toMatchObject({ method: 'CARD', tendered: '2.20', change: '0.00' });
    const cash = await pay('CASH', 2.2);
    expect(cash.status).toBe(201);
    expect(cash.body.payments[0].change).toBe('0.00');

    expect(await saleCount()).toBe(2);
    expect(await stockOf(s.p1)).toBe(98);
  });
});

describe('stock and product rules', () => {
  it('refuses to oversell unless the store allows negative stock, without burning a receipt number', async () => {
    const s = await setup();
    const p9 = await createProduct(app, s.owner.cookie, { name: 'Scarce Item', sellingPrice: 2 });
    await addStock(s.owner.cookie, p9, 3);

    const refused = await sell(s.cashierCookie, { items: one(p9, 4) });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(refused.body.error.message).toContain('Scarce Item');
    expect(await stockOf(p9)).toBe(3);
    expect(await saleCount()).toBe(0);
    expect(await prisma.stockMovement.count({ where: { type: 'SALE' } })).toBe(0);
    const store = await prisma.store.findUniqueOrThrow({ where: { id: s.owner.storeId } });
    expect(store.nextSaleNumber).toBe(1);

    await prisma.storeSetting.update({ where: { storeId: s.owner.storeId }, data: { allowNegativeStock: true } });
    const allowed = await sell(s.cashierCookie, { items: one(p9, 4) });
    expect(allowed.status).toBe(201);
    expect(allowed.body.reference).toBe('S-000001');
    expect(await stockOf(p9)).toBe(-1);
  });

  it('rejects unavailable, foreign and malformed items and records nothing', async () => {
    const s = await setup();
    const b = await registerOwner(app, 'b');
    const foreign = await createProduct(app, b.cookie);
    await addStock(b.cookie, foreign, 10);
    await request(app).patch(`/api/v1/products/${s.p2}`).set('Cookie', s.owner.cookie).send({ isActive: false });

    const archived = await sell(s.cashierCookie, { items: one(s.p2) });
    expect(archived.status).toBe(409);
    expect(archived.body.error.code).toBe('PRODUCT_UNAVAILABLE');

    const other = await sell(s.cashierCookie, { items: one(foreign) });
    expect(other.status).toBe(400);
    expect(other.body.error.code).toBe('INVALID_PRODUCT');

    const bad: Record<string, unknown>[] = [
      { items: [] },
      { items: [{ productId: s.p1, quantity: 1 }, { productId: s.p1, quantity: 2 }] },
      { items: one(s.p1, 0) },
      { items: one(s.p1, 1.5) },
      { items: one(s.p1), customerName: 'x'.repeat(101) },
      { items: one(s.p1), idempotencyKey: 'short' },
      { items: one(s.p1), payment: { method: 'CASH' } },
    ];
    for (const body of bad) {
      const res = await sell(s.cashierCookie, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const noKey = await request(app)
      .post('/api/v1/sales')
      .set('Cookie', s.cashierCookie)
      .send({ items: one(s.p1), payment: { method: 'CASH', amountTendered: 5 } });
    expect(noKey.status).toBe(400);

    expect(await saleCount()).toBe(0);
    expect(await stockOf(foreign)).toBe(10);
  });
});

describe('idempotency and concurrency', () => {
  it('applies a repeated checkout once, and refuses another cashier reusing the key', async () => {
    const s = await setup();
    const other = await addMember(app, s.owner.cookie, 'CASHIER', 'b');
    const otherCookie = await loginAs(app, other.email);
    const body = { idempotencyKey: 'sale-key-0001', items: one(s.p1) };

    const first = await sell(s.cashierCookie, body);
    const second = await sell(s.cashierCookie, body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect(await saleCount()).toBe(1);
    expect(await stockOf(s.p1)).toBe(99);

    const stolen = await sell(otherCookie, body);
    expect(stolen.status).toBe(409);
    expect(stolen.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('sells once when the same checkout arrives in parallel', async () => {
    const s = await setup();
    const body = { idempotencyKey: 'parallel-sale-01', items: one(s.p1, 2) };

    const results = await Promise.all(Array.from({ length: 5 }, () => sell(s.cashierCookie, body)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(await saleCount()).toBe(1);
    expect(await stockOf(s.p1)).toBe(98);
    expect(await prisma.stockMovement.count({ where: { type: 'SALE' } })).toBe(1);
  });

  it('never oversells under parallel checkouts and numbers receipts uniquely', async () => {
    const s = await setup();
    const p9 = await createProduct(app, s.owner.cookie, { sellingPrice: 2 });
    await addStock(s.owner.cookie, p9, 10);

    const results = await Promise.all(Array.from({ length: 5 }, () => sell(s.cashierCookie, { items: one(p9, 3) })));
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(ok.map((r) => r.body.number as number).sort()).toEqual([1, 2, 3]);
    expect(await stockOf(p9)).toBe(1);
    expect(await saleCount()).toBe(3);
    expect(await prisma.stockMovement.count({ where: { productId: p9, type: 'SALE' } })).toBe(3);

    const integrity = await request(app).get('/api/v1/inventory/integrity').set('Cookie', s.owner.cookie);
    expect(integrity.body.ok).toBe(true);
  });
});

describe('preview', () => {
  it('prices a cart exactly like checkout, without saving anything', async () => {
    const s = await setup();
    const items = [
      { productId: s.p1, quantity: 2 },
      { productId: s.p2, quantity: 1 },
    ];

    const view = await preview(s.cashierCookie, { items });
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ currency: 'USD', taxName: 'VAT', subtotal: '8.00', taxTotal: '0.80', total: '8.80' });
    expect(view.body.lines).toHaveLength(2);
    expect(await saleCount()).toBe(0);
    expect(await stockOf(s.p1)).toBe(100);

    const sold = await sell(s.cashierCookie, { items });
    expect(sold.body.total).toBe(view.body.total);
    expect(sold.body.taxTotal).toBe(view.body.taxTotal);

    const discounted = await preview(s.managerCookie, { items, discount: { type: 'PERCENT', value: 10 } });
    expect(discounted.body.total).toBe('7.92');
    const byCashier = await preview(s.cashierCookie, { items, discount: { type: 'PERCENT', value: 10 } });
    expect(byCashier.status).toBe(403);
    expect((await preview(s.cashierCookie, { items: [] })).status).toBe(400);
  });
});

describe('history and access', () => {
  it('shows cashiers only their own sales and managers and owners everything', async () => {
    const s = await setup();
    const other = await addMember(app, s.owner.cookie, 'CASHIER', 'b');
    const otherCookie = await loginAs(app, other.email);

    const mine = await sell(s.cashierCookie, { items: one(s.p1, 2) });
    const theirs = await sell(otherCookie, { items: one(s.p2) });

    const myList = await request(app).get('/api/v1/sales').set('Cookie', s.cashierCookie);
    expect(myList.body.total).toBe(1);
    expect(myList.body.items[0]).toMatchObject({
      reference: 'S-000001',
      cashierName: 'CASHIER a',
      unitCount: 2,
      total: '4.40',
      paymentMethod: 'CASH',
    });

    const own = await request(app).get(`/api/v1/sales/${mine.body.id}`).set('Cookie', s.cashierCookie);
    expect(own.status).toBe(200);
    const notMine = await request(app).get(`/api/v1/sales/${theirs.body.id}`).set('Cookie', s.cashierCookie);
    expect(notMine.status).toBe(404);

    const managerList = await request(app).get('/api/v1/sales').set('Cookie', s.managerCookie);
    expect(managerList.body.total).toBe(2);
    const ownerRead = await request(app).get(`/api/v1/sales/${theirs.body.id}`).set('Cookie', s.owner.cookie);
    expect(ownerRead.status).toBe(200);
  });

  it('lists newest first with paging and rejects bad parameters', async () => {
    const s = await setup();
    for (let i = 0; i < 3; i++) await sell(s.cashierCookie, { items: one(s.p1) });

    const page1 = await request(app).get('/api/v1/sales?pageSize=2').set('Cookie', s.owner.cookie);
    expect(page1.body.items.map((i: { number: number }) => i.number)).toEqual([3, 2]);
    expect(page1.body).toMatchObject({ total: 3, totalPages: 2 });
    const page2 = await request(app).get('/api/v1/sales?pageSize=2&page=2').set('Cookie', s.owner.cookie);
    expect(page2.body.items.map((i: { number: number }) => i.number)).toEqual([1]);

    expect((await request(app).get('/api/v1/sales?pageSize=1000').set('Cookie', s.owner.cookie)).status).toBe(400);
    expect((await request(app).get('/api/v1/sales/not-a-uuid').set('Cookie', s.owner.cookie)).status).toBe(400);
  });

  it("never exposes or sells another store's data", async () => {
    const s = await setup();
    const b = await registerOwner(app, 'b');
    const made = await sell(s.cashierCookie, { items: one(s.p1) });

    const read = await request(app).get(`/api/v1/sales/${made.body.id}`).set('Cookie', b.cookie);
    expect(read.status).toBe(404);
    const list = await request(app).get('/api/v1/sales').set('Cookie', b.cookie);
    expect(list.body.total).toBe(0);

    const forged = await request(app)
      .get('/api/v1/sales')
      .set('Cookie', b.cookie)
      .set('X-Store-Id', s.owner.storeId);
    expect(forged.status).toBe(403);

    const attack = await sell(b.cookie, { items: one(s.p1) });
    expect(attack.status).toBe(400);
    expect(attack.body.error.code).toBe('INVALID_PRODUCT');
    const viewAttack = await preview(b.cookie, { items: one(s.p1) });
    expect(viewAttack.status).toBe(400);
    expect(await stockOf(s.p1)).toBe(99);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/sales')).status).toBe(401);
    expect((await request(app).post('/api/v1/sales').send({})).status).toBe(401);
    expect((await request(app).post('/api/v1/sales/preview').send({})).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/sales/00000000-0000-4000-8000-000000000000')).status,
    ).toBe(401);
  });
});