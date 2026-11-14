import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../db/prisma';
import { resetDb } from './db';
import { addMember, loginAs, registerOwner } from './helpers';

const app = createApp({ authRateLimitMax: 1000, aiProvider: null });
const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

type Min = 'PUBLIC' | 'CASHIER' | 'MANAGER' | 'OWNER';

const MATRIX: Record<string, Min> = {
  'GET /api/v1/health': 'PUBLIC',
  'GET /api/v1/health/db': 'PUBLIC',
  'POST /api/v1/auth/register': 'PUBLIC',
  'POST /api/v1/auth/login': 'PUBLIC',
  'POST /api/v1/auth/logout': 'PUBLIC',
  'GET /api/v1/auth/me': 'CASHIER',
  'GET /api/v1/stores/current': 'CASHIER',
  'GET /api/v1/users': 'OWNER',
  'POST /api/v1/users': 'OWNER',
  'PATCH /api/v1/users/:id/role': 'OWNER',
  'GET /api/v1/settings': 'CASHIER',
  'PATCH /api/v1/settings': 'OWNER',
  'GET /api/v1/categories': 'CASHIER',
  'POST /api/v1/categories': 'MANAGER',
  'PATCH /api/v1/categories/:id': 'MANAGER',
  'DELETE /api/v1/categories/:id': 'MANAGER',
  'GET /api/v1/products': 'CASHIER',
  'GET /api/v1/products/:id': 'CASHIER',
  'POST /api/v1/products': 'MANAGER',
  'PATCH /api/v1/products/:id': 'MANAGER',
  'DELETE /api/v1/products/:id': 'OWNER',
  'GET /api/v1/products/export': 'MANAGER',
  'POST /api/v1/products/import/preview': 'MANAGER',
  'POST /api/v1/products/import': 'MANAGER',
  'POST /api/v1/inventory/movements': 'MANAGER',
  'GET /api/v1/inventory/movements': 'MANAGER',
  'GET /api/v1/inventory/low-stock': 'MANAGER',
  'GET /api/v1/inventory/integrity': 'MANAGER',
  'GET /api/v1/suppliers': 'MANAGER',
  'GET /api/v1/suppliers/:id': 'MANAGER',
  'POST /api/v1/suppliers': 'MANAGER',
  'PATCH /api/v1/suppliers/:id': 'MANAGER',
  'GET /api/v1/purchases': 'MANAGER',
  'GET /api/v1/purchases/:id': 'MANAGER',
  'POST /api/v1/purchases': 'MANAGER',
  'PATCH /api/v1/purchases/:id': 'MANAGER',
  'POST /api/v1/purchases/:id/submit': 'MANAGER',
  'POST /api/v1/purchases/:id/approve': 'OWNER',
  'POST /api/v1/purchases/:id/cancel': 'MANAGER',
  'POST /api/v1/purchases/:id/receive': 'MANAGER',
  'POST /api/v1/sales/preview': 'CASHIER',
  'POST /api/v1/sales': 'CASHIER',
  'GET /api/v1/sales': 'CASHIER',
  'GET /api/v1/sales/:id': 'CASHIER',
  'GET /api/v1/returns': 'MANAGER',
  'GET /api/v1/returns/by-sale/:id': 'MANAGER',
  'POST /api/v1/returns/preview': 'MANAGER',
  'GET /api/v1/returns/:id': 'MANAGER',
  'POST /api/v1/returns': 'MANAGER',
  'GET /api/v1/reports/summary': 'MANAGER',
  'GET /api/v1/reports/products': 'MANAGER',
  'GET /api/v1/reports/categories': 'MANAGER',
  'GET /api/v1/reports/inventory': 'MANAGER',
  'GET /api/v1/reports/dashboard': 'MANAGER',
  'GET /api/v1/reports/export/:id': 'MANAGER',
  'GET /api/v1/forecasting/recommendations': 'MANAGER',
  'GET /api/v1/forecasting/products/:id': 'MANAGER',
  'POST /api/v1/forecasting/products/:id/approve': 'MANAGER',
  'POST /api/v1/forecasting/products/:id/dismiss': 'MANAGER',
  'POST /api/v1/forecasting/products/:id/review': 'MANAGER',
  'GET /api/v1/ai/status': 'MANAGER',
  'POST /api/v1/ai/ask': 'MANAGER',
  'GET /api/v1/audit-logs': 'OWNER',
  'GET /api/v1/audit-logs/actions': 'OWNER',
};

interface Layer {
  name: string;
  regexp: RegExp;
  route?: { path: string; methods: Record<string, boolean> };
  handle: { stack?: Layer[] };
}

function listRoutes(target: Express): string[] {
  const root = (target as unknown as { _router: { stack: Layer[] } })._router.stack;
  const found = new Set<string>();
  for (const layer of root) {
    if (layer.name !== 'router' || !layer.handle.stack) continue;
    const mount = layer.regexp
      .source.replace(/^\^/, '')
      .replace('\\/?(?=\\/|$)', '')
      .replace(/\\\//g, '/');
    for (const inner of layer.handle.stack) {
      if (!inner.route) continue;
      for (const method of Object.keys(inner.route.methods)) {
        const full = `${mount}${inner.route.path === '/' ? '' : inner.route.path}`.replace(
          /:[A-Za-z]+/g,
          ':id',
        );
        found.add(`${method.toUpperCase()} ${full}`);
      }
    }
  }
  return [...found].sort();
}

function call(method: string, path: string, cookie?: string) {
  const agent = request(app);
  const req =
    method === 'GET'
      ? agent.get(path)
      : method === 'POST'
        ? agent.post(path)
        : method === 'PATCH'
          ? agent.patch(path)
          : agent.delete(path);
  if (cookie) void req.set('Cookie', cookie);
  return method === 'GET' || method === 'DELETE' ? req : req.send({});
}

const pathOf = (key: string) => key.split(' ')[1]!.replace(/:id/g, ZERO_UUID);

describe('route inventory and permissions', () => {
  it('lists every route of the API, so no route can ship without being reviewed', () => {
    expect(listRoutes(app)).toEqual(Object.keys(MATRIX).sort());
  });

  it('refuses every non-public route without a session', async () => {
    const problems: string[] = [];
    for (const [key, min] of Object.entries(MATRIX)) {
      if (min === 'PUBLIC') continue;
      const res = await call(key.split(' ')[0]!, pathOf(key));
      if (res.status !== 401) problems.push(`${key} answered ${res.status} without a session (expected 401)`);
    }
    expect(problems).toEqual([]);
  });

  it('enforces the minimum role of every route on the server', async () => {
    const owner = await registerOwner(app, 'a');
    const manager = await addMember(app, owner.cookie, 'MANAGER', 'a');
    const cashier = await addMember(app, owner.cookie, 'CASHIER', 'a');
    const cookies = {
      CASHIER: await loginAs(app, cashier.email),
      MANAGER: await loginAs(app, manager.email),
      OWNER: owner.cookie,
    };
    const rank = { CASHIER: 1, MANAGER: 2, OWNER: 3 };

    const problems: string[] = [];
    for (const [key, min] of Object.entries(MATRIX)) {
      if (min === 'PUBLIC') continue;
      for (const role of ['CASHIER', 'MANAGER', 'OWNER'] as const) {
        const res = await call(key.split(' ')[0]!, pathOf(key), cookies[role]);
        const allowed = rank[role] >= rank[min];
        if (allowed && (res.status === 401 || res.status === 403)) {
          problems.push(`${role} was refused on ${key} (${res.status})`);
        }
        if (!allowed && res.status !== 403) {
          problems.push(`${role} should get 403 on ${key} but got ${res.status}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
