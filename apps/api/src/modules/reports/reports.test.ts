import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/prisma';
import { resetDb } from '../../test/db';
import { addMember, createProduct, loginAs, registerOwner } from '../../test/helpers';
import { daysBetween } from './dateRange';

const app = createApp({ authRateLimitMax: 1000 });

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

let counter = 0;
const nextKey = () => `rep-key-${Date.now()}-${++counter}`;
const cents = (value: string) => Math.round(Number(value) * 100);
const RANGE = '?from=2026-11-01&to=2026-11-03';

const patchSettings = (cookie: string, body: Record<string, unknown>) =>
  request(app).patch('/api/v1/settings').set('Cookie', cookie).send(body);

async function addStock(cookie: string, productId: string, quantity: number) {
  const res = await request(app)
    .post('/api/v1/inventory/movements')
    .set('Cookie', cookie)
    .send({ productId, type: 'OPENING', quantity, idempotencyKey: nextKey() });
  if (res.status !== 201) throw new Error(`addStock failed: ${res.status}`);
}

async function sell(cookie: string, items: { productId: string; quantity: number }[], at: string, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/sales')
    .set('Cookie', cookie)
    .send({ idempotencyKey: nextKey(), items, payment: { method: 'CASH', amountTendered: 1000 }, ...extra });
  if (res.status !== 201) throw new Error(`sale failed: ${res.status} ${JSON.stringify(res.body)}`);
  // Move the sale to a known moment so the tests can check date boundaries.
  await prisma.sale.update({ where: { id: res.body.id }, data: { createdAt: new Date(at) } });
  return res.body as { id: string; total: string };
}

async function giveBack(cookie: string, saleId: string, productId: string, restock: boolean, reason: string, at: string) {
  const res = await request(app)
    .post('/api/v1/returns')
    .set('Cookie', cookie)
    .send({ saleId, idempotencyKey: nextKey(), items: [{ productId, quantity: 1, restock, reason }] });
  if (res.status !== 201) throw new Error(`return failed: ${res.status} ${JSON.stringify(res.body)}`);
  await prisma.saleReturn.update({ where: { id: res.body.id }, data: { createdAt: new Date(at) } });
}

// Store in Dhaka (UTC+6) with 10% exclusive VAT:
//   sale 1  Nov 1 01:00 local  Cola x2                      total 22.00  cost 8.00
//   sale 2  Nov 2 11:00 local  Chips x3                     total 16.50  cost 9.00
//   sale 3  Nov 3 12:00 local  Cola x1 + Chips x1, 10% off  total 14.85  cost 7.00
//   return  Nov 3 14:00 local  1 Cola from sale 1, restocked        refund 11.00 (tax 1.00)
//   return  Nov 3 15:00 local  1 Chips from sale 2, damaged         refund  5.50 (tax 0.50)
async function fixture() {
  const owner = await registerOwner(app, 'a');
  const manager = await addMember(app, owner.cookie, 'MANAGER', 'a');
  const cashier = await addMember(app, owner.cookie, 'CASHIER', 'a');
  const managerCookie = await loginAs(app, manager.email);
  const cashierCookie = await loginAs(app, cashier.email);

  const set = await patchSettings(owner.cookie, { timeZone: 'Asia/Dhaka', taxName: 'VAT', taxRatePercent: 10 });
  if (set.status !== 200) throw new Error(`settings failed: ${set.status}`);
  const cat = await request(app).post('/api/v1/categories').set('Cookie', owner.cookie).send({ name: 'Drinks' });
  const catId = cat.body.id as string;

  const A = await createProduct(app, owner.cookie, { name: 'Cola', sellingPrice: 10, costPrice: 4, categoryId: catId });
  const B = await createProduct(app, owner.cookie, { name: 'Chips', sellingPrice: 5, costPrice: 3 });
  await addStock(owner.cookie, A, 100);
  await addStock(owner.cookie, B, 100);

  const s1 = await sell(cashierCookie, [{ productId: A, quantity: 2 }], '2026-10-31T19:00:00Z');
  const s2 = await sell(cashierCookie, [{ productId: B, quantity: 3 }], '2026-11-02T05:00:00Z');
  await sell(managerCookie, [{ productId: A, quantity: 1 }, { productId: B, quantity: 1 }], '2026-11-03T06:00:00Z', {
    discount: { type: 'PERCENT', value: 10 },
  });
  await giveBack(managerCookie, s1.id, A, true, 'CHANGED_MIND', '2026-11-03T08:00:00Z');
  await giveBack(managerCookie, s2.id, B, false, 'DAMAGED', '2026-11-03T09:00:00Z');

  return { owner, managerCookie, cashierCookie, A, B, catId };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

const get = (cookie: string, path: string) => request(app).get(`/api/v1/reports${path}`).set('Cookie', cookie);
const csvLines = (text: string) => text.replace(/^\uFEFF/, '').trim().split('\r\n');
const csvRows = (text: string) => csvLines(text).map((l) => l.split(','));

describe('sales over time', () => {
  it('computes gross sales, refunds, net sales, cost and profit per local day', async () => {
    const s = await fixture();
    const res = await get(s.managerCookie, `/summary${RANGE}`);
    expect(res.status).toBe(200);
    expect(res.body.period).toMatchObject({ from: '2026-11-01', to: '2026-11-03', timeZone: 'Asia/Dhaka', group: 'day' });
    expect(res.body.totals).toEqual({
      salesCount: 3,
      returnsCount: 2,
      grossSales: '50.00',
      discounts: '1.50',
      taxCollected: '4.85',
      salesTotal: '53.35',
      refunds: '16.50',
      taxRefunded: '1.50',
      netSales: '33.50', // (53.35 - 4.85) - (16.50 - 1.50)
      cogs: '20.00', // 24.00 sold - 4.00 restocked (the damaged return stays as cost)
      grossProfit: '13.50',
    });

    const days = res.body.series;
    expect(days.map((d: { bucket: string }) => d.bucket)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(days[0]).toMatchObject({ salesCount: 1, netSales: '20.00', cogs: '8.00', grossProfit: '12.00' });
    expect(days[1]).toMatchObject({ salesCount: 1, netSales: '15.00', cogs: '9.00', grossProfit: '6.00' });
    expect(days[2]).toMatchObject({ salesCount: 1, returnsCount: 2, refunds: '16.50', netSales: '-1.50', cogs: '3.00', grossProfit: '-4.50' });

    const sum = (key: string) => days.reduce((acc: number, d: Record<string, string>) => acc + cents(d[key]!), 0);
    expect(sum('netSales')).toBe(cents(res.body.totals.netSales));
    expect(sum('grossProfit')).toBe(cents(res.body.totals.grossProfit));
  });

  it('groups by ISO week (Monday) and by month', async () => {
    const s = await fixture();
    const weeks = await get(s.managerCookie, `/summary${RANGE}&group=week`);
    expect(weeks.body.series.map((r: { bucket: string }) => r.bucket)).toEqual(['2026-10-26', '2026-11-02']);
    expect(weeks.body.series.map((r: { netSales: string }) => r.netSales)).toEqual(['20.00', '13.50']);

    const months = await get(s.managerCookie, `/summary${RANGE}&group=month`);
    expect(months.body.series).toHaveLength(1);
    expect(months.body.series[0]).toMatchObject({ bucket: '2026-11-01', netSales: '33.50' });
    expect(months.body.totals).toEqual(weeks.body.totals);
  });

  it('uses the store time zone for date boundaries', async () => {
    const s = await fixture();
    // Sale 1 happened at 19:00 UTC on Oct 31, which is already Nov 1 in Dhaka.
    const before = await get(s.managerCookie, '/summary?from=2026-10-31&to=2026-10-31');
    expect(before.body.totals.salesCount).toBe(0);
    expect(before.body.totals.netSales).toBe('0.00');

    const first = await get(s.managerCookie, '/summary?from=2026-11-01&to=2026-11-01');
    expect(first.body.totals).toMatchObject({ salesCount: 1, netSales: '20.00' });

    // Refunds count on the day of the return, not the day of the sale.
    const last = await get(s.managerCookie, '/summary?from=2026-11-03&to=2026-11-03');
    expect(last.body.totals).toMatchObject({ salesCount: 1, returnsCount: 2, netSales: '-1.50' });
  });

  it('warns when sold lines have no cost, instead of presenting revenue as profit', async () => {
    const owner = await registerOwner(app, 'z');
    const free = await createProduct(app, owner.cookie, { sellingPrice: 2, costPrice: 0 });
    await addStock(owner.cookie, free, 10);
    const sale = await request(app)
      .post('/api/v1/sales')
      .set('Cookie', owner.cookie)
      .send({ idempotencyKey: nextKey(), items: [{ productId: free, quantity: 1 }], payment: { method: 'CASH', amountTendered: 5 } });
    expect(sale.status).toBe(201);

    const res = await get(owner.cookie, '/summary');
    expect(res.body.warnings.zeroCostLines).toBe(1);
    expect(res.body.totals).toMatchObject({ netSales: '2.00', cogs: '0.00', grossProfit: '2.00' });
  });

  it('defaults to the last 30 days with every day present, even in an empty store', async () => {
    const owner = await registerOwner(app, 'e');
    const res = await get(owner.cookie, '/summary');
    expect(res.status).toBe(200);
    expect(res.body.period.to).toBe(res.body.period.today);
    expect(daysBetween(res.body.period.from, res.body.period.to)).toBe(29);
    expect(res.body.series).toHaveLength(30);
    expect(res.body.totals).toMatchObject({ salesCount: 0, netSales: '0.00', grossProfit: '0.00' });

    expect((await get(owner.cookie, '/products')).body.items).toEqual([]);
    expect((await get(owner.cookie, '/categories')).body.items).toEqual([]);
    const inv = await get(owner.cookie, '/inventory');
    expect(inv.body.totals).toMatchObject({ units: 0, costValue: '0.00', retailValue: '0.00' });
    const dash = await get(owner.cookie, '/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.recentSales).toEqual([]);
  });
});

describe('products, categories and inventory', () => {
  it('ranks products by revenue, units or profit and adds up to the totals', async () => {
    const s = await fixture();
    const byRevenue = await get(s.managerCookie, `/products${RANGE}`);
    expect(byRevenue.body.items.map((i: { name: string }) => i.name)).toEqual(['Cola', 'Chips']);
    expect(byRevenue.body.items[0]).toMatchObject({
      productId: s.A,
      unitsSold: 3,
      unitsReturned: 1,
      netUnits: 2,
      netRevenue: '19.00', // 29.00 sold - 10.00 refunded, ex tax
      cogs: '8.00', // 12.00 sold - 4.00 restocked
      grossProfit: '11.00',
    });
    expect(byRevenue.body.items[1]).toMatchObject({ unitsSold: 4, unitsReturned: 1, netRevenue: '14.50', cogs: '12.00', grossProfit: '2.50' });

    const totals = (await get(s.managerCookie, `/summary${RANGE}`)).body.totals;
    const revenue = byRevenue.body.items.reduce((acc: number, i: { netRevenue: string }) => acc + cents(i.netRevenue), 0);
    const profit = byRevenue.body.items.reduce((acc: number, i: { grossProfit: string }) => acc + cents(i.grossProfit), 0);
    expect(revenue).toBe(cents(totals.netSales));
    expect(profit).toBe(cents(totals.grossProfit));

    const byUnits = await get(s.managerCookie, `/products${RANGE}&sort=units`);
    expect(byUnits.body.items.map((i: { name: string }) => i.name)).toEqual(['Chips', 'Cola']);
    const byProfit = await get(s.managerCookie, `/products${RANGE}&sort=profit&limit=1`);
    expect(byProfit.body.items.map((i: { name: string }) => i.name)).toEqual(['Cola']);
  });

  it('reports category performance, including uncategorised products', async () => {
    const s = await fixture();
    const res = await get(s.managerCookie, `/categories${RANGE}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({ categoryId: s.catId, name: 'Drinks', netRevenue: '19.00', grossProfit: '11.00' }),
      expect.objectContaining({ categoryId: null, name: 'Uncategorized', netRevenue: '14.50', grossProfit: '2.50' }),
    ]);
    const total = res.body.items.reduce((acc: number, i: { netRevenue: string }) => acc + cents(i.netRevenue), 0);
    expect(total).toBe(3350);
  });

  it('values inventory at average cost, falling back to the cost price', async () => {
    const s = await fixture();
    // Stock now: Cola 98 (100 - 2 - 1 + 1 restocked), Chips 96 (100 - 3 - 1, damaged return not restocked).
    const res = await get(s.managerCookie, '/inventory');
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ units: 194, productsWithStock: 2, costValue: '680.00', retailValue: '1460.00' });
    expect(res.body.categories).toEqual([
      { categoryId: s.catId, name: 'Drinks', units: 98, costValue: '392.00', retailValue: '980.00' },
      { categoryId: null, name: 'Uncategorized', units: 96, costValue: '288.00', retailValue: '480.00' },
    ]);
    expect(res.body.lowStock.total).toBe(0);

    await prisma.product.update({ where: { id: s.A }, data: { averageCost: 5.5 } });
    const again = await get(s.managerCookie, '/inventory');
    expect(again.body.totals.costValue).toBe('827.00'); // 98 x 5.50 + 96 x 3.00
  });
});

describe('dashboard and exports', () => {
  it('shows the same numbers as the reports', async () => {
    const s = await fixture();
    const dash = await get(s.managerCookie, `/dashboard${RANGE}`);
    const summary = await get(s.managerCookie, `/summary${RANGE}`);
    const products = await get(s.managerCookie, `/products${RANGE}`);
    const categories = await get(s.managerCookie, `/categories${RANGE}`);
    const inventory = await get(s.managerCookie, '/inventory');

    expect(dash.status).toBe(200);
    expect(dash.body.summary.totals).toEqual(summary.body.totals);
    expect(dash.body.summary.series).toEqual(summary.body.series);
    expect(dash.body.topProducts).toEqual(products.body.items);
    expect(dash.body.categories).toEqual(categories.body.items);
    expect(dash.body.inventory).toEqual(inventory.body.totals);
    expect(dash.body.pendingPurchases).toEqual({ awaitingApproval: 0, awaitingDelivery: 0 });
    expect(dash.body.recentSales).toHaveLength(3);
    expect(dash.body.lowStock.total).toBe(0);
  });

  it('exports CSV files that agree with the reports and neutralise formulas', async () => {
    const s = await fixture();
    const summary = (await get(s.managerCookie, `/summary${RANGE}`)).body;

    const sales = await get(s.managerCookie, `/export/sales${RANGE}`);
    expect(sales.status).toBe(200);
    expect(sales.headers['content-type']).toContain('text/csv');
    expect(sales.headers['content-disposition']).toContain('sales-2026-11-01_to_2026-11-03.csv');
    const rows = csvRows(sales.text);
    expect(rows[0]![0]).toBe('Period');
    expect(rows).toHaveLength(5); // header + 3 days + total
    summary.series.forEach((day: { bucket: string; salesCount: number; netSales: string; grossProfit: string }, i: number) => {
      expect(rows[i + 1]![0]).toBe(day.bucket);
      expect(rows[i + 1]![1]).toBe(String(day.salesCount));
      expect(rows[i + 1]![9]).toBe(day.netSales);
      expect(rows[i + 1]![11]).toBe(day.grossProfit);
    });
    expect(rows[4]![0]).toBe('Total');
    expect(rows[4]![9]).toBe(summary.totals.netSales);
    expect(rows[4]![11]).toBe(summary.totals.grossProfit);

    const evil = await createProduct(app, s.owner.cookie, { name: '=1+1', sellingPrice: 1, costPrice: 1 });
    await addStock(s.owner.cookie, evil, 5);
    await sell(s.cashierCookie, [{ productId: evil, quantity: 1 }], '2026-11-02T05:00:00Z');

    const products = await get(s.managerCookie, `/export/products${RANGE}`);
    const lines = csvLines(products.text);
    expect(lines[0]).toContain('Net revenue (ex tax)');
    expect(lines.some((l) => l.startsWith("'=1+1,"))).toBe(true); // formula neutralised
    expect(lines.some((l) => l.startsWith('=1+1'))).toBe(false);
    const cola = csvRows(products.text).find((r) => r[0] === 'Cola');
    expect(cola?.slice(2)).toEqual(['3', '1', '2', '19.00', '8.00', '11.00']);

    const inventory = await get(s.managerCookie, '/export/inventory');
    expect(csvLines(inventory.text)).toHaveLength(4); // header + 2 categories + total
    expect(inventory.headers['content-disposition']).toContain('inventory-valuation-');

    const returns = await get(s.managerCookie, `/export/returns${RANGE}`);
    expect(csvLines(returns.text)).toHaveLength(3); // header + 2 returned lines
    expect(csvLines(returns.text)[0]).toContain('Restocked');
    const purchases = await get(s.managerCookie, `/export/purchases${RANGE}`);
    expect(csvLines(purchases.text)).toHaveLength(1); // header only
  });
});

describe('access, isolation and validation', () => {
  it('lets managers and owners read reports, and blocks cashiers everywhere', async () => {
    const s = await fixture();
    const paths = ['/summary', '/products', '/categories', '/inventory', '/dashboard', '/export/sales', '/export/products'];
    for (const path of paths) {
      expect((await get(s.cashierCookie, path)).status).toBe(403);
      expect((await get(s.managerCookie, path)).status).toBe(200);
      expect((await get(s.owner.cookie, path)).status).toBe(200);
    }
  });

  it("never mixes in another store's data", async () => {
    const s = await fixture();
    const b = await registerOwner(app, 'b');
    const mine = await createProduct(app, b.cookie, { name: 'Other Store Item' });
    await addStock(b.cookie, mine, 3);

    const summary = await get(b.cookie, `/summary${RANGE}`);
    expect(summary.body.totals).toMatchObject({ salesCount: 0, netSales: '0.00' });
    expect((await get(b.cookie, `/products${RANGE}`)).body.items).toEqual([]);
    const inventory = await get(b.cookie, '/inventory');
    expect(inventory.body.totals.units).toBe(3);

    const csv = await get(b.cookie, `/export/products${RANGE}`);
    expect(csv.text).not.toContain('Cola');
    const forged = await request(app)
      .get(`/api/v1/reports/summary${RANGE}`)
      .set('Cookie', b.cookie)
      .set('X-Store-Id', s.owner.storeId);
    expect(forged.status).toBe(403);
  });

  it('rejects invalid ranges, groups and options', async () => {
    const s = await fixture();
    const bad = [
      '/summary?from=2026-02-31&to=2026-03-01',
      '/summary?from=nope&to=2026-03-01',
      '/summary?from=2026-03-01',
      '/summary?to=2026-03-01',
      '/summary?from=2026-03-05&to=2026-03-01',
      '/summary?from=2024-01-01&to=2026-11-01', // more than 731 days
      '/summary?group=hour',
      '/summary?from=2025-01-01&to=2026-02-05', // 401 days is too many for daily grouping
      '/dashboard?from=2025-01-01&to=2026-02-05',
      '/products?limit=0',
      '/products?limit=101',
      '/products?sort=bogus',
      '/export/nope',
    ];
    for (const path of bad) {
      const res = await get(s.managerCookie, path);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const months = await get(s.managerCookie, '/summary?from=2025-01-01&to=2026-02-05&group=month');
    expect(months.status).toBe(200);
    expect(months.body.series).toHaveLength(14);
  });

  it('requires authentication', async () => {
    for (const path of ['/summary', '/products', '/categories', '/inventory', '/dashboard', '/export/sales']) {
      expect((await request(app).get(`/api/v1/reports${path}`)).status).toBe(401);
    }
  });
});