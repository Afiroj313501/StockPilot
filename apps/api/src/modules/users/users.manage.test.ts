import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/prisma';
import { resetDb } from '../../test/db';
import { addMember, cookieFrom, loginAs, PASSWORD, registerOwner } from '../../test/helpers';

const app = createApp({ authRateLimitMax: 1000, aiProvider: null });
const NEW_PASSWORD = 'BrandNewPassword456';

beforeEach(async () => resetDb());
afterAll(async () => prisma.$disconnect());

const post = (cookie: string, path: string, body?: object) =>
  request(app)
    .post(`/api/v1${path}`)
    .set('Cookie', cookie)
    .send(body ?? {});

describe('user management', () => {
  it('resets a member password and requires changing it before other routes', async () => {
    const owner = await registerOwner(app, 'manage');
    const member = await addMember(app, owner.cookie, 'MANAGER', 'manage');
    const oldCookie = await loginAs(app, member.email);
    const reset = await post(owner.cookie, `/users/${member.userId}/reset-password`);
    expect(reset.status).toBe(200);
    expect(reset.body.temporaryPassword).toMatch(
      /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789]{16}$/,
    );
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', oldCookie)).status).toBe(401);

    const forced = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: member.email, password: reset.body.temporaryPassword });
    expect(forced.body.user.mustChangePassword).toBe(true);
    const forcedCookie = cookieFrom(forced);
    expect(
      (await request(app).get('/api/v1/products').set('Cookie', forcedCookie)).body.error.code,
    ).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(
      (
        await post(forcedCookie, '/auth/change-password', {
          currentPassword: reset.body.temporaryPassword,
          newPassword: NEW_PASSWORD,
        })
      ).status,
    ).toBe(204);
    expect((await request(app).get('/api/v1/products').set('Cookie', forcedCookie)).status).toBe(
      200,
    );
  });

  it('deactivates members, ends sessions, and protects the owner', async () => {
    const owner = await registerOwner(app, 'status');
    const member = await addMember(app, owner.cookie, 'CASHIER', 'status');
    const cookie = await loginAs(app, member.email);
    const off = await request(app)
      .patch(`/api/v1/users/${member.userId}/status`)
      .set('Cookie', owner.cookie)
      .send({ isActive: false });
    expect(off.body.isActive).toBe(false);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401);
    const self = await request(app)
      .patch(`/api/v1/users/${owner.userId}/status`)
      .set('Cookie', owner.cookie)
      .send({ isActive: false });
    expect([self.status, self.body.error.code]).toEqual([403, 'CANNOT_CHANGE_OWN_STATUS']);
  });

  it('updates profile and never accepts owner assignment', async () => {
    const owner = await registerOwner(app, 'profile');
    const profile = await request(app)
      .patch('/api/v1/auth/profile')
      .set('Cookie', owner.cookie)
      .send({ name: 'Renamed Owner' });
    expect(profile.body.user.name).toBe('Renamed Owner');
    const bad = await post(owner.cookie, '/users', {
      name: 'Bad',
      email: 'bad@example.com',
      password: PASSWORD,
      role: 'OWNER',
    });
    expect(bad.status).toBe(400);
  });
});
