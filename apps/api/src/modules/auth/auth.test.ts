import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db/prisma';
import { resetDb } from '../../test/db';

const app = createApp({ authRateLimitMax: 1000 });
const user = {
  name: 'Test Owner',
  email: 'owner@example.com',
  password: 'LongPassword123',
  storeName: 'Demo Store',
};

function sessionCookie(response: request.Response): string {
  const cookies = response.headers['set-cookie'] as string[] | undefined;
  const cookie = cookies?.find((value) => value.startsWith('sp_session='));
  if (!cookie) throw new Error('No session cookie was set');
  return cookie.split(';')[0]!;
}

beforeEach(async () => resetDb());
afterAll(async () => prisma.$disconnect());

describe('registration', () => {
  it('creates an owner account and sets an httpOnly session cookie', async () => {
    const response = await request(app).post('/api/v1/auth/register').send(user);
    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe(user.email);
    expect(response.body.memberships[0].role).toBe('OWNER');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect((response.headers['set-cookie'] as unknown as string[]).join(';')).toContain('HttpOnly');
  });

  it('hashes the password and stores only a session token hash', async () => {
    const response = await request(app).post('/api/v1/auth/register').send(user);
    const account = await prisma.user.findUniqueOrThrow({ where: { email: user.email } });
    const session = await prisma.session.findFirstOrThrow();
    expect(account.passwordHash.startsWith('$2')).toBe(true);
    expect(account.passwordHash).not.toContain(user.password);
    expect(session.tokenHash).not.toBe(sessionCookie(response).split('=')[1]);
  });

  it('rejects duplicate and weak registrations', async () => {
    await request(app).post('/api/v1/auth/register').send(user);
    const duplicate = await request(app).post('/api/v1/auth/register').send(user);
    const weak = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...user, password: 'short' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('REGISTRATION_FAILED');
    expect(weak.status).toBe(400);
    expect(weak.body.error.details[0].field).toBe('password');
  });
});

describe('login, sessions, and CSRF', () => {
  beforeEach(async () => {
    await request(app).post('/api/v1/auth/register').send(user);
  });

  it('logs in and resolves /me', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email.toUpperCase(), password: user.password });
    const me = await request(app).get('/api/v1/auth/me').set('Cookie', sessionCookie(login));
    expect(login.status).toBe(200);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(user.email);
  });

  it('uses the same failure for unknown users and wrong passwords', async () => {
    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'WrongPassword123' });
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'WrongPassword123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('rejects missing, forged, expired, and logged-out sessions', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/auth/me').set('Cookie', 'sp_session=forged')).status,
    ).toBe(401);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });
    const cookie = sessionCookie(login);
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401);
    const fresh = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });
    const freshCookie = sessionCookie(fresh);
    expect((await request(app).post('/api/v1/auth/logout').set('Cookie', freshCookie)).status).toBe(
      204,
    );
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', freshCookie)).status).toBe(401);
  });

  it('rejects foreign origins and accepts the configured origin', async () => {
    const blocked = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'http://evil.example')
      .send({ email: user.email, password: user.password });
    const allowed = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: user.email, password: user.password });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('CSRF_REJECTED');
    expect(allowed.status).toBe(200);
  });
});

describe('abuse protection and parsing', () => {
  it('rate limits repeated login attempts', async () => {
    const limited = createApp({ authRateLimitMax: 3 });
    for (let index = 0; index < 3; index += 1) {
      expect(
        (
          await request(limited).post('/api/v1/auth/login').send({
            email: 'nobody@example.com',
            password: 'WrongPassword123',
          })
        ).status,
      ).toBe(401);
    }
    const blocked = await request(limited)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'WrongPassword123' });
    expect(blocked.status).toBe(429);
  });

  it('returns a safe error for malformed JSON', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });
});
