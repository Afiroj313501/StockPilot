import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../db/prisma';
import { resetDb } from './db';
import { PASSWORD, registerOwner } from './helpers';

const app = createApp({ authRateLimitMax: 1000, aiProvider: null });
const ORIGIN = 'http://localhost:5173';
const EVIL = 'http://evil.example';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('browser-facing security', () => {
  it('sends protective headers and does not advertise the server', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['referrer-policy']).toBeDefined();
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('allows only the configured web origin (CORS) and refuses cross-site state changes (CSRF)', async () => {
    const allowed = await request(app).get('/api/v1/health').set('Origin', ORIGIN);
    expect(allowed.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const evil = await request(app).get('/api/v1/health').set('Origin', EVIL);
    expect(evil.headers['access-control-allow-origin']).not.toBe(EVIL);
    expect(evil.headers['access-control-allow-origin']).not.toBe('*');

    const preflight = await request(app)
      .options('/api/v1/products')
      .set('Origin', EVIL)
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.headers['access-control-allow-origin']).not.toBe(EVIL);
    expect(preflight.headers['access-control-allow-origin']).not.toBe('*');
    const good = await request(app)
      .options('/api/v1/products')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    expect(good.headers['access-control-allow-origin']).toBe(ORIGIN);

    const login = { email: 'nobody@example.com', password: 'WrongPassword123' };
    const foreignOrigin = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', EVIL)
      .send(login);
    expect(foreignOrigin.status).toBe(403);
    expect(foreignOrigin.body.error.code).toBe('CSRF_REJECTED');
    const crossSite = await request(app)
      .post('/api/v1/auth/login')
      .set('Sec-Fetch-Site', 'cross-site')
      .send(login);
    expect(crossSite.status).toBe(403);
    const sameSite = await request(app)
      .post('/api/v1/auth/login')
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Origin', ORIGIN)
      .send(login);
    expect(sameSite.status).toBe(401);
  });

  it('issues an HttpOnly, SameSite session cookie, keeps the token out of the response and clears it on logout', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Owner',
        email: 'cookie@example.com',
        password: PASSWORD,
        storeName: 'Cookie Store',
      });
    expect(res.status).toBe(201);
    const header = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('sp_session='),
    )!;
    expect(header).toMatch(/;\s*HttpOnly/i);
    expect(header).toMatch(/;\s*SameSite=Lax/i);
    expect(header).toMatch(/;\s*Path=\//i);
    expect(header).toMatch(/;\s*Expires=/i);
    expect(header).not.toMatch(/Domain=/i);

    const token = header.split(';')[0]!.split('=')[1]!;
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const out = await request(app).post('/api/v1/auth/logout').set('Cookie', `sp_session=${token}`);
    expect(out.status).toBe(204);
    const cleared = (out.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('sp_session='),
    )!;
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);
    const me = await request(app).get('/api/v1/auth/me').set('Cookie', `sp_session=${token}`);
    expect(me.status).toBe(401);
  });

  it('never lets API responses be cached, and errors carry a request id but no internals', async () => {
    const owner = await registerOwner(app, 'a');
    for (const path of [
      '/api/v1/health',
      '/api/v1/products',
      '/api/v1/auth/me',
      '/api/v1/settings',
    ]) {
      const res = await request(app).get(path).set('Cookie', owner.cookie);
      expect(res.headers['cache-control']).toBe('no-store');
    }

    const failures = [
      await request(app).get('/api/v1/nope').set('Cookie', owner.cookie),
      await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email":'),
      await request(app).get('/api/v1/auth/me'),
      await request(app).post('/api/v1/products').set('Cookie', owner.cookie).send({}),
      await request(app).get('/api/v1/products/not-a-uuid').set('Cookie', owner.cookie),
    ];
    expect(failures.map((r) => r.status)).toEqual([404, 400, 401, 400, 400]);
    for (const res of failures) {
      expect(typeof res.body.error.code).toBe('string');
      expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
      expect(JSON.stringify(res.body)).not.toMatch(/node_modules|\.tsx?:\d+|\bat \w+ \(/);
    }
  });
});
