import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/prisma';
import { resetDb } from '../../test/db';
import {
  addMember,
  cookieFrom,
  createProduct,
  createSupplier,
  loginAs,
  PASSWORD,
  registerOwner,
} from '../../test/helpers';

const app = createApp({ authRateLimitMax: 1000, aiProvider: null });

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

let counter = 0;
const nextKey = () => `audit-key-${Date.now()}-${++counter}`;

const post = (cookie: string, path: string, body: object = {}) =>
  request(app).post(`/api/v1${path}`).set('Cookie', cookie).send(body);
const patch = (cookie: string, path: string, body: object = {}) =>
  request(app).patch(`/api/v1${path}`).set('Cookie', cookie).send(body);
const del = (cookie: string, path: string) => request(app).delete(`/api/v1${path}`).set('Cookie', cookie);
const logs = (cookie: string, query = '') => request(app).get(`/api/v1/audit-logs${query}`).set('Cookie', cookie);

interface Entry {
  action: string;
  actorName: string;
  actorRole: string;
  actorUserId: string;
  resourceType: string | null;
  resourceId: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
const entries = (res: request.Response): Entry[] => res.body.items;

describe('what is recorded', () => {
  it('records sign-in events, never passwords or tokens, and ignores unknown accounts', async () => {
    const owner = await registerOwner(app, 'a');
    const login = await request(app).post('/api/v1/auth/login').send({ email: owner.email, password: PASSWORD });
    expect(login.status).toBe(200);
    const token = cookieFrom(login).split('=')[1]!;

    const wrong = await request(app).post('/api/v1/auth/login').send({ email: owner.email, password: 'WrongPassword123' });
    expect(wrong.status).toBe(401);

    const before = await prisma.auditLog.count();
    const unknown = await request(app).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'WrongPassword123' });
    expect(unknown.status).toBe(401);
    expect(await prisma.auditLog.count()).toBe(before);

    expect((await request(app).post('/api/v1/auth/logout').set('Cookie', cookieFrom(login))).status).toBe(204);
    const viewer = await loginAs(app, owner.email);

    const res = await logs(viewer, '?pageSize=100');
    expect(res.status).toBe(200);
    const count = (action: string) => entries(res).filter((e) => e.action === action).length;
    expect(count('auth.register')).toBe(1);
    expect(count('auth.login')).toBe(2);
    expect(count('auth.login_failed')).toBe(1);
    expect(count('auth.logout')).toBe(1);
    expect(entries(res)[0]).toMatchObject({ actorName: 'Owner a', actorRole: 'OWNER', actorUserId: owner.userId });

    const stored = JSON.stringify(await prisma.auditLog.findMany());
    for (const secret of [PASSWORD, 'WrongPassword123', token, owner.email, 'nobody@example.com']) {
      expect(stored).not.toContain(secret);
    }
  });

  it('records the important actions with actor, resource and a safe summary', async () => {
    const owner = await registerOwner(app, 'a');
    const manager = await addMember(app, owner.cookie, 'MANAGER', 'a');
    const cashier = await addMember(app, owner.cookie, 'CASHIER', 'a');
    const third = await addMember(app, owner.cookie, 'CASHIER', 'b');
    const managerCookie = await loginAs(app, manager.email);
    const cashierCookie = await loginAs(app, cashier.email);

    expect((await post(owner.cookie, '/categories', { name: 'Drinks' })).status).toBe(201);
    const supplierId = await createSupplier(app, owner.cookie);
    const productId = await createProduct(app, owner.cookie, { name: 'Cola', sku: 'COLA-1', sellingPrice: 10, costPrice: 4 });
    expect((await patch(owner.cookie, `/products/${productId}`, { sellingPrice: 12 })).status).toBe(200);
    expect((await patch(owner.cookie, `/products/${productId}`, { isActive: false })).status).toBe(200);
    expect((await patch(owner.cookie, `/products/${productId}`, { isActive: true })).status).toBe(200);
    const spare = await createProduct(app, owner.cookie, { name: 'Spare', sku: 'SPARE-1' });
    expect((await del(owner.cookie, `/products/${spare}`)).status).toBe(204);
    expect((await post(owner.cookie, '/inventory/movements', { productId, type: 'OPENING', quantity: 20, idempotencyKey: nextKey() })).status).toBe(201);
    expect((await patch(owner.cookie, `/users/${third.userId}/role`, { role: 'MANAGER' })).status).toBe(200);
    expect((await patch(owner.cookie, '/settings', { taxRatePercent: 5, receiptFooter: 'Thanks for shopping' })).status).toBe(200);

    const po = await post(owner.cookie, '/purchases', { supplierId, items: [{ productId, quantityOrdered: 5, unitCost: 4 }] });
    expect(po.status).toBe(201);
    expect((await post(managerCookie, `/purchases/${po.body.id}/submit`)).status).toBe(200);
    expect((await post(owner.cookie, `/purchases/${po.body.id}/approve`)).status).toBe(200);
    expect((await post(managerCookie, `/purchases/${po.body.id}/receive`, { idempotencyKey: nextKey(), items: [{ productId, quantity: 5 }] })).status).toBe(201);

    const sale = await post(cashierCookie, '/sales', {
      idempotencyKey: nextKey(),
      items: [{ productId, quantity: 2 }],
      payment: { method: 'CASH', amountTendered: 1000 },
    });
    expect(sale.status).toBe(201);
    const ret = await post(managerCookie, '/returns', {
      saleId: sale.body.id,
      idempotencyKey: nextKey(),
      items: [{ productId, quantity: 1, restock: true, reason: 'CHANGED_MIND' }],
    });
    expect(ret.status).toBe(201);
    expect((await post(owner.cookie, `/forecasting/products/${productId}/dismiss`)).status).toBe(201);
    expect((await request(app).get('/api/v1/reports/export/sales').set('Cookie', owner.cookie)).status).toBe(200);

    const res = await logs(owner.cookie, '?pageSize=100');
    expect(res.status).toBe(200);
    const list = entries(res);
    const expected = [
      'auth.register', 'user.create', 'auth.login', 'category.create', 'supplier.create', 'product.create',
      'product.update', 'product.archive', 'product.restore', 'product.delete', 'inventory.movement',
      'user.role_change', 'settings.update', 'purchase.create', 'purchase.submit', 'purchase.approve',
      'purchase.receive', 'sale.create', 'return.create', 'reorder.dismiss', 'export.download',
    ];
    for (const action of expected) expect(list.map((e) => e.action)).toContain(action);

    expect(list.find((e) => e.action === 'product.create' && e.resourceId === productId)).toMatchObject({
      actorName: 'Owner a',
      actorRole: 'OWNER',
      resourceType: 'Product',
      summary: 'Created product "Cola" (COLA-1)',
    });
    expect(list.find((e) => e.action === 'product.update')!.summary).toContain('sellingPrice');

    const move = list.find((e) => e.action === 'inventory.movement')!;
    expect(move.summary).toBe('Opening stock: +20 unit(s) of "Cola" (0 -> 20)');
    expect(move.metadata).toMatchObject({ quantityChange: 20, quantityBefore: 0, quantityAfter: 20 });

    const sold = list.find((e) => e.action === 'sale.create')!;
    expect(sold).toMatchObject({ actorName: 'CASHIER a', actorRole: 'CASHIER', resourceType: 'Sale', resourceId: sale.body.id });
    expect(sold.summary).toContain('S-000001');
    expect(list.find((e) => e.action === 'return.create')!.summary).toContain('R-000001');
    expect(list.find((e) => e.action === 'purchase.receive')!.summary).toContain('PO-0001');
    expect(list.find((e) => e.action === 'user.role_change')!.summary).toContain('MANAGER');

    const settings = list.find((e) => e.action === 'settings.update')!;
    expect(settings.summary).toContain('receiptFooter');
    expect(settings.metadata).toMatchObject({ values: { taxRatePercent: 5 } });
    expect(JSON.stringify(settings.metadata)).not.toContain('Thanks for shopping');

    expect(JSON.stringify(res.body)).not.toContain('@example.com');
    const times = list.map((e) => e.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('does not log failed, forbidden, duplicate or read-only requests, or replays', async () => {
    const owner = await registerOwner(app, 'a');
    const cashier = await addMember(app, owner.cookie, 'CASHIER', 'a');
    const cashierCookie = await loginAs(app, cashier.email);
    const productId = await createProduct(app, owner.cookie, { name: 'Dup', sku: 'DUP-1', sellingPrice: 2, costPrice: 1 });
    await post(owner.cookie, '/inventory/movements', { productId, type: 'OPENING', quantity: 10, idempotencyKey: nextKey() });
    const before = await prisma.auditLog.count();

    expect((await post(owner.cookie, '/products', { name: '' })).status).toBe(400);
    expect((await post(cashierCookie, '/products', { name: 'X', sku: 'X-1', costPrice: 1, sellingPrice: 2 })).status).toBe(403);
    expect((await post(owner.cookie, '/products', { name: 'Again', sku: 'DUP-1', costPrice: 1, sellingPrice: 2 })).status).toBe(409);
    for (const path of ['/products', '/reports/summary', '/audit-logs', '/ai/status']) {
      expect((await request(app).get(`/api/v1${path}`).set('Cookie', owner.cookie)).status).toBe(200);
    }
    expect((await post(owner.cookie, '/ai/ask', { question: 'What was my gross profit this week?' })).status).toBe(200);

    const sale = { idempotencyKey: 'audit-replay-0001', items: [{ productId, quantity: 1 }], payment: { method: 'CASH', amountTendered: 10 } };
    expect((await post(cashierCookie, '/sales', sale)).status).toBe(201);
    expect((await post(cashierCookie, '/sales', sale)).status).toBe(200);

    expect(await prisma.auditLog.count()).toBe(before + 1);
    expect(await prisma.auditLog.count({ where: { action: 'sale.create' } })).toBe(1);
  });
});

describe('viewing, filtering and protecting the log', () => {
  it('filters by action, person, resource and date, pages, and rejects bad parameters', async () => {
    const owner = await registerOwner(app, 'a');
    const manager = await addMember(app, owner.cookie, 'MANAGER', 'a');
    const managerCookie = await loginAs(app, manager.email);
    const first = await createProduct(app, owner.cookie, { name: 'One' });
    await createProduct(app, owner.cookie, { name: 'Two' });
    await createProduct(app, owner.cookie, { name: 'Three' });
    await post(owner.cookie, '/categories', { name: 'Drinks' });
    expect(managerCookie).toBeTruthy();

    const total = (await logs(owner.cookie)).body.total as number;
    const totalOf = async (query: string) => (await logs(owner.cookie, query)).body.total as number;

    expect(await totalOf('?action=product')).toBe(3);
    expect(await totalOf('?action=product.create')).toBe(3);
    expect(await totalOf('?action=category.create')).toBe(1);
    expect(await totalOf('?action=category')).toBe(1);
    expect(await totalOf('?action=product.update')).toBe(0);
    expect(await totalOf(`?actorUserId=${manager.userId}`)).toBe(1);
    expect(await totalOf('?resourceType=Product')).toBe(3);
    expect(await totalOf(`?resourceId=${first}`)).toBe(1);

    const today = new Date().toISOString().slice(0, 10);
    expect(await totalOf(`?from=${today}&to=${today}`)).toBe(total);
    expect(await totalOf('?from=2000-01-01&to=2000-01-02')).toBe(0);

    const page2 = await logs(owner.cookie, '?pageSize=2&page=2');
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.totalPages).toBe(Math.ceil(total / 2));

    const bad = [
      '?action=Bad Action!', '?action=a.b.c', '?pageSize=1000', '?pageSize=0', '?page=0', '?from=2026-11-01',
      '?from=2026-11-05&to=2026-11-01', '?from=2026-02-31&to=2026-03-01', '?from=2020-01-01&to=2026-11-01',
      '?actorUserId=nope', '?resourceType=1;DROP', '?resourceId=%27',
    ];
    for (const query of bad) {
      const res = await logs(owner.cookie, query);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }

    const actions = await request(app).get('/api/v1/audit-logs/actions').set('Cookie', owner.cookie);
    expect(actions.status).toBe(200);
    expect(actions.body.items.find((a: { action: string }) => a.action === 'product.create')).toMatchObject({
      label: 'Product created',
      category: 'product',
    });
  });

  it('cannot be edited or deleted, by the API or by the database', async () => {
    const owner = await registerOwner(app, 'a');
    await createProduct(app, owner.cookie);
    const total = await prisma.auditLog.count();
    expect(total).toBeGreaterThanOrEqual(2);
    const first = await prisma.auditLog.findFirstOrThrow();

    await expect(prisma.auditLog.update({ where: { id: first.id }, data: { summary: 'tampered' } })).rejects.toThrow();
    await expect(prisma.auditLog.updateMany({ data: { summary: 'tampered' } })).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: first.id } })).rejects.toThrow();
    await expect(prisma.auditLog.deleteMany()).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe('DELETE FROM "audit_logs"')).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE "audit_logs" SET "summary" = 'tampered'`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE "audit_logs"')).rejects.toThrow();

    expect(await prisma.auditLog.count()).toBe(total);
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: first.id } })).summary).toBe(first.summary);

    const attempts = [
      await request(app).post('/api/v1/audit-logs').set('Cookie', owner.cookie).send({ summary: 'x' }),
      await request(app).patch(`/api/v1/audit-logs/${first.id}`).set('Cookie', owner.cookie).send({ summary: 'x' }),
      await request(app).put(`/api/v1/audit-logs/${first.id}`).set('Cookie', owner.cookie).send({ summary: 'x' }),
      await request(app).delete(`/api/v1/audit-logs/${first.id}`).set('Cookie', owner.cookie),
    ];
    for (const res of attempts) expect(res.status).toBe(404);
    expect(await prisma.auditLog.count()).toBe(total);
  });

  it('is visible to the owner only, and each store sees only its own entries', async () => {
    const a = await registerOwner(app, 'a');
    const manager = await addMember(app, a.cookie, 'MANAGER', 'a');
    const cashier = await addMember(app, a.cookie, 'CASHIER', 'a');
    const managerCookie = await loginAs(app, manager.email);
    const cashierCookie = await loginAs(app, cashier.email);
    await createProduct(app, a.cookie, { name: 'Secret Product' });

    for (const cookie of [managerCookie, cashierCookie]) {
      expect((await logs(cookie)).status).toBe(403);
      expect((await request(app).get('/api/v1/audit-logs/actions').set('Cookie', cookie)).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/audit-logs')).status).toBe(401);
    expect((await request(app).get('/api/v1/audit-logs/actions')).status).toBe(401);

    const b = await registerOwner(app, 'b');
    await createProduct(app, b.cookie, { name: 'Other Product' });

    const mine = await logs(a.cookie, '?pageSize=100');
    const theirs = await logs(b.cookie, '?pageSize=100');
    expect(JSON.stringify(mine.body)).toContain('Secret Product');
    expect(JSON.stringify(mine.body)).not.toContain('Other Product');
    expect(JSON.stringify(theirs.body)).toContain('Other Product');
    expect(JSON.stringify(theirs.body)).not.toContain('Secret Product');
    expect(entries(theirs).every((e) => e.actorName !== 'Owner a')).toBe(true);

    const forged = await request(app).get('/api/v1/audit-logs').set('Cookie', b.cookie).set('X-Store-Id', a.storeId);
    expect(forged.status).toBe(403);
    const byActor = await logs(b.cookie, `?actorUserId=${a.userId}`);
    expect(byActor.body.total).toBe(0);
  });

  it('never blocks a request when the audit log cannot be written', async () => {
    const owner = await registerOwner(app, 'a');
    const failing = createApp({
      authRateLimitMax: 1000,
      aiProvider: null,
      auditWriter: async () => {
        throw new Error('disk full');
      },
    });
    const before = await prisma.auditLog.count();

    const res = await request(failing)
      .post('/api/v1/products')
      .set('Cookie', owner.cookie)
      .send({ name: 'Quiet', sku: 'QUIET-1', costPrice: 1, sellingPrice: 2 });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain('disk full');
    expect(await prisma.product.count({ where: { sku: 'QUIET-1' } })).toBe(1);
    expect(await prisma.auditLog.count()).toBe(before);
  });
});
