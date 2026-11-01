import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/prisma';
import { resetDb } from '../../test/db';
import { addMember, loginAs, registerOwner } from '../../test/helpers';

const app = createApp({ authRateLimitMax: 1000 });
beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

async function setup(tag: string) {
  const owner = await registerOwner(app, tag);
  const manager = await addMember(app, owner.cookie, 'MANAGER', tag);
  return { owner, managerCookie: await loginAs(app, manager.email) };
}
async function supplier(cookie: string, name = 'Acme') {
  return request(app).post('/api/v1/suppliers').set('Cookie', cookie).send({ name });
}
async function product(cookie: string, sku = 'ITEM-1') {
  return request(app)
    .post('/api/v1/products')
    .set('Cookie', cookie)
    .send({
      name: `Item ${sku}`,
      sku,
      costPrice: 2,
      sellingPrice: 4,
    });
}
async function order(cookie: string, supplierId: string, productId: string) {
  return request(app)
    .post('/api/v1/purchase-orders')
    .set('Cookie', cookie)
    .send({
      supplierId,
      lines: [{ productId, quantityOrdered: 3, unitCost: 2.5 }],
    });
}

describe('suppliers', () => {
  it('creates and lists active suppliers', async () => {
    const { managerCookie } = await setup('supplier-list');
    const created = await supplier(managerCookie);
    const list = await request(app).get('/api/v1/suppliers').set('Cookie', managerCookie);
    expect(created.status).toBe(201);
    expect(list.body.items).toHaveLength(1);
  });
  it('rejects cashier access', async () => {
    const owner = await registerOwner(app, 'supplier-cashier');
    const cashier = await addMember(app, owner.cookie, 'CASHIER', 'supplier-cashier');
    expect(
      (
        await request(app)
          .get('/api/v1/suppliers')
          .set('Cookie', await loginAs(app, cashier.email))
      ).status,
    ).toBe(403);
  });
  it('rejects duplicate supplier names', async () => {
    const { managerCookie } = await setup('supplier-duplicate');
    await supplier(managerCookie);
    expect((await supplier(managerCookie, 'acme')).status).toBe(409);
  });
  it('archives without deleting', async () => {
    const { managerCookie } = await setup('supplier-archive');
    const created = await supplier(managerCookie);
    expect(
      (
        await request(app)
          .patch(`/api/v1/suppliers/${created.body.id}`)
          .set('Cookie', managerCookie)
          .send({ isActive: false })
      ).status,
    ).toBe(200);
    expect(
      (await request(app).get('/api/v1/suppliers').set('Cookie', managerCookie)).body.items,
    ).toHaveLength(0);
    expect(
      (await request(app).get('/api/v1/suppliers?status=all').set('Cookie', managerCookie)).body
        .items,
    ).toHaveLength(1);
  });
  it('updates supplier contact details', async () => {
    const { managerCookie } = await setup('supplier-update');
    const created = await supplier(managerCookie);
    const updated = await request(app)
      .patch(`/api/v1/suppliers/${created.body.id}`)
      .set('Cookie', managerCookie)
      .send({ phone: 'free text 123' });
    expect(updated.body.phone).toBe('free text 123');
  });
  it('rejects unknown supplier fields', async () => {
    const { managerCookie } = await setup('supplier-strict');
    expect((await supplier(managerCookie, 'Acme')).status).toBe(201);
    expect(
      (
        await request(app)
          .post('/api/v1/suppliers')
          .set('Cookie', managerCookie)
          .send({ name: 'Other', storeId: 'x' })
      ).status,
    ).toBe(400);
  });
});

describe('purchase orders', () => {
  it('creates a numbered order and computes decimal totals', async () => {
    const { managerCookie } = await setup('po-create');
    const s = await supplier(managerCookie);
    const p = await product(managerCookie);
    const created = await order(managerCookie, s.body.id, p.body.id);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ number: 1, status: 'DRAFT', total: '7.50' });
    expect(created.body.items[0].quantityReceived).toBe(0);
  });
  it('increments order numbers per store', async () => {
    const { managerCookie } = await setup('po-numbers');
    const s = await supplier(managerCookie);
    const p = await product(managerCookie);
    expect((await order(managerCookie, s.body.id, p.body.id)).body.number).toBe(1);
    expect((await order(managerCookie, s.body.id, p.body.id)).body.number).toBe(2);
  });
  it('does not allow archived suppliers on new orders', async () => {
    const { managerCookie } = await setup('po-archived');
    const s = await supplier(managerCookie);
    const p = await product(managerCookie);
    await request(app)
      .patch(`/api/v1/suppliers/${s.body.id}`)
      .set('Cookie', managerCookie)
      .send({ isActive: false });
    expect((await order(managerCookie, s.body.id, p.body.id)).status).toBe(409);
  });
  it('edits draft line items', async () => {
    const { managerCookie } = await setup('po-edit');
    const s = await supplier(managerCookie);
    const p = await product(managerCookie);
    const created = await order(managerCookie, s.body.id, p.body.id);
    const updated = await request(app)
      .patch(`/api/v1/purchase-orders/${created.body.id}`)
      .set('Cookie', managerCookie)
      .send({
        supplierId: s.body.id,
        lines: [{ productId: p.body.id, quantityOrdered: 8, unitCost: 1.25 }],
      });
    expect(updated.body.total).toBe('10.00');
  });
  it('rejects editing after submit', async () => {
    const { managerCookie } = await setup('po-edit-state');
    const s = await supplier(managerCookie);
    const p = await product(managerCookie);
    const created = await order(managerCookie, s.body.id, p.body.id);
    await request(app)
      .post(`/api/v1/purchase-orders/${created.body.id}/submit`)
      .set('Cookie', managerCookie);
    expect(
      (
        await request(app)
          .patch(`/api/v1/purchase-orders/${created.body.id}`)
          .set('Cookie', managerCookie)
          .send({
            supplierId: s.body.id,
            lines: [{ productId: p.body.id, quantityOrdered: 1, unitCost: 1 }],
          })
      ).status,
    ).toBe(409);
  });
  it('submits only drafts', async () => {
    const { managerCookie } = await setup('po-submit');
    const s = await supplier(managerCookie);
    const p = await product(managerCookie);
    const created = await order(managerCookie, s.body.id, p.body.id);
    expect(
      (
        await request(app)
          .post(`/api/v1/purchase-orders/${created.body.id}/submit`)
          .set('Cookie', managerCookie)
      ).body.status,
    ).toBe('SUBMITTED');
    expect(
      (
        await request(app)
          .post(`/api/v1/purchase-orders/${created.body.id}/submit`)
          .set('Cookie', managerCookie)
      ).status,
    ).toBe(409);
  });
  it('only owners approve', async () => {
    const { owner, managerCookie } = await setup('po-approve-role');
    const s = await supplier(managerCookie);
    const p = await product(managerCookie);
    const created = await order(managerCookie, s.body.id, p.body.id);
    await request(app)
      .post(`/api/v1/purchase-orders/${created.body.id}/submit`)
      .set('Cookie', managerCookie);
    expect(
      (
        await request(app)
          .post(`/api/v1/purchase-orders/${created.body.id}/approve`)
          .set('Cookie', managerCookie)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/v1/purchase-orders/${created.body.id}/approve`)
          .set('Cookie', owner.cookie)
      ).body.status,
    ).toBe('APPROVED');
  });
  it('cancels drafts, submitted and approved orders', async () => {
    const { owner, managerCookie } = await setup('po-cancel');
    const s = await supplier(managerCookie);
    const p = await product(managerCookie, 'CANCEL-1');
    const draft = await order(managerCookie, s.body.id, p.body.id);
    expect(
      (
        await request(app)
          .post(`/api/v1/purchase-orders/${draft.body.id}/cancel`)
          .set('Cookie', managerCookie)
      ).body.status,
    ).toBe('CANCELLED');
    const submitted = await order(managerCookie, s.body.id, p.body.id);
    await request(app)
      .post(`/api/v1/purchase-orders/${submitted.body.id}/submit`)
      .set('Cookie', managerCookie);
    expect(
      (
        await request(app)
          .post(`/api/v1/purchase-orders/${submitted.body.id}/cancel`)
          .set('Cookie', owner.cookie)
      ).body.status,
    ).toBe('CANCELLED');
  });
  it('rejects duplicate products in lines', async () => {
    const { managerCookie } = await setup('po-duplicate-lines');
    const s = await supplier(managerCookie);
    const p = await product(managerCookie);
    expect(
      (
        await request(app)
          .post('/api/v1/purchase-orders')
          .set('Cookie', managerCookie)
          .send({
            supplierId: s.body.id,
            lines: [
              { productId: p.body.id, quantityOrdered: 1, unitCost: 1 },
              { productId: p.body.id, quantityOrdered: 2, unitCost: 1 },
            ],
          })
      ).status,
    ).toBe(400);
  });
  it('rejects body fields owned by the server', async () => {
    const { managerCookie } = await setup('po-strict');
    const s = await supplier(managerCookie);
    const p = await product(managerCookie);
    expect(
      (
        await request(app)
          .post('/api/v1/purchase-orders')
          .set('Cookie', managerCookie)
          .send({
            supplierId: s.body.id,
            status: 'APPROVED',
            lines: [{ productId: p.body.id, quantityOrdered: 1, unitCost: 1 }],
          })
      ).status,
    ).toBe(400);
  });
  it('isolates orders between stores', async () => {
    const a = await setup('po-store-a');
    const b = await setup('po-store-b');
    const s = await supplier(b.managerCookie);
    const p = await product(b.managerCookie);
    const created = await order(b.managerCookie, s.body.id, p.body.id);
    expect(
      (
        await request(app)
          .get(`/api/v1/purchase-orders/${created.body.id}`)
          .set('Cookie', a.managerCookie)
      ).status,
    ).toBe(404);
  });
  it('rejects inactive products', async () => {
    const { owner, managerCookie } = await setup('po-inactive');
    const s = await supplier(managerCookie);
    const p = await product(managerCookie);
    await request(app).delete(`/api/v1/products/${p.body.id}`).set('Cookie', owner.cookie);
    expect((await order(managerCookie, s.body.id, p.body.id)).status).toBe(400);
  });
});
