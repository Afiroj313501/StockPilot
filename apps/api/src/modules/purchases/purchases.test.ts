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
beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

async function setup(tag: string) {
  const owner = await registerOwner(app, tag);
  const manager = await addMember(app, owner.cookie, 'MANAGER', tag);
  const cashier = await addMember(app, owner.cookie, 'CASHIER', tag);
  return {
    owner,
    managerCookie: await loginAs(app, manager.email),
    cashierCookie: await loginAs(app, cashier.email),
    supplierId: await createSupplier(app, owner.cookie),
    productId: await createProduct(app, owner.cookie),
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

function body(s: Setup, overrides: Record<string, unknown> = {}) {
  return {
    supplierId: s.supplierId,
    notes: 'First order',
    expectedDate: '2026-12-01',
    items: [{ productId: s.productId, quantityOrdered: 3, unitCost: 2.5 }],
    ...overrides,
  };
}
const create = (cookie: string, value: Record<string, unknown>) =>
  request(app).post('/api/v1/purchases').set('Cookie', cookie).send(value);
const patch = (cookie: string, id: string, value: Record<string, unknown>) =>
  request(app).patch(`/api/v1/purchases/${id}`).set('Cookie', cookie).send(value);
const act = (cookie: string, id: string, action: string, value: Record<string, unknown> = {}) =>
  request(app).post(`/api/v1/purchases/${id}/${action}`).set('Cookie', cookie).send(value);

describe('purchases', () => {
  it('creates a draft with a server total and reference', async () => {
    const s = await setup('purchase-create');
    const res = await create(s.managerCookie, body(s));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      number: 1,
      reference: 'PO-0001',
      status: 'DRAFT',
      total: '7.50',
      expectedDate: '2026-12-01',
      itemCount: 1,
    });
    expect(res.body.items[0].quantityReceived).toBe(0);
  });

  it('rejects invalid dates, duplicate items and server-owned fields', async () => {
    const s = await setup('purchase-validation');
    for (const value of [
      { expectedDate: '2026-02-31' },
      {
        items: [
          { productId: s.productId, quantityOrdered: 1, unitCost: 1 },
          { productId: s.productId, quantityOrdered: 2, unitCost: 1 },
        ],
      },
      { status: 'APPROVED' },
      { number: 9 },
    ]) {
      expect((await create(s.managerCookie, body(s, value))).status).toBe(400);
    }
  });

  it('rejects archived suppliers and products', async () => {
    const s = await setup('purchase-archive');
    await request(app)
      .patch(`/api/v1/suppliers/${s.supplierId}`)
      .set('Cookie', s.owner.cookie)
      .send({ isActive: false });
    expect((await create(s.managerCookie, body(s))).status).toBe(409);
    const supplierId = await createSupplier(app, s.owner.cookie);
    await request(app)
      .patch(`/api/v1/products/${s.productId}`)
      .set('Cookie', s.managerCookie)
      .send({ isActive: false });
    expect((await create(s.managerCookie, body(s, { supplierId }))).status).toBe(409);
  });

  it('edits draft fields and items', async () => {
    const s = await setup('purchase-edit');
    const created = await create(s.managerCookie, body(s));
    const updated = await patch(s.managerCookie, created.body.id, {
      notes: '',
      items: [{ productId: s.productId, quantityOrdered: 4, unitCost: 1.25 }],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.total).toBe('5.00');
    expect(updated.body.notes).toBeNull();
  });

  it('does not edit after submission', async () => {
    const s = await setup('purchase-no-edit');
    const created = await create(s.managerCookie, body(s));
    await act(s.managerCookie, created.body.id, 'submit');
    expect((await patch(s.managerCookie, created.body.id, { notes: 'late' })).status).toBe(409);
  });

  it('submits only drafts and records the timestamp', async () => {
    const s = await setup('purchase-submit');
    const created = await create(s.managerCookie, body(s));
    const submitted = await act(s.managerCookie, created.body.id, 'submit');
    expect(submitted.body.status).toBe('SUBMITTED');
    expect(submitted.body.submittedAt).not.toBeNull();
    expect((await act(s.managerCookie, created.body.id, 'submit')).status).toBe(409);
  });

  it('allows only owners to approve submitted orders', async () => {
    const s = await setup('purchase-approve');
    const created = await create(s.managerCookie, body(s));
    await act(s.managerCookie, created.body.id, 'submit');
    expect((await act(s.managerCookie, created.body.id, 'approve')).status).toBe(403);
    const approved = await act(s.owner.cookie, created.body.id, 'approve');
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.approvedByName).toBe('Owner purchase-approve');
  });

  it('cancels draft, submitted and approved orders with a reason', async () => {
    const s = await setup('purchase-cancel');
    const draft = await create(s.managerCookie, body(s));
    expect(
      (await act(s.managerCookie, draft.body.id, 'cancel', { reason: 'Changed mind' })).body,
    ).toMatchObject({ status: 'CANCELLED', cancelReason: 'Changed mind' });
    const submitted = await create(s.managerCookie, body(s));
    await act(s.managerCookie, submitted.body.id, 'submit');
    expect((await act(s.managerCookie, submitted.body.id, 'cancel')).body.status).toBe('CANCELLED');
    const approved = await create(s.managerCookie, body(s));
    await act(s.managerCookie, approved.body.id, 'submit');
    await act(s.owner.cookie, approved.body.id, 'approve');
    expect((await act(s.managerCookie, approved.body.id, 'cancel')).body.status).toBe('CANCELLED');
  });

  it('lists with status, supplier and pagination filters', async () => {
    const s = await setup('purchase-list');
    const other = await createSupplier(app, s.owner.cookie);
    const first = await create(s.managerCookie, body(s));
    await create(s.managerCookie, body(s));
    await create(s.managerCookie, body(s, { supplierId: other }));
    await act(s.managerCookie, first.body.id, 'submit');
    const list = await request(app)
      .get('/api/v1/purchases?pageSize=2&page=2')
      .set('Cookie', s.managerCookie);
    expect(list.body).toMatchObject({ total: 3, totalPages: 2 });
    expect(
      (await request(app).get('/api/v1/purchases?status=SUBMITTED').set('Cookie', s.managerCookie))
        .body.total,
    ).toBe(1);
    expect(
      (
        await request(app)
          .get(`/api/v1/purchases?supplierId=${other}`)
          .set('Cookie', s.managerCookie)
      ).body.total,
    ).toBe(1);
  });

  it('returns purchase detail and supplier order counts', async () => {
    const s = await setup('purchase-detail');
    const created = await create(s.managerCookie, body(s));
    const detail = await request(app)
      .get(`/api/v1/purchases/${created.body.id}`)
      .set('Cookie', s.managerCookie);
    expect(detail.body.items[0]).toMatchObject({
      quantityRemaining: 3,
      unitCost: '2.50',
      lineTotal: '7.50',
    });
    const suppliers = await request(app).get('/api/v1/suppliers').set('Cookie', s.managerCookie);
    expect(suppliers.body.items[0].orderCount).toBe(1);
  });

  it('isolates stores and blocks cashiers', async () => {
    const s = await setup('purchase-isolation');
    const created = await create(s.managerCookie, body(s));
    const other = await registerOwner(app, 'purchase-other');
    expect(
      (await request(app).get(`/api/v1/purchases/${created.body.id}`).set('Cookie', other.cookie))
        .status,
    ).toBe(404);
    expect((await create(s.cashierCookie, body(s))).status).toBe(403);
    expect(
      (await request(app).get('/api/v1/purchases').set('Cookie', s.cashierCookie)).status,
    ).toBe(403);
  });

  it('allocates distinct numbers concurrently and never double-submits', async () => {
    const s = await setup('purchase-concurrency');
    const created = await Promise.all(
      Array.from({ length: 5 }, () => create(s.managerCookie, body(s))),
    );
    expect(created.every((res) => res.status === 201)).toBe(true);
    expect(created.map((res) => res.body.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    const id = created[0]!.body.id as string;
    const submissions = await Promise.all(
      Array.from({ length: 5 }, () => act(s.managerCookie, id, 'submit')),
    );
    expect(submissions.map((res) => res.status).sort()).toEqual([200, 409, 409, 409, 409]);
  });
});
