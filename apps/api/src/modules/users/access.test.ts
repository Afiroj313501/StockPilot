import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/prisma';
import { resetDb } from '../../test/db';
import { addMember, loginAs, PASSWORD, registerOwner } from '../../test/helpers';
import { hasRole } from '../auth/rbac';

const app = createApp({ authRateLimitMax: 1000 });

beforeEach(async () => resetDb());
afterAll(async () => prisma.$disconnect());

describe('hasRole', () => {
  it('ranks CASHIER < MANAGER < OWNER', () => {
    expect(hasRole('OWNER', 'MANAGER')).toBe(true);
    expect(hasRole('MANAGER', 'MANAGER')).toBe(true);
    expect(hasRole('MANAGER', 'OWNER')).toBe(false);
    expect(hasRole('CASHIER', 'MANAGER')).toBe(false);
  });
});

describe('store context', () => {
  it('returns the current store and role', async () => {
    const owner = await registerOwner(app, 'a');
    const res = await request(app).get('/api/v1/stores/current').set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: owner.storeId, name: 'Store a', role: 'OWNER' });
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/stores/current')).status).toBe(401);
  });

  it('accepts the member store through an explicit header', async () => {
    const owner = await registerOwner(app, 'header');
    const res = await request(app)
      .get('/api/v1/stores/current')
      .set('Cookie', owner.cookie)
      .set('X-Store-Id', owner.storeId);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(owner.storeId);
  });

  it('uses the same denial for foreign and unknown stores', async () => {
    const a = await registerOwner(app, 'a');
    const b = await registerOwner(app, 'b');
    const unknownId = '00000000-0000-4000-8000-000000000000';
    const other = await request(app)
      .get('/api/v1/stores/current')
      .set('Cookie', a.cookie)
      .set('X-Store-Id', b.storeId);
    const unknown = await request(app)
      .get('/api/v1/stores/current')
      .set('Cookie', a.cookie)
      .set('X-Store-Id', unknownId);
    expect(other.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(other.body.error.code).toBe('STORE_ACCESS_DENIED');
    expect(other.body.error.message).toBe(unknown.body.error.message);
  });
});

describe('user management RBAC', () => {
  it('lets an owner create a cashier who can log in without exposing the password', async () => {
    const owner = await registerOwner(app, 'a');
    const res = await request(app)
      .post('/api/v1/users')
      .set('Cookie', owner.cookie)
      .send({ name: 'Cash One', email: 'Cash@Example.com', password: PASSWORD, role: 'CASHIER' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('cash@example.com');
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    const cookie = await loginAs(app, 'cash@example.com');
    const store = await request(app).get('/api/v1/stores/current').set('Cookie', cookie);
    expect(store.body.role).toBe('CASHIER');
    expect(store.body.id).toBe(owner.storeId);
  });

  it('lists members of the store', async () => {
    const owner = await registerOwner(app, 'a');
    await addMember(app, owner.cookie, 'CASHIER', 'a');
    const res = await request(app).get('/api/v1/users').set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.map((item: { role: string }) => item.role).sort()).toEqual([
      'CASHIER',
      'OWNER',
    ]);
  });

  it('forbids managers and cashiers from managing users', async () => {
    const owner = await registerOwner(app, 'a');
    const manager = await addMember(app, owner.cookie, 'MANAGER', 'a');
    const cashier = await addMember(app, owner.cookie, 'CASHIER', 'a');
    for (const email of [manager.email, cashier.email]) {
      const cookie = await loginAs(app, email);
      expect((await request(app).get('/api/v1/users').set('Cookie', cookie)).status).toBe(403);
      expect(
        (
          await request(app)
            .post('/api/v1/users')
            .set('Cookie', cookie)
            .send({ name: 'X', email: 'x@example.com', password: PASSWORD, role: 'CASHIER' })
        ).status,
      ).toBe(403);
    }
    expect(await prisma.user.findUnique({ where: { email: 'x@example.com' } })).toBeNull();
  });

  it('rejects duplicate emails and owner assignment', async () => {
    const owner = await registerOwner(app, 'a');
    await addMember(app, owner.cookie, 'CASHIER', 'a');
    const duplicate = await request(app)
      .post('/api/v1/users')
      .set('Cookie', owner.cookie)
      .send({ name: 'Dup', email: 'cashier-a@example.com', password: PASSWORD, role: 'CASHIER' });
    const ownerRole = await request(app)
      .post('/api/v1/users')
      .set('Cookie', owner.cookie)
      .send({ name: 'Boss', email: 'boss@example.com', password: PASSWORD, role: 'OWNER' });
    expect(duplicate.status).toBe(409);
    expect(ownerRole.status).toBe(400);
    expect(ownerRole.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lets an owner change a cashier to manager', async () => {
    const owner = await registerOwner(app, 'a');
    const cashier = await addMember(app, owner.cookie, 'CASHIER', 'a');
    const res = await request(app)
      .patch(`/api/v1/users/${cashier.userId}/role`)
      .set('Cookie', owner.cookie)
      .send({ role: 'MANAGER' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('MANAGER');
  });

  it('rejects assigning an invalid role', async () => {
    const owner = await registerOwner(app, 'invalid-role');
    const res = await request(app)
      .post('/api/v1/users')
      .set('Cookie', owner.cookie)
      .send({ name: 'Invalid', email: 'invalid@example.com', password: PASSWORD, role: 'OWNER' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed target user ID', async () => {
    const owner = await registerOwner(app, 'invalid-id');
    const res = await request(app)
      .patch('/api/v1/users/not-a-uuid/role')
      .set('Cookie', owner.cookie)
      .send({ role: 'MANAGER' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('prevents self role changes and cashier escalation', async () => {
    const owner = await registerOwner(app, 'a');
    const self = await request(app)
      .patch(`/api/v1/users/${owner.userId}/role`)
      .set('Cookie', owner.cookie)
      .send({ role: 'CASHIER' });
    const cashier = await addMember(app, owner.cookie, 'CASHIER', 'a');
    const cashierCookie = await loginAs(app, cashier.email);
    const escalation = await request(app)
      .patch(`/api/v1/users/${cashier.userId}/role`)
      .set('Cookie', cashierCookie)
      .send({ role: 'MANAGER' });
    const membership = await prisma.storeMembership.findFirstOrThrow({
      where: { userId: cashier.userId },
    });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('CANNOT_CHANGE_OWN_ROLE');
    expect(escalation.status).toBe(403);
    expect(membership.role).toBe('CASHIER');
  });
});

describe('cross-store isolation', () => {
  it("only lists the owner's own store members", async () => {
    const a = await registerOwner(app, 'a');
    const b = await registerOwner(app, 'b');
    await addMember(app, b.cookie, 'CASHIER', 'b');
    const res = await request(app).get('/api/v1/users').set('Cookie', a.cookie);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].email).toBe(a.email);
  });

  it("cannot change another store's user's role", async () => {
    const a = await registerOwner(app, 'a');
    const b = await registerOwner(app, 'b');
    const cashierB = await addMember(app, b.cookie, 'CASHIER', 'b');
    const res = await request(app)
      .patch(`/api/v1/users/${cashierB.userId}/role`)
      .set('Cookie', a.cookie)
      .send({ role: 'MANAGER' });
    const membership = await prisma.storeMembership.findFirstOrThrow({
      where: { userId: cashierB.userId },
    });
    expect(res.status).toBe(404);
    expect(membership.role).toBe('CASHIER');
  });

  it("cannot change an unknown user's role", async () => {
    const owner = await registerOwner(app, 'unknown-user');
    const res = await request(app)
      .patch('/api/v1/users/00000000-0000-4000-8000-000000000000/role')
      .set('Cookie', owner.cookie)
      .send({ role: 'MANAGER' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('cannot create users in another store using X-Store-Id', async () => {
    const a = await registerOwner(app, 'a');
    const b = await registerOwner(app, 'b');
    const res = await request(app)
      .post('/api/v1/users')
      .set('Cookie', a.cookie)
      .set('X-Store-Id', b.storeId)
      .send({
        name: 'Intruder',
        email: 'intruder@example.com',
        password: PASSWORD,
        role: 'MANAGER',
      });
    expect(res.status).toBe(403);
    expect(await prisma.user.findUnique({ where: { email: 'intruder@example.com' } })).toBeNull();
  });
});
