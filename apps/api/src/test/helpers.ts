import type { Express } from 'express';
import request from 'supertest';

export const PASSWORD = 'LongPassword123';

export function cookieFrom(res: request.Response): string {
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  const raw = cookies?.find((cookie) => cookie.startsWith('sp_session='));
  if (!raw) throw new Error('No session cookie was set');
  return raw.split(';')[0]!;
}

export async function registerOwner(app: Express, tag: string) {
  const email = `owner-${tag}@example.com`;
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ name: `Owner ${tag}`, email, password: PASSWORD, storeName: `Store ${tag}` });
  if (res.status !== 201) throw new Error(`register failed: ${res.status}`);
  return {
    cookie: cookieFrom(res),
    storeId: res.body.memberships[0].storeId as string,
    userId: res.body.user.id as string,
    email,
  };
}

export async function addMember(
  app: Express,
  ownerCookie: string,
  role: 'MANAGER' | 'CASHIER',
  tag: string,
) {
  const email = `${role.toLowerCase()}-${tag}@example.com`;
  const res = await request(app)
    .post('/api/v1/users')
    .set('Cookie', ownerCookie)
    .send({ name: `${role} ${tag}`, email, password: PASSWORD, role });
  if (res.status !== 201) throw new Error(`addMember failed: ${res.status}`);
  return { email, userId: res.body.userId as string };
}

export async function loginAs(app: Express, email: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return cookieFrom(res);
}
