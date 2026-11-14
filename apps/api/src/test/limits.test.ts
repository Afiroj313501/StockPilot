import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../db/prisma';
import { resetDb } from './db';
import { addMember, loginAs, PASSWORD, registerOwner } from './helpers';

const base = createApp({ authRateLimitMax: 1000, aiProvider: null });

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('abuse protection', () => {
  it('limits expensive read endpoints per user, only after authentication', async () => {
    const owner = await registerOwner(base, 'a');
    const manager = await addMember(base, owner.cookie, 'MANAGER', 'a');
    const managerCookie = await loginAs(base, manager.email);
    const limited = createApp({ authRateLimitMax: 1000, heavyRateLimitMax: 3, aiProvider: null });

    const get = (path: string, cookie?: string) => {
      const req = request(limited).get(path);
      return cookie ? req.set('Cookie', cookie) : req;
    };
    expect((await get('/api/v1/reports/summary')).status).toBe(401);
    for (let i = 0; i < 3; i++) expect((await get('/api/v1/reports/summary', managerCookie)).status).toBe(200);

    const blocked = await get('/api/v1/reports/summary', managerCookie);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect((await get('/api/v1/forecasting/recommendations', managerCookie)).status).toBe(429);
    expect((await get('/api/v1/products', managerCookie)).status).toBe(200);
    expect((await get('/api/v1/reports/summary', owner.cookie)).status).toBe(200);
  });

  it('limits failed sign-ins per account, whatever the address, and successful ones never count', async () => {
    const limited = createApp({ authRateLimitMax: 1000, loginAccountLimitMax: 3, aiProvider: null });
    const a = await registerOwner(limited, 'a');
    const b = await registerOwner(limited, 'b');
    const login = (email: string, password: string) =>
      request(limited).post('/api/v1/auth/login').send({ email, password });

    for (let i = 0; i < 3; i++) expect((await login(a.email, 'WrongPassword123')).status).toBe(401);
    const locked = await login(a.email, PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('RATE_LIMITED');
    expect((await login(a.email.toUpperCase(), 'WrongPassword123')).status).toBe(429);

    for (let i = 0; i < 5; i++) expect((await login(b.email, PASSWORD)).status).toBe(200);
    expect((await login(b.email, 'WrongPassword123')).status).toBe(401);
  });

  it('uses the real client address behind a reverse proxy, but only when told to', async () => {
    const attempt = (target: Express, ip: string) =>
      request(target)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: 'nobody@example.com', password: 'WrongPassword123' });

    const direct = createApp({ authRateLimitMax: 2, aiProvider: null });
    expect((await attempt(direct, '10.0.0.1')).status).toBe(401);
    expect((await attempt(direct, '10.0.0.2')).status).toBe(401);
    expect((await attempt(direct, '10.0.0.3')).status).toBe(429);

    const proxied = createApp({ authRateLimitMax: 2, trustProxy: 1, aiProvider: null });
    for (const ip of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) {
      expect((await attempt(proxied, ip)).status).toBe(401);
    }
    expect((await attempt(proxied, '10.0.0.1')).status).toBe(401);
    expect((await attempt(proxied, '10.0.0.1')).status).toBe(429);
  });
});
