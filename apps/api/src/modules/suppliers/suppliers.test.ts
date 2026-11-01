import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/prisma';
import { resetDb } from '../../test/db';
import { addMember, loginAs, registerOwner } from '../../test/helpers';

const app = createApp({ authRateLimitMax: 1000 });
beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

const create = (cookie: string, body: Record<string, unknown>) =>
  request(app).post('/api/v1/suppliers').set('Cookie', cookie).send(body);
const list = (cookie: string, query = '') =>
  request(app).get(`/api/v1/suppliers${query}`).set('Cookie', cookie);

async function team(tag: string) {
  const owner = await registerOwner(app, tag);
  const manager = await addMember(app, owner.cookie, 'MANAGER', tag);
  const cashier = await addMember(app, owner.cookie, 'CASHIER', tag);
  return {
    owner,
    managerCookie: await loginAs(app, manager.email),
    cashierCookie: await loginAs(app, cashier.email),
  };
}

describe('suppliers', () => {
  it('creates supplier details and returns orderCount', async () => {
    const s = await team('supplier-create');
    const res = await create(s.managerCookie, {
      name: ' Acme Traders ',
      contactName: 'Rahim',
      email: 'sales@acme.test',
      phone: '+880 1712',
      leadTimeDays: 5,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Acme Traders',
      contactName: 'Rahim',
      leadTimeDays: 5,
      isActive: true,
      orderCount: 0,
    });
    expect(
      (await request(app).get(`/api/v1/suppliers/${res.body.id}`).set('Cookie', s.managerCookie))
        .status,
    ).toBe(200);
  });

  it('enforces roles and strict validation', async () => {
    const s = await team('supplier-validation');
    expect((await create(s.cashierCookie, { name: 'Nope' })).status).toBe(403);
    for (const value of [
      { name: '' },
      { name: 'X', email: 'bad' },
      { name: 'X', leadTimeDays: 366 },
      { name: 'X', storeId: 'bad' },
      { name: 'X', isActive: false },
    ]) {
      expect((await create(s.managerCookie, value)).status).toBe(400);
    }
  });

  it('rejects duplicate names case-insensitively per store', async () => {
    const a = await registerOwner(app, 'supplier-a');
    const b = await registerOwner(app, 'supplier-b');
    expect((await create(a.cookie, { name: 'Acme' })).status).toBe(201);
    expect((await create(a.cookie, { name: 'acme' })).status).toBe(409);
    expect((await create(b.cookie, { name: 'Acme' })).status).toBe(201);
  });

  it('searches, filters and paginates', async () => {
    const s = await team('supplier-list');
    await create(s.owner.cookie, { name: 'Alpha Foods', contactName: 'Sam' });
    const beta = await create(s.owner.cookie, { name: 'Beta Tech' });
    await create(s.owner.cookie, { name: 'Gamma' });
    await request(app)
      .patch(`/api/v1/suppliers/${beta.body.id}`)
      .set('Cookie', s.owner.cookie)
      .send({ isActive: false });
    expect((await list(s.owner.cookie)).body.items.map((x: { name: string }) => x.name)).toEqual([
      'Alpha Foods',
      'Gamma',
    ]);
    expect((await list(s.owner.cookie, '?status=archived')).body.total).toBe(1);
    expect((await list(s.owner.cookie, '?search=sam')).body.total).toBe(1);
    expect((await list(s.owner.cookie, '?pageSize=1&page=2')).body.totalPages).toBe(2);
  });

  it('updates, archives and restores suppliers', async () => {
    const s = await team('supplier-update');
    const created = await create(s.managerCookie, { name: 'Old', email: '' });
    const archived = await request(app)
      .patch(`/api/v1/suppliers/${created.body.id}`)
      .set('Cookie', s.managerCookie)
      .send({ isActive: false, notes: '' });
    expect(archived.body).toMatchObject({ isActive: false, notes: null });
    const restored = await request(app)
      .patch(`/api/v1/suppliers/${created.body.id}`)
      .set('Cookie', s.managerCookie)
      .send({ isActive: true, name: 'New' });
    expect(restored.body).toMatchObject({ isActive: true, name: 'New' });
  });

  it('isolates stores and requires authentication', async () => {
    const a = await registerOwner(app, 'supplier-isolation-a');
    const b = await registerOwner(app, 'supplier-isolation-b');
    const created = await create(a.cookie, { name: 'Secret' });
    expect(
      (await request(app).get(`/api/v1/suppliers/${created.body.id}`).set('Cookie', b.cookie))
        .status,
    ).toBe(404);
    expect((await list(b.cookie)).body.total).toBe(0);
    expect((await request(app).get('/api/v1/suppliers')).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/suppliers/not-uuid').set('Cookie', a.cookie)).status,
    ).toBe(400);
    expect(await prisma.supplier.count()).toBe(1);
  });
});
